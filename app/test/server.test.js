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
