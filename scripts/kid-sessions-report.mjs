#!/usr/bin/env node
// The kid sessions' report (docs/KID-SESSIONS.md): one HTML page from a run's folder — each session's
// checks (pass / fail / note), its lines (written → read → mark), what the kid was told, its
// screenshots and its screen recording. `scripts/ios-kid-sessions.sh report` writes it.
//
//   node scripts/kid-sessions-report.mjs <run folder>
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: kid-sessions-report.mjs <run folder>");
  process.exit(1);
}
const read = (p) => (fs.existsSync(p) ? fs.readdirSync(p) : []);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const results = read(path.join(dir, "results"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, "results", f), "utf8")))
  .sort((a, b) => a.id.localeCompare(b.id));
const uiShots = read(path.join(dir, "shots")).filter((f) => f.endsWith(".png"));
const videos = read(path.join(dir, "video")).filter((f) => f.endsWith(".mp4"));
const outcome = (n) => {
  const log = path.join(dir, "logs", `s${n}.log`);
  if (!fs.existsSync(log)) return "not run";
  const text = fs.readFileSync(log, "utf8");
  if (/Test case .* passed|Test Case .* passed/.test(text)) return "passed";
  if (/skipped/.test(text)) return "skipped";
  const why = text.match(/error: -\[.*?\] : (.*)/);
  return `failed${why ? `: ${why[1].slice(0, 200)}` : ""}`;
};

// every check across the sessions, by name
const byCheck = new Map();
for (const r of results)
  for (const c of r.checks) {
    if (c.pass === null || c.pass === undefined) continue;
    const t = byCheck.get(c.name) ?? { pass: 0, total: 0 };
    t.total += 1;
    if (c.pass) t.pass += 1;
    byCheck.set(c.name, t);
  }
const calls = results.reduce((n, r) => n + Object.values(r.calls ?? {}).reduce((a, b) => a + b, 0), 0);

const mark = (p) => (p === true ? `<span class="ok">pass</span>` : p === false ? `<span class="bad">fail</span>` : `<span class="note">note</span>`);
const section = (r) => {
  const n = r.id.slice(1, 3);
  const shots = [...(r.shots ?? []).map((f) => `results/${f}`), ...uiShots.filter((f) => f.startsWith(r.id)).map((f) => `shots/${f}`)];
  const video = videos.find((v) => v === `s${n}.mp4`);
  return `<section id="${esc(r.id)}">
  <h2>${esc(r.id)} · grade ${r.grade} · ${esc(r.title)}</h2>
  <p class="meta">hand <b>${esc(r.hand)}</b> · checking <b>${esc(r.checking)}</b> · ${Math.round(r.seconds)} s · calls ${esc(JSON.stringify(r.calls))} · UI test ${esc(outcome(n))}</p>
  <table class="checks">${r.checks.map((c) => `<tr><td>${mark(c.pass)}</td><td>${esc(c.name)}</td><td>${esc(c.detail)}</td></tr>`).join("")}</table>
  <table class="lines"><tr><th>#</th><th>written</th><th>read</th><th>mark</th><th>wanted</th><th></th></tr>
  ${r.lines.map((l) => `<tr><td>${l.problem}</td><td><code>${esc(l.written)}</code></td><td><code>${esc(l.read ?? "—")}</code></td><td>${esc(l.mark)}</td><td>${esc(l.expect ?? "—")}</td><td>${l.pass === false ? `<span class="bad">${esc(l.why ?? "fail")}</span>` : l.pass ? "ok" : ""}</td></tr>`).join("")}</table>
  ${r.texts?.length ? `<p class="said"><b>Said to the kid:</b> ${r.texts.map(esc).join(" · ")}</p>` : ""}
  ${r.notes?.length ? `<p class="said"><b>Notes:</b> ${r.notes.map(esc).join(" · ")}</p>` : ""}
  ${r.reads?.length ? `<details><summary>Every read (${r.reads.length})</summary><pre>${r.reads.map(esc).join("\n")}</pre></details>` : ""}
  ${video ? `<video controls preload="none" src="video/${video}"></video>` : ""}
  <div class="shots">${shots.map((s) => `<a href="${esc(s)}"><img loading="lazy" src="${esc(s)}" alt="${esc(path.basename(s))}"><span>${esc(path.basename(s, ".png"))}</span></a>`).join("")}</div>
</section>`;
};

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kid sessions</title>
<style>
:root { --bg:#fbf8f2; --ink:#1d1b26; --soft:#5f5b6e; --line:#e6e0d4; --ok:#1f8a4c; --bad:#c2410c; --note:#3b5bdb; --card:#ffffff; }
@media (prefers-color-scheme: dark) { :root { --bg:#16151c; --ink:#f1eee8; --soft:#a9a4b8; --line:#2c2a36; --ok:#4ade80; --bad:#fb923c; --note:#8aa2ff; --card:#1e1d26; } }
body { background:var(--bg); color:var(--ink); font:15px/1.5 -apple-system, system-ui, sans-serif; margin:0 auto; max-width:1200px; padding:24px 16px; }
h1 { margin:0 0 4px; } h2 { font-size:18px; margin:0 0 6px; }
.meta { color:var(--soft); margin:0 0 10px; font-size:13px; }
section { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; margin:16px 0; }
table { border-collapse:collapse; width:100%; margin:8px 0; font-size:13px; }
td, th { border-bottom:1px solid var(--line); padding:5px 8px; text-align:left; vertical-align:top; }
.ok { color:var(--ok); font-weight:600; } .bad { color:var(--bad); font-weight:600; } .note { color:var(--note); }
.summary td:first-child { width:40%; }
.shots { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:10px; margin-top:10px; }
.shots a { color:var(--soft); text-decoration:none; font-size:12px; } .shots img { width:100%; border:1px solid var(--line); border-radius:8px; display:block; }
video { width:100%; max-width:720px; border-radius:8px; margin-top:8px; }
code { font-size:12px; } .said { font-size:13px; color:var(--soft); }
</style></head><body>
<h1>Kid sessions</h1>
<p class="meta">${esc(path.basename(dir))} · ${results.length} sessions · ${calls} tutor calls · production, training flag, qa-bench@agathon.app · synthetic hands only</p>
<table class="summary"><tr><th>check</th><th>passed</th></tr>
${[...byCheck].map(([name, t]) => `<tr><td>${esc(name)}</td><td class="${t.pass === t.total ? "ok" : "bad"}">${t.pass}/${t.total}</td></tr>`).join("")}
</table>
<table class="summary"><tr><th>session</th><th>checks</th><th>UI test</th></tr>
${results.map((r) => `<tr><td><a href="#${esc(r.id)}">${esc(r.id)}</a> ${esc(r.title)}</td><td>${r.checks.filter((c) => c.pass === true).length}/${r.checks.filter((c) => c.pass !== null && c.pass !== undefined).length}</td><td>${esc(outcome(r.id.slice(1, 3)))}</td></tr>`).join("")}
</table>
${results.map(section).join("\n")}
</body></html>`;
fs.writeFileSync(path.join(dir, "report.html"), html);
