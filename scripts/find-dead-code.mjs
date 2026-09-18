#!/usr/bin/env node
/**
 * find-dead-code — list source files and exported symbols nothing imports.
 *
 * Uses the TypeScript compiler API (already a devDependency) over tsconfig.json, so
 * `@/…` path aliases, `.mjs` → sibling `.d.mts` declarations, `import type`, dynamic
 * `import()` and `export … from` barrels resolve exactly as they do for `tsc`.
 *
 *   node scripts/find-dead-code.mjs            table on stdout, exit 1 when unused FILES exist
 *   node scripts/find-dead-code.mjs --json     machine-readable report only
 *   node scripts/find-dead-code.mjs --out f    also write the JSON report to a file
 *   node scripts/find-dead-code.mjs --strict   unused exports fail the run too
 *
 * Classification (see classifyFile):
 *   entry        Next.js conventions (page/layout/route/error/loading/…/proxy/middleware) and
 *                scripts/*.mjs + root config files: always roots, exports never judged.
 *   test/fixture *.test.ts(x), __tests__/, __fixtures__/, __mocks__/: roots for "test-only",
 *                never candidates.
 *   declaration  *.d.ts / *.d.mts: ignored (a `.d.mts` counts as its sibling `.mjs`).
 *   candidate    everything else under src/ and scripts/lib/: judged for reachability.
 *
 * Verdicts:
 *   unusedFiles      candidates reachable from no root at all (dead clusters included) — ERROR
 *   testOnlyFiles    candidates reachable only through tests                          — warning
 *   unusedExports    exports of live candidates no live file imports                  — warning
 *                    (kind "value" with `localUses` 0 means the symbol itself is dead, not
 *                    just over-exported; "reexport" is a barrel line nobody reads through)
 *   testOnlyExports  exports only tests import (kept: test seams are legitimate)      — info
 *   allowlisted      files in KEEP_FILES: reported with their reason, never fail the run
 *
 * Exported helpers are unit-tested against a fixture program in src/__tests__/deadCode.test.ts.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** @typedef {"entry" | "test" | "fixture" | "declaration" | "candidate" | "ignored"} FileKind */

/**
 * @typedef {{
 *   name: string,
 *   file: string,
 *   line: number,
 *   kind: "type" | "value" | "reexport",
 *   localUses: number,
 * }} ExportRef
 */

/**
 * @typedef {{
 *   root: string,
 *   files: Record<string, { kind: FileKind, reachable: "prod" | "test" | "none", importers: string[] }>,
 *   unusedFiles: string[],
 *   testOnlyFiles: string[],
 *   allowlisted: Array<{ file: string, reachable: "test" | "none", reason: string }>,
 *   unusedExports: ExportRef[],
 *   testOnlyExports: ExportRef[],
 *   unresolved: Array<{ from: string, specifier: string }>,
 *   summary: { candidates: number, roots: number, unusedFiles: number, testOnlyFiles: number, unusedExports: number, testOnlyExports: number },
 * }} DeadCodeReport
 */

/**
 * Files that the analysis would flag but that are kept on purpose. Keyed by repo-relative
 * path; the value is the reason shown in the report. Remove an entry once the file is wired
 * in (or deleted) so the allowlist cannot rot silently.
 * @type {Readonly<Record<string, string>>}
 */
export const KEEP_FILES = Object.freeze({
  "src/components/SetupRequiredBanner.tsx": "documented drop-in for missing AI keys (SETUP.md); not mounted by any page yet",
  "src/lib/live/voiceTools.ts": "voice tools over the Live layer (LIVE-MATH-SPEC §2.3 #13); kept until the Realtime session is wired",
});

const NEXT_ENTRY_BASENAMES = new Set([
  "page",
  "layout",
  "template",
  "default",
  "route",
  "error",
  "loading",
  "not-found",
  "global-error",
  "global-not-found",
  "forbidden",
  "unauthorized",
  "icon",
  "apple-icon",
  "opengraph-image",
  "twitter-image",
  "sitemap",
  "robots",
  "manifest",
]);
const NEXT_ROOT_ENTRY_BASENAMES = new Set(["middleware", "proxy", "instrumentation", "instrumentation-client"]);
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "out", "coverage"]);

