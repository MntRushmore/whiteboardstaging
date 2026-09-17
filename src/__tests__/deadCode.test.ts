/**
 * Unit tests for scripts/find-dead-code.mjs, driven by a small fixture program written to a
 * temp directory. Nothing here depends on the real repo's state.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeDeadCode, classifyFile, exitCodeFor, formatReport, parseArgs } from "../../scripts/find-dead-code.mjs";

const FIXTURE: Record<string, string> = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      module: "esnext",
      moduleResolution: "bundler",
      allowJs: true,
      jsx: "preserve",
      noEmit: true,
      paths: { "@/*": ["./src/*"] },
    },
    include: ["src/**/*.ts", "src/**/*.tsx", "src/**/*.mts"],
  }),
  // Next.js entries: roots whose exports are never judged.
  "src/app/page.tsx": `
    import "./globals.css";
    import { usedFn } from "@/lib/used";
    import { innerUsed, renamed } from "@/lib/barrel";
    import * as ns from "@/lib/ns";
    import Widget from "@/components/Widget";
    export const metadata = { title: "x" };
    export default function Page() { return usedFn() + innerUsed + renamed + ns.a() + Widget({ a: 1 }); }
  `,
  "src/app/api/thing/route.ts": `
    import { lazy } from "@/lib/lazyLoader";
    import { t } from "@/lib/typed";
    export async function GET() { return (await lazy()) + t; }
  `,
  "src/proxy.ts": `export function proxy() { return 1; }`,
  "src/components/Widget.tsx": `
    import type { UsedShape } from "@/lib/used";
    export default function Widget(p: UsedShape) { return p.a; }
  `,
  "src/lib/used.ts": `
    export function usedFn() { return helper(); }
    export function helper() { return 1; }
    export function testOnlyFn() { return 2; }
    export function deadFn() { return 3; }
    export type UsedShape = { a: number };
    export type DeadType = string;
  `,
  "src/lib/lazyLoader.ts": `export async function lazy() { const m = await import("./dyn"); return m.run(); }`,
  "src/lib/dyn.ts": `export function run() { return 1; } export function other() { return 2; }`,
  "src/lib/ns.ts": `export const a = () => 1; export const b = 2;`,
  "src/lib/barrel/index.ts": `
    export * from "./inner";
    export { other as renamed, unusedReexport } from "./other";
  `,
  "src/lib/barrel/inner.ts": `export const innerUsed = 1; export const innerUnused = 2;`,
  "src/lib/barrel/other.ts": `export const other = 1; export const unusedReexport = 2;`,
  // Dead: never imported, and a two-file cluster that only imports itself.
  "src/lib/dead.ts": `export const dead = 1;`,
  "src/lib/cluster/a.ts": `import { b } from "./b"; export const a = b;`,
  "src/lib/cluster/b.ts": `export const b = 1;`,
  // Allowlisted dead file.
  "src/lib/kept.ts": `export const kept = 1;`,
  // Test-only helper, a test and a fixture.
  "src/lib/testHelper.ts": `export const seed = () => 1;`,
  "src/lib/__fixtures__/fx.ts": `export const fx = 1;`,
  "src/lib/__tests__/used.test.ts": `
    import { testOnlyFn } from "../used";
    import { seed } from "../testHelper";
    import { fx } from "../__fixtures__/fx";
    export const total = testOnlyFn() + seed() + fx;
  `,
  // Ambient declaration: ignored entirely.
  "src/types/global.d.ts": `declare const __FIXTURE__: number;`,
  // src importing a scripts/lib .mjs through its sibling .d.mts declaration.
  "src/lib/typed.ts": `import { shared } from "../../scripts/lib/shared.mjs"; export const t = shared();`,
  "scripts/lib/shared.mjs": `export function shared() { return 1; }`,
  "scripts/lib/shared.d.mts": `export declare function shared(): number;`,
  // Script entry -> lib; one orphan lib; JSDoc typedefs are not authored exports.
  "scripts/run.mjs": `import { helper } from "./lib/helper.mjs"; helper();`,
  "scripts/lib/helper.mjs": `
    /** @typedef {{ a: number }} HelperOpts */
    /** @param {HelperOpts} [o] */
    export function helper(o) { return o ? o.a : 0; }
    export const helperUnused = 1;
  `,
  "scripts/lib/orphan.mjs": `export const o = 1;`,
};

