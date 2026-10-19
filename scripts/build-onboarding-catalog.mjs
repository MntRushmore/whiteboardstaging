#!/usr/bin/env node
/**
 * The iPad onboarding's catalogue (docs/ONBOARDING.md): every word and number the web's /start
 * reads from TypeScript, written once as JSON into the app so the onboarding works offline and
 * never drifts from the web.
 *
 *   node scripts/build-onboarding-catalog.mjs           writes ios/Packages/AgathonOnboarding/Sources/AgathonOnboarding/Resources/onboarding-catalog.json
 *   node scripts/build-onboarding-catalog.mjs --check   fails when the committed file is not what the sources say
 *
 * What it holds, each from its own source (never copied by hand):
 *  - the grades, Kindergarten to 8th (`GRADES`), and each grade's skill path (`GRADE_PATHS`);
 *  - the high-school courses and "Something else" (`HIGH_SCHOOL_COURSES`, `SOMETHING_ELSE`) and
 *    each course's tricky list (`COURSE_FOCUS`);
 *  - every skill's name and line (`skillWords`) and its example in the tutor's hand (`SKILL_EXAMPLES`);
 *  - the try board's problems (`TRY_PROBLEMS`), with each one's right first step from its starter
 *    (`GRADE_STARTERS` / `STARTER_PROBLEMS`), so "Type it instead" can judge an answer on the iPad;
 *  - "How did you hear about Agathon?" (`HEARD_FROM`), the family pictures (`AVATARS`).
 *
 * The TypeScript is bundled with esbuild into a throwaway module and run in node.
 */
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "ios/Packages/AgathonOnboarding/Sources/AgathonOnboarding/Resources/onboarding-catalog.json");

const ENTRY = `
import { GRADES, GRADE_PATHS } from "@/lib/learning/grades";
import { HIGH_SCHOOL_COURSES, SOMETHING_ELSE } from "@/lib/onboarding/choice";
import { GRADE_STARTERS, STARTER_PROBLEMS } from "@/lib/onboarding/courses";
import { COURSE_FOCUS, START_SKILLS, skillWords } from "@/lib/start/plan";
import { SKILL_EXAMPLES } from "@/lib/start/inkSet";
import { MAX_FOCUS } from "@/lib/start/contracts";
import { TRY_BANDS } from "@/lib/try/contracts";
import { TRY_PROBLEMS } from "@/lib/try/problems";
import { HEARD_FROM } from "@/lib/funnel/contracts";
import { AVATARS, MAX_KIDS } from "@/lib/family/contracts";

export function catalog() {
  // the try problems in problems.ts's own order, each beside the starter it came from
  const starters = [];
  for (const band of TRY_BANDS) {
    for (const g of band.grades) for (const s of GRADE_STARTERS[g] ?? []) starters.push(s);
    for (const c of band.courses) for (const s of STARTER_PROBLEMS[c] ?? []) starters.push(s);
  }
  if (starters.length !== TRY_PROBLEMS.length) throw new Error("the try problems no longer follow the starters");
  const problems = TRY_PROBLEMS.map((p, i) => {
    const s = starters[i];
    if (s.lines.join("\\n") !== p.lines.join("\\n")) throw new Error("try problem " + p.id + " is not its starter");
    return { id: p.id, band: p.band, lines: [...p.lines], hint: p.hint, oneStep: p.oneStep, firstStep: s.firstStep, grade: p.grade ?? null, skill: p.skill ?? null };
  });
  const skills = {};
  for (const id of [...START_SKILLS].sort()) {
    const w = skillWords(id);
    skills[id] = { name: w.name, blurb: w.blurb, example: [...(SKILL_EXAMPLES[id] ?? [])] };
  }
  return {
    version: 1,
    maxFocus: MAX_FOCUS,
    maxKids: MAX_KIDS,
    grades: GRADES.map((g) => ({ id: g.id, label: g.label, short: g.short, path: [...GRADE_PATHS[g.id]] })),
    courses: HIGH_SCHOOL_COURSES.map((c) => ({ id: c.id, label: c.label, blurb: c.blurb, focus: [...(COURSE_FOCUS[c.id] ?? [])] })),
    somethingElse: { id: SOMETHING_ELSE.id, label: SOMETHING_ELSE.label, blurb: SOMETHING_ELSE.blurb, focus: [] },
    skills,
    problems,
    heardFrom: HEARD_FROM.map((h) => ({ id: h.id, label: h.label })),
    avatars: Object.keys(AVATARS),
  };
}
`;

async function make() {
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: root, loader: "ts", sourcefile: "onboarding-catalog-entry.ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
    tsconfig: path.join(root, "tsconfig.json"),
    alias: { "@": path.join(root, "src") },
    // the hand engine (inkSet's import) loads its own atlas: bundle it like any other module
    loader: { ".json": "json" },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onboarding-catalog-"));
  const file = path.join(dir, "entry.mjs");
  try {
    fs.writeFileSync(file, result.outputFiles[0].text);
    const mod = await import(pathToFileURL(file).href);
    return JSON.stringify(mod.catalog(), null, 2) + "\n";
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const json = await make();
if (process.argv.includes("--check")) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (have !== json) {
    console.error(`${path.relative(root, OUT)} is out of date: run node scripts/build-onboarding-catalog.mjs`);
    process.exit(1);
  }
  console.log("onboarding catalogue up to date");
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, json);
  const data = JSON.parse(json);
  console.log(`wrote ${path.relative(root, OUT)}: ${data.grades.length} grades, ${data.courses.length} courses, ${Object.keys(data.skills).length} skills, ${data.problems.length} problems`);
}