/** Normalise to forward slashes so keys are stable across platforms. */
export function toPosix(p) {
  return p.split(sep).join("/");
}

function stripExt(base) {
  return base.replace(SOURCE_EXT, "");
}

/**
 * Classify a repo-relative POSIX path. Pure; the unit tests drive this directly.
 * @param {string} rel repo-relative path with forward slashes
 * @returns {FileKind}
 */
export function classifyFile(rel) {
  const parts = rel.split("/");
  const base = parts[parts.length - 1];
  if (!SOURCE_EXT.test(base)) return "ignored";
  if (/\.d\.[cm]?ts$/.test(base)) return "declaration";
  if (parts.some((p) => SKIP_DIRS.has(p))) return "ignored";
  if (parts.some((p) => p === "__fixtures__" || p === "__mocks__" || p === "fixtures")) return "fixture";
  if (parts.some((p) => p === "__tests__") || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(base)) return "test";

  const name = stripExt(base);
  if (parts[0] === "src") {
    if (parts[1] === "app" && NEXT_ENTRY_BASENAMES.has(name)) return "entry";
    if (parts.length === 2 && NEXT_ROOT_ENTRY_BASENAMES.has(name)) return "entry";
    return "candidate";
  }
  if (parts[0] === "scripts") {
    // scripts/*.mjs are run directly with node; scripts/lib/** is shared code.
    return parts.length === 2 ? "entry" : "candidate";
  }
  // Root-level configs (next.config.ts, vitest.config.ts, eslint.config.mjs…) and anything
  // else outside src/ or scripts/ are roots: they may import src/ but are never judged.
  return "entry";
}

/** Recursively list source files under `dir`, skipping build/vendor folders. */
export function walkSources(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkSources(full, out);
    else if (SOURCE_EXT.test(name)) out.push(full);
  }
  return out;
}

/**
 * Root names for the program: tsconfig's file list (minus generated .next types) plus every
 * .mjs/.js under scripts/ and at the repo root, which tsconfig's `include` does not list.
 * @param {string} root absolute repo root
 * @param {string} tsconfigPath absolute path to tsconfig.json
 */
