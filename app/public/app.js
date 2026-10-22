// Progressive enhancement for the status page. The page is fully rendered by the server;
// this adds the theme switch, live round-trip time, instance discovery, the burst test
// and live visit counts.
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const boot = JSON.parse(document.body.dataset.boot || "{}");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const zones = new Map(); // az -> Set of instance ids seen
  const visits = { total: 0, byAz: new Map() };
  let current = boot.instance || {};

  document.documentElement.classList.add("js");

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

  // ---- Sections fade up as they scroll into view ----
  if ("IntersectionObserver" in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      }
    }, { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll("main > section").forEach((s) => { s.classList.add("reveal"); io.observe(s); });
  }

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
  const zoneIndex = (az) => [...zones.keys()].sort().indexOf(az);

  // Eases a number from what is shown to the new value.
  function countTo(node, to) {
    const from = Number(node.dataset.value || node.textContent.replace(/\D/g, "")) || 0;
    node.dataset.value = to;
    if (reduceMotion || from === to) { node.textContent = to.toLocaleString(); return; }
    const t0 = performance.now();
    const dur = 600;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      node.textContent = Math.round(from + (to - from) * eased).toLocaleString();
      if (k < 1 && node.dataset.value == to) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

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
      node.querySelector(".inst-id").textContent = ids.length > 1 ? `${ids.length} instances seen` : ids[0];
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

  // ---- Bars: rows are keyed, so updates slide instead of redrawing ----
  function drawBars(target, rows, total, unit) {
    if (!rows.length) {
      if (!target.querySelector(".empty")) target.replaceChildren(el("p", "empty", "No data yet."));
      return;
    }
    target.querySelector(".empty")?.remove();
    const keep = new Set();
    for (const r of rows) {
      keep.add(r.key);
      let row = target.querySelector(`[data-key="${CSS.escape(r.key)}"]`);
      if (!row) {
        row = el("div", "bar-row");
        row.dataset.key = r.key;
        const label = el("div", "bar-label");
        label.append(el("b"), el("span", "mono"));
        const track = el("div", "bar-track");
        track.append(el("div", "bar-fill"));
        row.append(label, track, el("span", "bar-num"));
        target.append(row);
      }
      row.classList.toggle("alt", zoneIndex(r.az) % 2 === 1);
      row.querySelector("b").textContent = r.title;
      row.querySelector(".bar-label span").textContent = r.sub;
      row.querySelector(".bar-num").textContent = `${r.n.toLocaleString()}${unit ? ` ${unit}` : ""}`;
      const fill = row.querySelector(".bar-fill");
      requestAnimationFrame(() => { fill.style.width = `${total ? Math.min(100, (r.n / total) * 100) : 0}%`; });
    }
    target.querySelectorAll(".bar-row").forEach((row) => { if (!keep.has(row.dataset.key)) row.remove(); });
    [...target.querySelectorAll(".bar-row")]
      .sort((a, b) => a.dataset.key.localeCompare(b.dataset.key))
      .forEach((row) => target.append(row));
  }

  // ---- Visits: server totals, bumped locally as burst requests are recorded ----
  function setVisits(db) {
    if (!db || !db.ok) return;
    visits.total = db.visits;
    visits.byAz = new Map((db.byAz || []).map((z) => [z.az, z.n]));
    drawVisits();
  }

  function bumpVisit(az) {
    visits.total++;
    visits.byAz.set(az, (visits.byAz.get(az) || 0) + 1);
    drawVisits();
  }

  function drawVisits() {
    countTo($("#visits-total"), visits.total);
    const rows = [...visits.byAz.entries()].map(([az, n]) => ({
      key: az, az, title: az, sub: `${visits.total ? Math.round((n / visits.total) * 100) : 0}% of all visits`, n,
    }));
    drawBars($("#visits-bars"), rows, visits.total, "");
  }

  async function syncFromServer() {
    try {
      const { body } = await timed("/api/info");
      setVisits(body.db);
      showChecks(body);
    } catch { /* keep what is shown */ }
  }

  // ---- Discovery: a few quick requests to find every healthy instance ----
  async function discover(count) {
    for (let i = 0; i < count; i++) {
      try { remember((await timed("/api/instance")).body); } catch { /* dropped request */ }
    }
    drawZones();
  }

  // ---- Burst test: N recorded requests, a few at a time, counted per instance ----
  async function burst(n, parallel) {
    const btn = $("#burst");
    const status = $("#burst-status");
    const ticks = $("#ticks");
    const per = new Map(); // id -> { az, n, ms[] }
    let done = 0;
    let failed = 0;
    btn.disabled = true;
    ticks.replaceChildren();
    $("#bars").replaceChildren();
    status.textContent = `Sending ${n} requests…`;

    const draw = () => {
      const rows = [...per.entries()].map(([id, v]) => ({
        key: `${v.az} ${id}`, az: v.az, title: v.az, sub: `${shortId(id)} · median ${Math.round(median(v.ms))} ms`, n: v.n,
      }));
      drawBars($("#bars"), rows, done - failed, "req");
    };

    let next = 0;
    async function worker() {
      while (next < n) {
        next++;
        const tick = el("span", "tick x");
        try {
          const { body, ms } = await timed("/api/instance?record=1");
          remember(body);
          if (!per.has(body.id)) per.set(body.id, { az: body.az, n: 0, ms: [] });
          const v = per.get(body.id);
          v.n++;
          v.ms.push(ms);
          tick.className = zoneIndex(body.az) % 2 ? "tick b" : "tick";
          if (body.recorded) bumpVisit(body.az);
        } catch {
          failed++;
        }
        done++;
        ticks.append(tick);
        status.textContent = `${done} of ${n} answered`;
        draw();
      }
    }
    await Promise.all(Array.from({ length: parallel }, worker));

    const all = [...per.values()].flatMap((v) => v.ms);
    const azCount = new Set([...per.values()].map((v) => v.az)).size;
    let msg =
      `${n - failed} of ${n} answered by ${per.size} instance${per.size === 1 ? "" : "s"} ` +
      `in ${azCount} zone${azCount === 1 ? "" : "s"}, median ${Math.round(median(all))} ms` +
      (failed ? `, ${failed} failed` : "") + ".";
    if (per.size === 1) msg += " Only one instance is in service right now, for example during a rolling deploy.";
    status.textContent = msg;
    btn.textContent = `Send ${n} more`;
    btn.disabled = false;
    drawZones();
    syncFromServer(); // settle on the database's own totals
  }

  // ---- Wire up ----
  remember(current);
  drawZones();
  if (boot.db && boot.db.ok) setVisits(boot.db);
  else drawBars($("#visits-bars"), [], 0, "");
  drawBars($("#bars"), [], 0, "");

  $("#refresh").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { body, ms } = await timed("/api/info?record=1");
      remember(body.instance);
      showServed(body, ms);
      showChecks(body);
      setVisits(body.db);
      drawZones();
    } catch { /* keep what is shown */ } finally {
      btn.disabled = false;
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
