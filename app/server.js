// Demo application for the stack. No framework: node:http plus the MySQL and AWS SDK clients.
//
//   GET /              status page: serving instance and AZ, release, database and storage checks
//   GET /health        liveness for the ALB, never touches the database
//   GET /health/db     database readiness over TLS
//   GET /api/info      the same facts as the page, as JSON
//   GET /api/instance  just the serving instance, cheap enough for the in-page burst test
//   GET /assets/*      page CSS, JS and icon from public/
//
// Configuration comes from the environment set by the instance's systemd unit.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const cfg = {
  port: Number(process.env.PORT || 8080),
  region: process.env.AWS_REGION || "ap-south-1",
  version: process.env.APP_VERSION || "dev",
  bucket: process.env.APP_BUCKET || "",
  dbHost: process.env.DB_HOST || "",
  dbName: process.env.DB_NAME || "",
  dbSecretArn: process.env.DB_SECRET_ARN || "",
  dbCaPath: process.env.DB_CA_PATH || "",
};

// ---- Instance metadata (IMDSv2) ----

async function imds(path) {
  const base = "http://169.254.169.254/latest";
  const signal = AbortSignal.timeout(500);
  const token = await (await fetch(`${base}/api/token`, {
    method: "PUT", headers: { "X-aws-ec2-metadata-token-ttl-seconds": "300" }, signal,
  })).text();
  return (await fetch(`${base}/meta-data/${path}`, { headers: { "X-aws-ec2-metadata-token": token }, signal })).text();
}

let instance = null;
async function instanceInfo() {
  if (instance) return instance;
  try {
    instance = { id: await imds("instance-id"), az: await imds("placement/availability-zone") };
  } catch {
    instance = { id: "local", az: "local" };
  }
  return instance;
}

// ---- Database: credentials from Secrets Manager, TLS verified against the RDS CA ----

let pool = null;
async function db() {
  if (!cfg.dbSecretArn) return null;
  if (pool) return pool;
  const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
  const mysql = require("mysql2/promise");
  const sm = new SecretsManagerClient({ region: cfg.region });
  const secret = JSON.parse((await sm.send(new GetSecretValueCommand({ SecretId: cfg.dbSecretArn }))).SecretString);
  pool = mysql.createPool({
    host: cfg.dbHost,
    user: secret.username,
    password: secret.password,
    database: cfg.dbName,
    connectionLimit: 5,
    connectTimeout: 3000,
    ssl: { ca: fs.readFileSync(cfg.dbCaPath), rejectUnauthorized: true },
  });
  await pool.query(
    "CREATE TABLE IF NOT EXISTS visits (id BIGINT AUTO_INCREMENT PRIMARY KEY, instance_id VARCHAR(32), az VARCHAR(32), at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
  );
  return pool;
}

async function dbCheck(record) {
  try {
    const p = await db();
    if (!p) return { ok: false, detail: "not configured" };
    if (record) {
      const { id, az } = await instanceInfo();
      await p.query("INSERT INTO visits (instance_id, az) VALUES (?, ?)", [id, az]);
    }
    const [[row]] = await p.query("SELECT COUNT(*) AS visits, @@version AS version FROM visits");
    const [[tls]] = await p.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    const [byAz] = await p.query("SELECT az, COUNT(*) AS n FROM visits GROUP BY az ORDER BY az");
    return {
      ok: true,
      visits: Number(row.visits),
      byAz: byAz.map((r) => ({ az: r.az, n: Number(r.n) })),
      mysql: row.version,
      tls: tls.Value || "none",
    };
  } catch (err) {
    pool = null; // rebuild next time, for example after a credential rotation
    return { ok: false, detail: err.code || err.message };
  }
}

// ---- Storage: write and read back one object under uploads/ ----