let root: string;
let report: ReturnType<typeof analyzeDeadCode>;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "dead-code-fixture-"));
  for (const [rel, text] of Object.entries(FIXTURE)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  report = analyzeDeadCode({ root, keep: { "src/lib/kept.ts": "kept for the test" } });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("classifyFile", () => {
  it.each([
    ["src/app/page.tsx", "entry"],
    ["src/app/board/[id]/page.tsx", "entry"],
    ["src/app/api/live/check/route.ts", "entry"],
    ["src/app/layout.tsx", "entry"],
    ["src/app/error.tsx", "entry"],
    ["src/app/loading.tsx", "entry"],
    ["src/app/not-found.tsx", "entry"],
    ["src/app/global-error.tsx", "entry"],
    ["src/middleware.ts", "entry"],
    ["src/proxy.ts", "entry"],
    ["src/app/dashboardState.ts", "candidate"],
    ["src/lib/live/proxy.ts", "candidate"],
    ["src/components/ui/button.tsx", "candidate"],
    ["src/lib/env.test.ts", "test"],
    ["src/lib/__tests__/x.ts", "test"],
    ["src/lib/live/__fixtures__/strokes.ts", "fixture"],
    ["src/shapes/__tests__/fixtures/thing.ts", "fixture"],
    ["scripts/lib/snapshotAssets.d.mts", "declaration"],
    ["next-env.d.ts", "declaration"],
    ["scripts/verify-rls.mjs", "entry"],
    ["scripts/lib/rlsChecks.mjs", "candidate"],
    ["next.config.ts", "entry"],
    ["src/app/globals.css", "ignored"],
    ["src/shapes/__tests__/fixtures/legacy.json", "ignored"],
    ["node_modules/foo/index.ts", "ignored"],
  ])("%s -> %s", (rel, kind) => {
    expect(classifyFile(rel)).toBe(kind);
  });
});

describe("analyzeDeadCode on the fixture program", () => {
  it("flags files no root reaches, including self-referencing clusters and orphan script libs", () => {
    expect(report.unusedFiles).toEqual(["scripts/lib/orphan.mjs", "src/lib/cluster/a.ts", "src/lib/cluster/b.ts", "src/lib/dead.ts"]);
  });

  it("reports files only tests reach as test-only, not unused", () => {
    expect(report.testOnlyFiles).toEqual(["src/lib/testHelper.ts"]);
    expect(report.files["src/lib/testHelper.ts"]).toMatchObject({ kind: "candidate", reachable: "test", importers: ["src/lib/__tests__/used.test.ts"] });
  });

  it("keeps allowlisted files out of the failing list but shows them with their reason", () => {
    expect(report.allowlisted).toEqual([{ file: "src/lib/kept.ts", reachable: "none", reason: "kept for the test" }]);
    expect(report.unusedFiles).not.toContain("src/lib/kept.ts");
  });

  it("treats Next entries, scripts, tests and fixtures as roots and drops declarations", () => {
    expect(report.files["src/app/page.tsx"]).toMatchObject({ kind: "entry", reachable: "prod" });
    expect(report.files["src/app/api/thing/route.ts"].kind).toBe("entry");
    expect(report.files["src/proxy.ts"].kind).toBe("entry");
    expect(report.files["scripts/run.mjs"].kind).toBe("entry");
    expect(report.files["src/lib/__tests__/used.test.ts"].kind).toBe("test");
    expect(report.files["src/lib/__fixtures__/fx.ts"].kind).toBe("fixture");
    expect(report.files["src/types/global.d.ts"]).toBeUndefined();
    expect(report.files["scripts/lib/shared.d.mts"]).toBeUndefined();
  });

  it("credits a scripts/lib .mjs imported through its sibling .d.mts", () => {
    expect(report.files["scripts/lib/shared.mjs"]).toMatchObject({ reachable: "prod", importers: ["src/lib/typed.ts"] });
    expect(report.unusedFiles).not.toContain("scripts/lib/shared.mjs");
  });

  it("follows dynamic import() and namespace imports as whole-module uses", () => {
    expect(report.files["src/lib/dyn.ts"].reachable).toBe("prod");
    const names = report.unusedExports.map((e) => `${e.file}:${e.name}`);
    expect(names).not.toContain("src/lib/dyn.ts:other");
    expect(names).not.toContain("src/lib/ns.ts:b");
  });

  it("lists unused exports with kind and local-use counts, sparing what is consumed", () => {
    const byKey = new Map(report.unusedExports.map((e) => [`${e.file}:${e.name}`, e]));
    expect(byKey.get("src/lib/used.ts:deadFn")).toMatchObject({ kind: "value", localUses: 0 });
    expect(byKey.get("src/lib/used.ts:helper")).toMatchObject({ kind: "value", localUses: 1 });
    expect(byKey.get("src/lib/used.ts:DeadType")).toMatchObject({ kind: "type", localUses: 0 });
    expect(byKey.get("scripts/lib/helper.mjs:helperUnused")).toMatchObject({ kind: "value" });
    expect(byKey.has("src/lib/used.ts:usedFn")).toBe(false);
    expect(byKey.has("src/lib/used.ts:UsedShape")).toBe(false); // import type counts
    expect(byKey.has("src/lib/used.ts:testOnlyFn")).toBe(false); // test-only, listed separately
    expect(byKey.has("scripts/lib/helper.mjs:helper")).toBe(false);
    expect(byKey.has("scripts/lib/helper.mjs:HelperOpts")).toBe(false); // JSDoc typedef is not an authored export
    expect(byKey.has("src/app/page.tsx:metadata")).toBe(false); // entry exports are never judged
    expect(byKey.has("src/lib/dead.ts:dead")).toBe(false); // dead files are reported once, as files
  });

  it("sees through barrels: names read through the barrel are used, the rest are not", () => {
    const byKey = new Map(report.unusedExports.map((e) => [`${e.file}:${e.name}`, e]));
    expect(byKey.has("src/lib/barrel/inner.ts:innerUsed")).toBe(false);
    expect(byKey.has("src/lib/barrel/other.ts:other")).toBe(false);
    expect(byKey.has("src/lib/barrel/index.ts:renamed")).toBe(false);
    expect(byKey.get("src/lib/barrel/inner.ts:innerUnused")).toMatchObject({ kind: "value" });
    expect(byKey.get("src/lib/barrel/index.ts:unusedReexport")).toMatchObject({ kind: "reexport" });
    expect(byKey.get("src/lib/barrel/other.ts:unusedReexport")).toMatchObject({ kind: "value" });
  });

  it("separates exports only tests import", () => {
    expect(report.testOnlyExports.map((e) => `${e.file}:${e.name}`)).toEqual(["src/lib/used.ts:testOnlyFn"]);
  });

  it("does not report stylesheet imports as unresolved", () => {
    expect(report.unresolved).toEqual([]);
  });

  it("summarises counts consistently", () => {
    expect(report.summary).toMatchObject({
      unusedFiles: report.unusedFiles.length,
      testOnlyFiles: report.testOnlyFiles.length,
      unusedExports: report.unusedExports.length,
      testOnlyExports: report.testOnlyExports.length,
    });
    expect(report.summary.candidates).toBeGreaterThan(0);
    expect(report.summary.roots).toBeGreaterThan(0);
  });
});

describe("exit codes and output", () => {
  it("fails only on unused files unless --strict", () => {
    expect(exitCodeFor(report)).toBe(1);
    const clean = { ...report, summary: { ...report.summary, unusedFiles: 0 } };
    expect(exitCodeFor(clean)).toBe(0);
    expect(exitCodeFor(clean, { strict: true })).toBe(1);
    expect(exitCodeFor({ ...clean, summary: { ...clean.summary, unusedExports: 0 } }, { strict: true })).toBe(0);
  });

  it("renders every section of the table", () => {
    const text = formatReport(report);
    expect(text).toContain("## Unused files — ERROR (4)");
    expect(text).toContain("src/lib/dead.ts");
    expect(text).toContain("## Test-only files — warning (1)");
    expect(text).toContain("## Allowlisted files — kept on purpose (1)");
    expect(text).toContain("kept for the test");
    expect(text).toContain("## Unused exports — warning");
    expect(text).toMatch(/src\/lib\/used\.ts:\d+\s+deadFn\s+value\s+0/);
    expect(text).toContain("## Test-only exports — info (1)");
    expect(text).not.toContain("Unresolved relative imports");
  });

  it("parses CLI flags", () => {
    expect(parseArgs([])).toMatchObject({ json: false, strict: false, out: null });
    expect(parseArgs(["--json", "--strict", "--out", "r.json", "--root", "/x"])).toMatchObject({ json: true, strict: true, out: "r.json", root: "/x" });
    expect(() => parseArgs(["--nope"])).toThrow(/unknown argument/);
  });
});
