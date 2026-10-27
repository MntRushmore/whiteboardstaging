#!/usr/bin/env node
/**
 * Keys' Chromebook QA (docs/KEYS.md, Phase 4): drives /keys with the keyboard only in Chromium at
 * Chromebook sizes (1366 × 768, 1280 × 720), at 200% zoom (640 × 360 CSS pixels) and on a narrow
 * 390 px screen, with Reduce Motion on, screenshots each moment and runs axe on each page. Fails (exit
 * 1) on a serious or critical axe violation, a page that scrolls sideways, or a browser error.
 *
 *   npm run dev            # in another terminal (any env; signed out is fine: ?p= sets the problems)
 *   npm run qa:keys        # or: node scripts/keys-qa.mjs [baseUrl] [outDir]
 *
 * Needs Playwright with its Chromium (not a dependency of the app: `npx playwright install chromium`,
 * or a global install) and axe-core (in node_modules already, through eslint-plugin-jsx-a11y).
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? "docs/qa-screenshots/keys";
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: "1366", width: 1366, height: 768 },
  { name: "1280", width: 1280, height: 720 },
  { name: "zoom200", width: 640, height: 360 },
  { name: "390", width: 390, height: 844 },
];

/** Each journey: a list of problems, the keys pressed, and a screenshot name for each moment. */
const JOURNEYS = [
  {
    name: "sub",
    list: "53-27|6x7",
    steps: [
      { keys: ["0", "3", "Enter", "Enter"], shot: "look-again" },
      { keys: ["?"], wait: 1700, shot: "nudge" },
      { keys: ["?"], wait: 1700, shot: "smaller" },
      { keys: [" ", " ", " ", " ", " ", " ", "Enter"], shot: "back-up" },
    ],
  },
  {
    name: "fraction",
    list: "3/4+1/6",
    steps: [
      { focus: "[data-slot=answer]", keys: ["4", "/", "1", "2", "Enter"], shot: "look-again" },
      { keys: ["?", "?"], wait: 1700, shot: "bars" },
    ],
  },
  {
    name: "equation",
    list: "x+7=15",
    steps: [
      { focus: "[data-slot=answer]", type: "x = 22", keys: ["Enter", "?", "?"], wait: 1700, shot: "number-line" },
    ],
  },
  {
    name: "long",
    list: "34x26",
    steps: [{ keys: ["4", "0", "2", "Enter", "8", "6", "Enter", "2", "7", "2", "Enter", "Enter"], shot: "rings" }],
  },
];

const problems = [];
const browser = await chromium.launch();
for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, reducedMotion: "reduce" });
  await context.addInitScript(() => localStorage.setItem("agathon.featureLabs.v1", JSON.stringify({ keys: true })));
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`${size.name}: page error ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|supabase|127\.0\.0\.1:54321/i.test(m.text())) problems.push(`${size.name}: console ${m.text().slice(0, 160)}`);
  });

  const audit = async (where) => {
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(async () => {
      // the dev server's own overlay is not the page
      const r = await window.axe.run(document, { exclude: [["nextjs-portal"]], resultTypes: ["violations"] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
    });
    for (const v of result) {
      const line = `${size.name} ${where}: axe ${v.impact} ${v.id} (${v.nodes}): ${v.help}`;
      if (v.impact === "serious" || v.impact === "critical") problems.push(line);
      else console.log(`  note: ${line}`);
    }
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (sideways > 1) problems.push(`${size.name} ${where}: the page scrolls sideways by ${sideways}px`);
  };

  for (const j of JOURNEYS) {
    await page.goto(`${base}/keys?p=${encodeURIComponent(j.list)}`, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForSelector("[data-slot]", { timeout: 120_000 });
    await page.waitForTimeout(400);
    await audit(`${j.name} start`);
    for (const step of j.steps) {
      if (step.focus) await page.focus(step.focus);
      if (step.type) await page.keyboard.type(step.type, { delay: 30 });
      for (const k of step.keys ?? []) {
        await page.keyboard.press(k);
        await page.waitForTimeout(50);
      }
      await page.waitForTimeout(step.wait ?? 350);
      await page.screenshot({ path: join(out, `keys-qa-${size.name}-${j.name}-${step.shot}.png`) });
      await audit(`${j.name} ${step.shot}`);
    }
  }
  await context.close();
}
await browser.close();

if (problems.length) {
  console.error(`Keys QA: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`Keys QA: clean at ${SIZES.map((s) => s.name).join(", ")}; screenshots in ${out}`);
