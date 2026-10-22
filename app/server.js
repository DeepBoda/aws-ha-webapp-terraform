// Demo application for the stack. No framework: node:http plus the MySQL and AWS SDK clients.
//
//   GET /            HTML page: serving instance and AZ, release, database and storage checks
//   GET /health      liveness for the ALB, never touches the database
//   GET /health/db   database readiness (SELECT 1 over TLS)
//   GET /api/info    the same facts as the page, as JSON
//
// Configuration comes from the environment set by the instance's systemd unit.

const http = require("node:http");
const fs = require("node:fs");

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
    const [[row]] = await p.query("SELECT COUNT(*) AS visits, @@version AS version");
    const [[tls]] = await p.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    return { ok: true, visits: Number(row.visits), mysql: row.version, tls: tls.Value || "none" };
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

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function page(info) {
  const row = (k, v, ok) => `<tr><th>${esc(k)}</th><td>${ok === undefined ? "" : `<span class="${ok ? "ok" : "bad"}">${ok ? "OK" : "FAIL"}</span> `}${esc(v)}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HA web app on AWS</title>
<style>
body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;margin:0;background:#f5f5f7;color:#1d1d1f}
main{max-width:720px;margin:48px auto;padding:0 20px}
h1{font-size:26px;margin:0 0 4px}p{color:#6e6e73;margin:0 0 24px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:12px 16px;border-bottom:1px solid #e5e5ea;vertical-align:top}
th{width:34%;color:#6e6e73;font-weight:500}
.ok,.bad{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:99px;margin-right:6px}
.ok{background:#e3f6e8;color:#1b7f3a}.bad{background:#fde8e8;color:#b42318}
code{font:13px ui-monospace,Menlo,monospace}
</style></head><body><main>
<h1>Highly available web app on AWS</h1>
<p>ALB (HTTPS) &rarr; Auto Scaling EC2 in private subnets &rarr; RDS MySQL, all built with Terraform and deployed by GitHub Actions. Refresh to see requests land on different instances.</p>
<table>
${row("Served by instance", info.instance.id)}
${row("Availability Zone", info.instance.az)}
${row("Release", info.version)}
${row("Database (MySQL over TLS)", info.db.ok ? `${info.db.mysql}, cipher ${info.db.tls}, ${info.db.visits} visits recorded` : info.db.detail, info.db.ok)}
${row("S3 application storage", info.storage.ok ? info.storage.key : info.storage.detail, info.storage.ok)}
${row("Time", info.time)}
</table>
</main></body></html>`;
}

async function info(record) {
  const [inst, dbs, st] = await Promise.all([instanceInfo(), dbCheck(record), storageCheck()]);
  return { instance: inst, version: cfg.version, db: dbs, storage: st, time: new Date().toISOString() };
}

function send(res, status, type, body) {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "strict-transport-security": "max-age=31536000",
  });
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
