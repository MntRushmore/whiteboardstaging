#!/usr/bin/env node
/**
 * The native brain's speed in node, on the same calls as the Swift benchmarks
 * (ios/Packages/AgathonBrain/Tests/AgathonBrainTests/BenchTests.swift): `brain.js` loaded into a
 * bare context, then every golden case (`golden.ndjson`) through `AgathonBrain.call`.
 *
 *   node scripts/bench-brain.mjs              V8 with its JIT (what the web board gets)
 *   node --jitless scripts/bench-brain.mjs    V8's interpreter only (Ignition), for comparison with
 *                                             JavaScriptCore without a JIT (an app on an iPad)
 *
 * Prints one line per method: n, median, p95, max (ms), and the slowest cases.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRAIN = path.join(root, "ios/Packages/AgathonBrain/Sources/AgathonBrain/Resources/brain.js");
const GOLDEN = path.join(root, "ios/Packages/AgathonBrain/Tests/AgathonBrainTests/Resources/golden.ndjson");

function summary(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.round((s.length - 1) * q))];
  return { n: s.length, median: at(0.5), p95: at(0.95), max: s[s.length - 1] };
}

const fmt = (n) => n.toFixed(2).padStart(8);

const code = fs.readFileSync(BRAIN, "utf8");
const context = vm.createContext({ performance: { now: () => performance.now() } });
let t = performance.now();
vm.runInContext(code, context, { filename: "brain.js" });
const evaluateMs = performance.now() - t;
const brain = context.AgathonBrain;
t = performance.now();
brain.call("init", "{}");
const engineMs = performance.now() - t;
const jit = JSON.parse(brain.call("jitProbe", "{}")).result.ms;

const cases = fs
  .readFileSync(GOLDEN, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
// one warm-up pass over the analyzeLine cases, as the Swift benchmark does
for (const c of cases.filter((c) => c.method === "analyzeLine").slice(0, 200)) brain.call(c.method, c.args);

const byMethod = new Map();
for (const c of cases) {
  const s = performance.now();
  brain.call(c.method, c.args);
  const ms = performance.now() - s;
  if (!byMethod.has(c.method)) byMethod.set(c.method, []);
  byMethod.get(c.method).push([c.name, ms]);
}
const page = cases.find((c) => c.name === "clusterStrokes/page");
const pageMs = [];
for (let i = 0; i < 20; i++) {
  const s = performance.now();
  brain.call(page.method, page.args);
  pageMs.push(performance.now() - s);
}
const three = cases.find((c) => c.name === "layoutHandwriting/three-line");
const threeMs = [];
for (let i = 0; i < 30; i++) {
  const s = performance.now();
  brain.call(three.method, three.args);
  threeMs.push(performance.now() - s);
}

const flags = process.execArgv.join(" ") || "(JIT)";
console.log(`node ${process.version} ${flags}: evaluate ${evaluateMs.toFixed(1)} ms, engine ${engineMs.toFixed(1)} ms, jitProbe ${jit.toFixed(1)} ms`);
console.log(`${"method".padEnd(22)}${"n".padStart(6)}${"median".padStart(9)}${"p95".padStart(9)}${"max".padStart(9)}  slowest`);
const row = (name, samples, slow = "") => {
  const s = summary(samples);
  console.log(`${name.padEnd(22)}${String(s.n).padStart(6)}${fmt(s.median)} ${fmt(s.p95)} ${fmt(s.max)}  ${slow}`);
};
for (const [method, xs] of byMethod) {
  const slow = [...xs]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([n, ms]) => `${n} ${ms.toFixed(0)}`)
    .join("; ");
  row(method, xs.map((x) => x[1]), slow);
}
row("cluster page x20", pageMs);
row("hand 3-line x30", threeMs);
