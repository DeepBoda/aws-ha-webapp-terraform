// Progressive enhancement for the status page. The page is fully rendered by the server;
// this adds the theme switch, live round-trip time, instance discovery and the burst test.
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const boot = JSON.parse(document.body.dataset.boot || "{}");
  const zones = new Map(); // az -> Set of instance ids seen
  let current = boot.instance || {};

  // ---- Theme: follow the system until the visitor picks one ----
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  const saved = store.get("theme");
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("theme", next);
  });

  // ---- Helpers ----
  async function timed(url) {
    const t0 = performance.now();
    const res = await fetch(url, { cache: "no-store" });
    const body = await res.json();
    return { body, ms: performance.now() - t0, ok: res.ok };
  }
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };
  const shortId = (id) => (id && id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id || "");
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  // ---- Request path: one slot per zone, the serving one glows ----
  function remember(inst) {
    if (!inst || !inst.az) return;
    if (!zones.has(inst.az)) zones.set(inst.az, new Set());
    zones.get(inst.az).add(inst.id);
  }

  function drawZones() {
    const names = [...zones.keys()].sort();
    document.querySelectorAll(".inst").forEach((node, i) => {
      const az = names[i];
      node.classList.toggle("live", az === current.az);
      node.classList.toggle("seen", Boolean(az));
      if (!az) return;
      const ids = [...zones.get(az)];
      node.querySelector(".az-name").textContent = az;
      node.querySelector(".inst-id").textContent =
        ids.length > 1 ? `${ids.length} instances` : ids[0];
    });
  }

  // ---- Served-by card and checks ----
  function showServed(info, ms) {
    current = info.instance;
    $("#srv-id").textContent = info.instance.id;
    $("#srv-az").textContent = info.instance.az;
    $("#srv-ver").textContent = info.version;
    $("#srv-time").textContent = info.time;
    if (ms !== undefined) $("#srv-rtt").textContent = `${Math.round(ms)} ms`;
    const card = $(".served");
    card.classList.remove("flash");
    void card.offsetWidth; // restart the animation
    card.classList.add("flash");
  }

  function showCheck(id, ok, text, detail) {
    const card = $(id);
    card.classList.toggle("ok", ok);
    card.classList.toggle("bad", !ok);
    card.querySelector(".badge").textContent = ok ? "OK" : "FAIL";
    card.querySelector("p").textContent = text;
    card.querySelector(".mono").textContent = detail;
  }

  function showChecks(info) {
    const d = info.db;
    showCheck("#chk-db", d.ok,
      d.ok ? `MySQL ${d.mysql}, reached over a verified TLS connection.` : `Unreachable: ${d.detail}`,
      d.ok ? `cipher ${d.tls}` : "");
    const s = info.storage;
    showCheck("#chk-s3", s.ok,
      s.ok ? "Wrote an object to S3 and read it back through the VPC endpoint." : `Failed: ${s.detail}`,
      s.ok ? s.key : "");
    const healthy = d.ok && s.ok;
    const pill = $("#overall");
    pill.classList.toggle("ok", healthy);
    pill.classList.toggle("warn", !healthy);
    pill.querySelector("span").textContent = healthy ? "All systems operational" : "Degraded";
    pill.title = pill.querySelector("span").textContent;
  }

  // ---- Bars (shared by the burst test and the visits panel) ----
  function drawBars(target, rows, total, unit) {
    target.replaceChildren();
    if (!rows.length) {
      target.append(el("p", "empty", "No data yet."));
      return;
    }
    for (const r of rows) {
      const row = el("div", "bar-row");
      const label = el("div", "bar-label");
      label.append(el("b", "", r.title), el("span", "mono", r.sub));
      const track = el("div", "bar-track");
      const fill = el("div", "bar-fill");
      track.append(fill);
      row.append(label, track, el("span", "bar-num", `${r.n} ${unit}`));
      target.append(row);
      requestAnimationFrame(() => { fill.style.width = `${total ? (r.n / total) * 100 : 0}%`; });
    }
  }

  function showVisits(db) {
    if (!db || !db.ok) return;
    $("#visits-total").textContent = db.visits.toLocaleString();
    const rows = (db.byAz || []).map((z) => ({ title: z.az, sub: "page views recorded", n: z.n }));
    drawBars($("#visits-bars"), rows, db.visits, "");
  }

  // ---- Discovery: a few quick requests to find every healthy instance ----
  async function discover(count) {
    const seen = [];
    for (let i = 0; i < count; i++) {
      try {
        const { body } = await timed("/api/instance");
        remember(body);
        seen.push(body);
      } catch { /* ignore a dropped request */ }
    }
    drawZones();
    return seen;
  }

  // ---- Burst test: N requests, a few at a time, counted per instance ----
  async function burst(n, parallel) {
    const btn = $("#burst");
    const status = $("#burst-status");
    const ticks = $("#ticks");
    const per = new Map(); // id -> { az, n, ms[] }
    const order = [];
    let done = 0;
    let failed = 0;
    btn.disabled = true;
    ticks.replaceChildren();
    status.textContent = `Sending ${n} requests…`;

    const draw = () => {
      const rows = [...per.entries()]
        .sort((a, b) => a[1].az.localeCompare(b[1].az) || a[0].localeCompare(b[0]))
        .map(([id, v]) => ({ title: v.az, sub: `${shortId(id)} · median ${Math.round(median(v.ms))} ms`, n: v.n }));
      drawBars($("#bars"), rows, done - failed, "req");
    };

    let next = 0;
    async function worker() {
      while (next < n) {
        next++;
        let cls = "tick x";
        try {
          const { body, ms } = await timed("/api/instance");
          remember(body);
          if (!per.has(body.id)) { per.set(body.id, { az: body.az, n: 0, ms: [] }); order.push(body.az); }
          const v = per.get(body.id);
          v.n++;
          v.ms.push(ms);
          cls = [...new Set(order)].sort().indexOf(body.az) % 2 ? "tick b" : "tick";
        } catch {
          failed++;
        }
        done++;
        ticks.append(el("span", cls));
        status.textContent = `${done} of ${n} answered`;
        draw();
      }
    }
    await Promise.all(Array.from({ length: parallel }, worker));

    const all = [...per.values()].flatMap((v) => v.ms);
    const azCount = new Set([...per.values()].map((v) => v.az)).size;
    status.textContent =
      `${n - failed} of ${n} answered by ${per.size} instance${per.size === 1 ? "" : "s"} ` +
      `in ${azCount} zone${azCount === 1 ? "" : "s"}, median ${Math.round(median(all))} ms` +
      (failed ? `, ${failed} failed` : "");
    btn.textContent = `Send ${n} more`;
    btn.disabled = false;
    drawZones();
  }

  // ---- Wire up ----
  remember(current);
  drawZones();
  showVisits(boot.db);
  if (!(boot.db && boot.db.ok)) drawBars($("#visits-bars"), [], 0, "");
  drawBars($("#bars"), [], 0, "");

  $("#refresh").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      const { body, ms } = await timed("/api/info");
      remember(body.instance);
      showServed(body, ms);
      showChecks(body);
      showVisits(body.db);
      drawZones();
    } finally {
      e.currentTarget.disabled = false;
    }
  });
  $("#burst").addEventListener("click", () => burst(30, 6));

  (async () => {
    const rtts = [];
    for (let i = 0; i < 3; i++) {
      try { rtts.push((await timed("/health")).ms); } catch { /* offline */ }
    }
    $("#srv-rtt").textContent = rtts.length ? `${Math.round(median(rtts))} ms` : "n/a";
    await discover(8);
  })();
})();
