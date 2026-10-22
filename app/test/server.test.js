// Runs the server with no database or bucket configured (as in CI) and checks every route.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { server } = require("../server");

let base;
before(() => new Promise((resolve) => server.listen(0, () => {
  base = `http://127.0.0.1:${server.address().port}`;
  resolve();
})));
after(() => new Promise((resolve) => server.close(resolve)));

test("/health answers without a database", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "ok");
});

test("/health/db reports 503 when the database is not configured", async () => {
  const res = await fetch(`${base}/health/db`);
  assert.equal(res.status, 503);
});

test("/ renders the status page", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Highly available web app on AWS/);
});

test("/api/info returns the instance, release and checks", async () => {
  const body = await (await fetch(`${base}/api/info`)).json();
  assert.ok(body.instance && body.version && body.db && body.storage);
});

test("unknown routes are 404", async () => {
  assert.equal((await fetch(`${base}/nope`)).status, 404);
});

test("/api/instance returns only the serving instance", async () => {
  const body = await (await fetch(`${base}/api/instance`)).json();
  assert.ok(body.id && body.az && body.version);
  assert.equal(body.db, undefined);
});

test("page assets are served with a content type and cache", async () => {
  const res = await fetch(`${base}/assets/app.css?v=1`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/css/);
  assert.match(res.headers.get("cache-control"), /max-age/);
});

test("only listed assets are served", async () => {
  assert.equal((await fetch(`${base}/assets/..%2Fserver.js`)).status, 404);
  assert.equal((await fetch(`${base}/assets/index.html`)).status, 404);
});

test("responses carry a strict content security policy", async () => {
  const csp = (await fetch(`${base}/`)).headers.get("content-security-policy");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
});

test("the visit count query reads the visits table", () => {
  const src = require("node:fs").readFileSync(require.resolve("../server"), "utf8");
  assert.match(src, /COUNT\(\*\) AS visits[^"]*FROM visits/);
});

test("/api/instance?record=1 reports whether the visit was stored", async () => {
  const body = await (await fetch(`${base}/api/instance?record=1`)).json();
  assert.equal(body.recorded, false); // no database in tests
});
