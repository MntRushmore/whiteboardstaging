#!/usr/bin/env node
/**
 * Add Arc (uiarc.dev) items and move them under src/, where our `@/*` alias points.
 *
 *   node scripts/arc-add.mjs button input      # = npx shadcn@latest add @uiarc/button @uiarc/input, then relocate
 *
 * Arc's registry targets the project root (`~/registry/...`, `~/lib/motion-tokens.ts`) and its sources import
 * `@/registry/...` and `@/lib/motion-tokens`, assuming `@/*` -> `./*`. Here `@/*` -> `./src/*`, so the files live
 * at `src/registry/**` and `src/lib/motion-tokens.ts` and every Arc import resolves unchanged. The shadcn CLI
 * ignores `--path` for these targets, hence this wrapper: it runs the CLI (which also installs npm dependencies),
 * then moves each file it wrote into src/.
 *
 * A file that already exists under src/ with different content is kept (it may carry a local change, listed in
 * docs/ARCHITECTURE.md "Platform UI"); the registry's version is written next to it as `<file>.upstream` to diff.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ids = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (!ids.length) {
  console.error("usage: node scripts/arc-add.mjs <arc-id> [...]");
  process.exit(2);
}
for (const dir of ["registry", "lib"]) {
  if (fs.existsSync(path.join(root, dir))) {
    console.error(`./${dir} already exists at the project root; move or remove it first.`);
    process.exit(2);
  }
}

execFileSync("npx", ["-y", "shadcn@latest", "add", "-y", ...ids.map((id) => `@uiarc/${id}`)], { stdio: "inherit" });

/** @param {string} dir */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

const written = ["registry", "lib"].flatMap((dir) => (fs.existsSync(path.join(root, dir)) ? walk(path.join(root, dir)) : []));
for (const from of written) {
  const rel = path.relative(root, from);
  const to = path.join(root, "src", rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (!fs.existsSync(to)) {
    fs.renameSync(from, to);
    console.log(`added    src/${rel}`);
  } else if (fs.readFileSync(to, "utf8") === fs.readFileSync(from, "utf8")) {
    fs.rmSync(from);
    console.log(`same     src/${rel}`);
  } else {
    fs.renameSync(from, `${to}.upstream`);
    console.log(`KEPT     src/${rel} (local version differs; registry copy at src/${rel}.upstream)`);
  }
}
for (const dir of ["registry", "lib"]) fs.rmSync(path.join(root, dir), { recursive: true, force: true });