export function loadProgramInputs(root, tsconfigPath) {
  const cfg = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (cfg.error) throw new Error(ts.flattenDiagnosticMessageText(cfg.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, dirname(tsconfigPath));
  const names = new Set();
  for (const f of parsed.fileNames) {
    const rel = toPosix(relative(root, f));
    if (rel.startsWith("..") || rel.startsWith(".next/")) continue;
    names.add(resolve(f));
  }
  for (const f of walkSources(join(root, "scripts"))) names.add(resolve(f));
  for (const name of readdirSync(root)) {
    if (/\.[cm]?js$/.test(name) && statSync(join(root, name)).isFile()) names.add(resolve(root, name));
  }
  const options = { ...parsed.options, allowJs: true, noEmit: true, incremental: false, tsBuildInfoFile: undefined };
  return { rootNames: [...names].sort(), options };
}

/**
 * Map a resolved file to the path we account for: a `.d.mts`/`.d.ts` declaration that sits
 * beside a real `.mjs`/`.js` is the JS file's type surface, so the import counts for the JS.
 */
function canonicalFile(abs) {
  const m = /^(.*)\.d\.(m|c)?ts$/.exec(abs);
  if (m) {
    for (const ext of [`.${m[2] ?? ""}js`, ".mjs", ".js", ".cjs"]) {
      const sibling = `${m[1]}${ext}`;
      if (existsSync(sibling)) return sibling;
    }
  }
  return abs;
}

/** Text of a string-literal-like node, or null. */
function literalText(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
}

/**
 * Collect every module reference in a source file: static imports/exports, `import()`,
 * `require()`, `new URL(<relative>, import.meta.url)` and JSDoc import types.
 * @returns {Array<{ specifier: string, node: ts.Node, kind: "static" | "namespace" | "dynamic" | "reexport-all" | "url" }>}
 */
function collectReferences(sf) {
  const refs = [];
  /** @type {string[]} JSDoc comment texts, collected while walking (forEachChild skips them) */
  const jsDocTexts = [];
  const visit = (node) => {
    for (const doc of /** @type {any} */ (node).jsDoc ?? []) jsDocTexts.push(sf.text.slice(doc.pos, doc.end));
    if (ts.isImportDeclaration(node)) {
      const spec = literalText(node.moduleSpecifier);
      if (spec !== null) {
        const ns = node.importClause?.namedBindings;
        refs.push({ specifier: spec, node, kind: ns && ts.isNamespaceImport(ns) ? "namespace" : "static" });
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const spec = literalText(node.moduleSpecifier);
      if (spec !== null) {
        const kind = !node.exportClause ? "reexport-all" : ts.isNamespaceExport(node.exportClause) ? "namespace" : "static";
        refs.push({ specifier: spec, node, kind });
      }
    } else if (ts.isImportTypeNode(node)) {
      const spec = ts.isLiteralTypeNode(node.argument) ? literalText(node.argument.literal) : null;
      if (spec !== null) refs.push({ specifier: spec, node, kind: "namespace" });
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamic = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      const spec = isDynamic || isRequire ? literalText(node.arguments[0]) : null;
      if (spec !== null) refs.push({ specifier: spec, node, kind: "dynamic" });
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL") {
      const [first, second] = node.arguments ?? [];
      const spec = literalText(first);
      const meta = second && ts.isPropertyAccessExpression(second) && second.name.text === "url";
      if (spec !== null && meta && SOURCE_EXT.test(spec)) refs.push({ specifier: spec, node, kind: "url" });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // JSDoc import types (`@param {import(...).T}`) live in comments, which forEachChild skips.
  // Only JSDoc text is scanned so an `import("...")` inside a string literal (e.g. a test fixture) is not a reference.
  for (const text of jsDocTexts) {
    for (const m of text.matchAll(/\bimport\((["'])([^"']+)\1\)/g)) {
      if (!refs.some((r) => r.specifier === m[2])) refs.push({ specifier: m[2], node: sf, kind: "namespace" });
    }
  }
  return refs;
}

/**
 * Analyse a program. Pure with respect to the filesystem beyond what TypeScript itself
 * reads, so tests can point it at a temp directory.
 * @param {{ root: string, tsconfigPath?: string, keep?: Readonly<Record<string, string>> }} opts
 * @returns {DeadCodeReport}
 */
export function analyzeDeadCode(opts) {
  const root = resolve(opts.root);
  const keep = opts.keep ?? KEEP_FILES;
  const tsconfigPath = resolve(opts.tsconfigPath ?? join(root, "tsconfig.json"));
  const { rootNames, options } = loadProgramInputs(root, tsconfigPath);
  const program = ts.createProgram({ rootNames, options });
  const checker = program.getTypeChecker();

  const rel = (abs) => toPosix(relative(root, abs));
  /** @type {Map<string, ts.SourceFile>} canonical abs path → source file */
  const sources = new Map();
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile && /node_modules/.test(sf.fileName)) continue;
    const abs = resolve(sf.fileName);
    if (rel(abs).startsWith("..")) continue;
    sources.set(abs, sf);
  }

  /** @type {Map<string, FileKind>} */
  const kinds = new Map();
  for (const abs of sources.keys()) kinds.set(abs, classifyFile(rel(abs)));
  // A `.d.mts` beside a real `.mjs` is that file's type surface; account for the JS file.
  const known = (abs) => kinds.has(abs) || existsSync(abs);

  /** @type {Map<string, Set<string>>} file → files it references */
  const edges = new Map();
  /** @type {Map<string, Set<string>>} file → files referencing it */
  const importers = new Map();
  /** @type {Array<{ from: string, specifier: string }>} */
  const unresolved = [];
  /** @type {Map<string, Set<string>>} target file → importers that take the whole module (namespace/dynamic) */
  const wholeModuleUsers = new Map();
  /** @type {Map<string, Set<string>>} "file::exportName" → importer files */
  const symbolUsers = new Map();

  const resolveSpecifier = (spec, fromAbs) => {
    if (!spec.startsWith(".") && !spec.startsWith("@/") && !isAbsolute(spec) && !spec.startsWith("#")) {
      // Bare specifier: a package unless `paths` maps it.
      const r = ts.resolveModuleName(spec, fromAbs, options, ts.sys).resolvedModule;
      if (!r || r.isExternalLibraryImport) return null;
      return canonicalFile(resolve(r.resolvedFileName));
    }
    const r = ts.resolveModuleName(spec, fromAbs, options, ts.sys).resolvedModule;
    if (r && !r.isExternalLibraryImport) return canonicalFile(resolve(r.resolvedFileName));
    const direct = resolve(dirname(fromAbs), spec);
    if (SOURCE_EXT.test(direct) && existsSync(direct)) return direct;
    return undefined;
  };

  const markSymbol = (targetAbs, name, fromAbs) => {
    const key = `${targetAbs}::${name}`;
    if (!symbolUsers.has(key)) symbolUsers.set(key, new Set());
    symbolUsers.get(key).add(fromAbs);
  };

  /** Follow the alias chain of an import/export specifier, crediting every hop's export. */
  const creditAlias = (nameNode, fromAbs) => {
    let sym = checker.getSymbolAtLocation(nameNode);
    const seen = new Set();
    while (sym && sym.flags & ts.SymbolFlags.Alias && !seen.has(sym)) {
      seen.add(sym);
      let next;
      try {
        next = checker.getImmediateAliasedSymbol(sym);
      } catch {
        break;
      }
      if (!next || next === sym) break;
      const decl = next.declarations?.[0];
      if (decl) markSymbol(canonicalFile(resolve(decl.getSourceFile().fileName)), String(next.escapedName), fromAbs);
      sym = next;
    }
  };

  for (const [abs, sf] of sources) {
    const out = new Set();
    edges.set(abs, out);
    for (const ref of collectReferences(sf)) {
      const target = resolveSpecifier(ref.specifier, abs);
      if (target === null) continue; // external package
      if (target === undefined || !known(target)) {
        if (SOURCE_EXT.test(ref.specifier) || ref.specifier.startsWith(".") || ref.specifier.startsWith("@/")) {
          if (!/\.(?:css|scss|json|svg|png|jpe?g|gif|webp|ico|woff2?)$/.test(ref.specifier)) unresolved.push({ from: rel(abs), specifier: ref.specifier });
        }
        continue;
      }
      out.add(target);
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(abs);

      if (ref.kind === "namespace" || ref.kind === "dynamic" || ref.kind === "url") {
        if (!wholeModuleUsers.has(target)) wholeModuleUsers.set(target, new Set());
        wholeModuleUsers.get(target).add(abs);
      } else if (ref.kind === "static") {
        const node = ref.node;
        if (ts.isImportDeclaration(node) && node.importClause) {
          if (node.importClause.name) creditAlias(node.importClause.name, abs);
          const nb = node.importClause.namedBindings;
          if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) creditAlias(el.name, abs);
        }
        // `export { a } from "./b"` / `export * from "./b"` credit nothing by themselves: a
        // consumer importing through the barrel credits both hops via the alias chain, so a
        // re-export nobody reads through leaves the origin unused too.
      }
    }
  }

  // Reachability: production roots first, then tests on top.
  const isTestish = (abs) => kinds.get(abs) === "test" || kinds.get(abs) === "fixture";
  const bfs = (seeds, allowed) => {
    const seen = new Set();
    const queue = [...seeds];
    while (queue.length) {
      const cur = queue.pop();
      if (seen.has(cur) || !allowed(cur)) continue;
      seen.add(cur);
      for (const next of edges.get(cur) ?? []) queue.push(next);
    }
    return seen;
  };
  const prodRoots = [...kinds].filter(([, k]) => k === "entry").map(([abs]) => abs);
  const prodReachable = bfs(prodRoots, (abs) => !isTestish(abs));
  const testRoots = [...kinds].filter(([abs, k]) => isTestish(abs) || k === "entry").map(([abs]) => abs);
  const anyReachable = bfs(testRoots, () => true);

  /** @type {DeadCodeReport["files"]} */
  const files = {};
  const unusedFiles = [];
  const testOnlyFiles = [];
  const allowlisted = [];
  for (const [abs, kind] of [...kinds].sort(([a], [b]) => a.localeCompare(b))) {
    if (kind === "ignored" || kind === "declaration") continue;
    const reachable = prodReachable.has(abs) ? "prod" : anyReachable.has(abs) ? "test" : "none";
    const r = rel(abs);
    files[r] = { kind, reachable, importers: [...(importers.get(abs) ?? [])].map(rel).sort() };
    if (kind !== "candidate" || reachable === "prod") continue;
    if (r in keep) allowlisted.push({ file: r, reachable, reason: keep[r] });
    else if (reachable === "none") unusedFiles.push(r);
    else testOnlyFiles.push(r);
  }

  // Exports of live candidates.
  const unusedExports = [];
  const testOnlyExports = [];
  const liveUser = (fromAbs) => (prodReachable.has(fromAbs) ? "prod" : anyReachable.has(fromAbs) ? "test" : null);
  for (const [abs, kind] of kinds) {
    if (kind !== "candidate" || !prodReachable.has(abs)) continue;
    const sf = sources.get(abs);
    const modSym = sf && checker.getSymbolAtLocation(sf);
    if (!modSym) continue;
    const whole = [...(wholeModuleUsers.get(abs) ?? [])].map(liveUser).filter(Boolean);
    for (const exp of checker.getExportsOfModule(modSym)) {
      const decl = exp.declarations?.[0];
      if (!decl || resolve(decl.getSourceFile().fileName) !== abs) continue; // `export *` from elsewhere: judged at origin
      if (ts.isJSDocTypedefTag(decl) || ts.isJSDocCallbackTag(decl)) continue; // implicit JS type exports, not authored `export`s
      const name = String(exp.escapedName);
      const users = [...(symbolUsers.get(`${abs}::${name}`) ?? [])].map(liveUser).filter(Boolean).concat(whole);
      if (users.includes("prod")) continue;
      const line = sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1;
      // `export { a }` / `export { a } from "./b"` are aliases: judge the target's nature, and
      // count local uses of the local binding for same-file aliases.
      const isAlias = Boolean(exp.flags & ts.SymbolFlags.Alias);
      const target = isAlias ? safeAliased(checker, exp) : exp;
      const fromElsewhere = isAlias && ts.isExportSpecifier(decl) && Boolean(decl.parent.parent.moduleSpecifier);
      const kind = fromElsewhere ? "reexport" : target && target.flags & ts.SymbolFlags.Value ? "value" : "type";
      const localUses = fromElsewhere ? 0 : countLocalUses(checker, sf, target ?? exp, decl);
      const ref = { name, file: rel(abs), line, kind, localUses };
      if (users.length === 0) unusedExports.push(ref);
      else testOnlyExports.push(ref);
    }
  }
  const byPos = (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name);
  unusedExports.sort(byPos);
  testOnlyExports.sort(byPos);

  const candidates = Object.values(files).filter((f) => f.kind === "candidate").length;
  const roots = Object.values(files).filter((f) => f.kind !== "candidate").length;
  return {
    root: toPosix(root),
    files,
    unusedFiles,
    testOnlyFiles,
    allowlisted,
    unusedExports,
    testOnlyExports,
    unresolved: unresolved.sort((a, b) => a.from.localeCompare(b.from) || a.specifier.localeCompare(b.specifier)),
    summary: {
      candidates,
      roots,
      unusedFiles: unusedFiles.length,
      testOnlyFiles: testOnlyFiles.length,
      unusedExports: unusedExports.length,
      testOnlyExports: testOnlyExports.length,
    },
  };
}

function safeAliased(checker, sym) {
  try {
    const t = checker.getAliasedSymbol(sym);
    return t && t.flags !== ts.SymbolFlags.None ? t : null;
  } catch {
    return null;
  }
}

/**
 * How many identifiers in `sf` (outside declaration names and import/export clauses) refer
 * to the symbol. 0 means the symbol is dead, not just over-exported.
 */
function countLocalUses(checker, sf, target, decl) {
  const nameNode = ts.getNameOfDeclaration(decl);
  const targetNames = new Set((target.declarations ?? []).map((d) => ts.getNameOfDeclaration(d)).filter(Boolean));
  let count = 0;
  const visit = (node) => {
    if (ts.isIdentifier(node) && node !== nameNode && !targetNames.has(node) && !ts.isImportSpecifier(node.parent) && !ts.isExportSpecifier(node.parent)) {
      const sym = checker.getSymbolAtLocation(node);
      if (sym && (sym === target || checker.getExportSymbolOfSymbol(sym) === target)) count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

/** Fixed-width text table. */
function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  return [line(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

/** @param {DeadCodeReport} report */
export function formatReport(report) {
  const out = [];
  const s = report.summary;
  out.push(`dead-code report for ${report.root}`);
  out.push(`${s.candidates} candidate files, ${s.roots} roots (entries/tests/fixtures/scripts)`);
  out.push("");
  const section = (title, rows, headers) => {
    out.push(`## ${title} (${rows.length})`);
    out.push(rows.length ? table(headers, rows) : "(none)");
    out.push("");
  };
  const exportRow = (e) => [`${e.file}:${e.line}`, e.name, e.kind, e.localUses];
  const exportHeaders = ["location", "export", "kind", "local uses"];
  section("Unused files — ERROR", report.unusedFiles.map((f) => [f]), ["file"]);
  section("Test-only files — warning", report.testOnlyFiles.map((f) => [f, report.files[f].importers.join(", ")]), ["file", "imported by"]);
  section("Allowlisted files — kept on purpose", report.allowlisted.map((a) => [a.file, a.reachable, a.reason]), ["file", "reachable", "reason"]);
  section("Unused exports — warning", report.unusedExports.map(exportRow), exportHeaders);
  section("Test-only exports — info", report.testOnlyExports.map(exportRow), exportHeaders);
  if (report.unresolved.length) section("Unresolved relative imports — check", report.unresolved.map((u) => [u.from, u.specifier]), ["from", "specifier"]);
  return out.join("\n");
}

/** @param {DeadCodeReport} report */
export function exitCodeFor(report, { strict = false } = {}) {
  if (report.summary.unusedFiles > 0) return 1;
  if (strict && report.summary.unusedExports > 0) return 1;
  return 0;
}

export function parseArgs(argv) {
  const args = { json: false, strict: false, out: null, root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--strict") args.strict = true;
    else if (a === "--out") args.out = argv[++i] ?? null;
    else if (a === "--root") args.root = argv[++i] ?? args.root;
    else if (a === "-h" || a === "--help") args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("usage: node scripts/find-dead-code.mjs [--json] [--strict] [--out report.json] [--root dir]\n");
    return 0;
  }
  const report = analyzeDeadCode({ root: args.root });
  const json = JSON.stringify(report, null, 2);
  if (args.out) {
    mkdirSync(dirname(resolve(args.out)), { recursive: true });
    writeFileSync(args.out, json + "\n");
  }
  process.stdout.write(args.json ? json + "\n" : formatReport(report) + "\n");
  const code = exitCodeFor(report, { strict: args.strict });
  if (!args.json) {
    const s = report.summary;
    process.stdout.write(
      `${code === 0 ? "OK" : "FAIL"}: ${s.unusedFiles} unused files, ${s.testOnlyFiles} test-only files, ${s.unusedExports} unused exports, ${s.testOnlyExports} test-only exports\n`,
    );
  }
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
