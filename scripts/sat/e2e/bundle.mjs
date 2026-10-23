// Bundles a TypeScript harness under scripts/sat/e2e with the repo's `@/` paths (esbuild; jiti is too
// slow on the engine) and runs it: node scripts/sat/e2e/bundle.mjs scripts/sat/e2e/run.ts [args…]
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const [entry, ...args] = process.argv.slice(2);
const outDir = path.join(root, "scripts/sat/e2e/.out");
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, path.basename(entry).replace(/\.ts$/, ".mjs"));
await build({
  entryPoints: [path.resolve(root, entry)], bundle: true, outfile: out, format: "esm", platform: "node", target: "node20",
  tsconfig: path.join(root, "tsconfig.json"), external: ["sharp", "pino", "pino-pretty"],
  alias: { tldraw: path.join(root, "src/lib/brain/shims/tldraw.ts") }, logLevel: "warning",
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
});
const r = spawnSync(process.execPath, [out, ...args], { stdio: "inherit", cwd: root });
process.exit(r.status ?? 1);