async function storageCheck() {
  if (!cfg.bucket) return { ok: false, detail: "not configured" };
  try {
    const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
    const s3 = new S3Client({ region: cfg.region });
    const { id } = await instanceInfo();
    const Key = `uploads/healthcheck/${id}.txt`;
    const body = `written by ${id} at ${new Date().toISOString()}`;
    await s3.send(new PutObjectCommand({ Bucket: cfg.bucket, Key, Body: body }));
    const back = await (await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key }))).Body.transformToString();
    return { ok: back === body, key: Key };
  } catch (err) {
    return { ok: false, detail: err.name || err.message };
  }
}

// ---- HTTP ----

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Static files are read once at start; only these names are ever served.
const publicDir = path.join(__dirname, "public");
const assets = {
  "app.css": "text/css; charset=utf-8",
  "app.js": "text/javascript; charset=utf-8",
  "favicon.svg": "image/svg+xml",
};
const files = Object.fromEntries(
  Object.keys(assets).map((name) => [name, fs.readFileSync(path.join(publicDir, name))])
);
const template = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");

function page(info) {
  const { db: d, storage: st } = info;
  const vars = {
    version: info.version,
    region: cfg.region,
    instanceId: info.instance.id,
    az: info.instance.az,
    time: info.time,
    overallClass: d.ok && st.ok ? "ok" : "warn",
    overallText: d.ok && st.ok ? "All systems operational" : "Degraded",
    dbClass: d.ok ? "ok" : "bad",
    dbBadge: d.ok ? "OK" : "FAIL",
    dbText: d.ok ? `MySQL ${d.mysql}, reached over a verified TLS connection.` : `Unreachable: ${d.detail}`,
    dbCipher: d.ok ? `cipher ${d.tls}` : "",
    s3Class: st.ok ? "ok" : "bad",
    s3Badge: st.ok ? "OK" : "FAIL",
    s3Text: st.ok ? "Wrote an object to S3 and read it back through the VPC endpoint." : `Failed: ${st.detail}`,
    s3Key: st.ok ? st.key : "",
    visits: d.ok ? d.visits.toLocaleString("en-US") : "0",
    boot: JSON.stringify(info),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => esc(vars[k] ?? ""));
}

async function info(record) {
  const [inst, dbs, st] = await Promise.all([instanceInfo(), dbCheck(record), storageCheck()]);
  return { instance: inst, version: cfg.version, db: dbs, storage: st, time: new Date().toISOString() };
}

const securityHeaders = {
  "x-content-type-options": "nosniff",
  "strict-transport-security": "max-age=31536000",
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function send(res, status, type, body, cache = "no-store") {
  res.writeHead(status, { "content-type": type, "cache-control": cache, ...securityHeaders });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  try {
    if (url === "/health") return send(res, 200, "application/json", JSON.stringify({ status: "ok", version: cfg.version }));
    if (url === "/health/db") {
      const d = await dbCheck(false);
      return send(res, d.ok ? 200 : 503, "application/json", JSON.stringify(d));
    }
    if (url === "/api/info") return send(res, 200, "application/json", JSON.stringify(await info(false)));
    if (url === "/api/instance") {
      return send(res, 200, "application/json", JSON.stringify({ ...(await instanceInfo()), version: cfg.version }));
    }
    if (url.startsWith("/assets/")) {
      const name = url.slice("/assets/".length);
      // Assets are versioned by the ?v= query, so a day of browser caching is safe.
      if (Object.hasOwn(assets, name)) return send(res, 200, assets[name], files[name], "public, max-age=86400");
    }
    if (url === "/") return send(res, 200, "text/html; charset=utf-8", page(await info(true)));
    return send(res, 404, "application/json", '{"error":"not found"}');
  } catch (err) {
    console.error(err);
    return send(res, 500, "application/json", '{"error":"internal"}');
  }
});

if (require.main === module) {
  server.listen(cfg.port, () => console.log(`listening on ${cfg.port}, release ${cfg.version}`));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

module.exports = { server };
