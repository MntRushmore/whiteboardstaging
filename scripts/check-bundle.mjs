#!/usr/bin/env node
/**
 * Client bundle report + budget check for the Next.js (Turbopack) production build.
 *
 *   npm run build && node scripts/check-bundle.mjs [--dist .next] [--json] [--by-package] [--budget "/board/[id]=700000"]
 *
 * Next 16 with Turbopack does not print "First Load JS" in the build output and has no
 * app-build-manifest.json, so the per-route numbers are derived from what the server
 * actually emits into the HTML:
 *
 *   - `<dist>/build-manifest.json`            -> `rootMainFiles` (React + Next runtime, every page)
 *                                                 and `polyfillFiles` (served with `noModule`, so
 *                                                 modern browsers never download them; reported apart)
 *   - `<dist>/server/app/** /page_client-reference-manifest.js`
 *                                              -> per route: `entryJSFiles` / `entryCSSFiles`, keyed by
 *                                                 every segment module the route renders (layout,
 *                                                 error, not-found, global-error and the page itself)
 *
 * "First load" for a route = rootMainFiles + all entryJSFiles of that route, deduplicated. This
 * matches the `<script src>` set in `.next/server/app/<route>.html` for prerendered routes
 * (verified for /train and /login on Next 16.2.4).
 *
 * Exit code 1 when a route's first-load JS (gzip) exceeds its budget. Budgets live in `BUDGETS`
 * below and are documented in docs/BUNDLE.md.
 *
 * The pure helpers are exported for the unit tests in src/__tests__/checkBundle.test.ts; the CLI
 * runs only when this file is the entry script.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

/**
 * Gzip budgets per route (bytes of first-load JS, gzip level 6 = zlib default).
 * Measured on 2026-09-17 (Next 16.2.4, tldraw 4.2.0, katex 0.18.7): /board/[id] = 918,532 B gzip
 * (897 KB); budget = measured + 15 % = 1,056,312, rounded up to the next 10 KB.
 * See docs/BUNDLE.md before raising a budget.
 * @type {Readonly<Record<string, number>>}
 */
export const BUDGETS = Object.freeze({
  "/board/[id]": 1_060_000,
});

/** @typedef {{ path: string, inlined?: boolean }} CssEntry */
/**
 * @typedef {object} ClientReferenceManifest
 * @property {Record<string, string[]>} entryJSFiles  segment module -> "static/chunks/x.js"[]
 * @property {Record<string, CssEntry[]>} entryCSSFiles segment module -> css entries
 */
/**
 * @typedef {object} BuildManifest
 * @property {string[]} rootMainFiles
 * @property {string[]} [polyfillFiles]
 */
/** @typedef {{ raw: number, gz: number }} Size */
/**
 * @typedef {object} RouteRow
 * @property {string} route
 * @property {string[]} js        deduplicated first-load JS chunk paths (dist-relative)
 * @property {string[]} css       deduplicated CSS chunk paths (dist-relative)
 * @property {string[]} pageJs    JS chunks contributed by the page segment only
 * @property {number} jsRaw
 * @property {number} jsGz
 * @property {number} cssRaw
 * @property {number} cssGz
 */

/**
 * The manifest file is
 *   globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
 *   globalThis.__RSC_MANIFEST["/route/page"] = {...json...};
 * so take the object assigned to the route key (the first `{` belongs to the `|| {}` fallback).
 * @param {string} source
 * @returns {ClientReferenceManifest}
 */
export function parseClientReferenceManifest(source) {
  // The key is a JSON string and may itself contain brackets: "/board/[id]/page".
  const assign = source.match(/__RSC_MANIFEST\["(?:[^"\\]|\\.)*"\]\s*=\s*/);
  const start = assign ? assign.index + assign[0].length : source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start || source[start] !== "{") {
    throw new Error("client reference manifest: no JSON object found");
  }
  const json = JSON.parse(source.slice(start, end + 1));
  return {
    entryJSFiles: json.entryJSFiles ?? {},
    entryCSSFiles: json.entryCSSFiles ?? {},
  };
}

/**
 * `server/app/board/[id]/page_client-reference-manifest.js` -> `/board/[id]`; the root page -> `/`.
 * Route groups `(marketing)` are dropped, as Next does when it builds the URL.
 * @param {string} relPath path relative to `<dist>/server/app`, any separator
 */
export function routeFromManifestPath(relPath) {
  const parts = relPath.split(/[\\/]/).filter(Boolean);
  const last = parts.pop();
  if (last !== "page_client-reference-manifest.js") {
    throw new Error(`not a page manifest: ${relPath}`);
  }
  const segments = parts.filter((p) => !(p.startsWith("(") && p.endsWith(")")));
  return "/" + segments.join("/");
}

/**
 * All chunks a route loads on first paint (no polyfills, no lazy chunks), in manifest order.
 * @param {BuildManifest} buildManifest
 * @param {ClientReferenceManifest} manifest
 * @param {string} route  used to find the page segment key (`.../src/app<route>/page`)
 * @returns {{ js: string[], css: string[], pageJs: string[] }}
 */
export function collectRouteFiles(buildManifest, manifest, route) {
  const js = new Set(buildManifest.rootMainFiles ?? []);
  const pageJs = new Set();
  const pageSuffix = `/app${route === "/" ? "" : route}/page`;
  for (const [segment, files] of Object.entries(manifest.entryJSFiles)) {
    const isPage = segment.endsWith(pageSuffix);
    for (const f of files) {
      js.add(f);
      if (isPage) pageJs.add(f);
    }
  }
  const css = new Set();
  for (const entries of Object.values(manifest.entryCSSFiles)) {
    for (const e of entries) if (!e.inlined) css.add(e.path);
  }
  return { js: [...js], css: [...css], pageJs: [...pageJs] };
}

/**
 * @param {Array<{ route: string, buildManifest: BuildManifest, manifest: ClientReferenceManifest }>} routes
 * @param {(distRelativePath: string) => Size} sizeOf
 * @returns {RouteRow[]} sorted by jsGz descending
 */
export function aggregateRoutes(routes, sizeOf) {
  const sum = (/** @type {string[]} */ files, /** @type {keyof Size} */ key) =>
    files.reduce((acc, f) => acc + sizeOf(f)[key], 0);
  return routes
    .map(({ route, buildManifest, manifest }) => {
      const { js, css, pageJs } = collectRouteFiles(buildManifest, manifest, route);
      return {
        route,
        js,
        css,
        pageJs,
        jsRaw: sum(js, "raw"),
        jsGz: sum(js, "gz"),
        cssRaw: sum(css, "raw"),
        cssGz: sum(css, "gz"),
      };
    })
    .sort((a, b) => b.jsGz - a.jsGz || a.route.localeCompare(b.route));
}

/**
 * @param {RouteRow[]} rows
 * @param {Record<string, number>} budgets route -> max jsGz bytes
 * @returns {Array<{ route: string, jsGz: number, budget: number, overBy: number }>}
 */
export function checkBudgets(rows, budgets) {
  const violations = [];
  for (const [route, budget] of Object.entries(budgets)) {
    const row = rows.find((r) => r.route === route);
    if (!row) continue; // a route that no longer exists cannot blow its budget; the report lists what does exist
    if (row.jsGz > budget) violations.push({ route, jsGz: row.jsGz, budget, overBy: row.jsGz - budget });
  }
  return violations;
}

/**
 * Turbopack emits one chunk graph per route, so a library used by two sibling routes lands in two
 * differently-named chunks with the same modules. Byte-identical raw sizes across different files
 * are a strong signal (module order may differ, so hashes do not match).
 * @param {Array<{ path: string, raw: number }>} chunks
 * @param {number} [minBytes] ignore small chunks (default 50 KB)
 * @returns {Array<{ raw: number, paths: string[] }>}
 */
export function findLikelyDuplicateChunks(chunks, minBytes = 50_000) {
  /** @type {Map<number, string[]>} */
  const bySize = new Map();
  for (const c of chunks) {
    if (c.raw < minBytes) continue;
    const list = bySize.get(c.raw) ?? [];
    list.push(c.path);
    bySize.set(c.raw, list);
  }
  return [...bySize.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([raw, paths]) => ({ raw, paths: paths.sort() }))
    .sort((a, b) => b.raw - a.raw);
}

/**
 * Parse `--flag value` / `--flag=value` / boolean flags.
 * @param {string[]} argv
 * @returns {{ dist: string, json: boolean, byPackage: boolean, budgets: Record<string, number>, help: boolean }}
 */
export function parseArgs(argv) {
  const out = { dist: ".next", json: false, byPackage: false, budgets: { ...BUDGETS }, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inlineValue] = arg.includes("=") ? arg.split(/=(.*)/s) : [arg, undefined];
    const next = () => {
      if (inlineValue !== undefined) return inlineValue;
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case "--dist":
        out.dist = next();
        break;
      case "--json":
        out.json = true;
        break;
      case "--by-package":
        out.byPackage = true;
        break;
      case "--budget": {
        const spec = next();
        const eq = spec.lastIndexOf("=");
        const route = spec.slice(0, eq);
        const bytes = Number(spec.slice(eq + 1));
        if (eq === -1 || !route || !Number.isFinite(bytes) || bytes <= 0) {
          throw new Error(`--budget expects "<route>=<gzipBytes>", got "${spec}"`);
        }
        out.budgets[route] = bytes;
        break;
      }
      case "-h":
      case "--help":
        out.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return out;
}

/** @param {number} n */
export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * @param {RouteRow[]} rows
 * @param {Record<string, number>} budgets
 */
export function formatRouteTable(rows, budgets) {
  const header = ["Route", "First-load JS", "gzip", "CSS", "gzip", "Page chunks", "Budget (gz)"];
  const body = rows.map((r) => {
    const budget = budgets[r.route];
    return [
      r.route,
      fmtBytes(r.jsRaw),
      fmtBytes(r.jsGz),
      fmtBytes(r.cssRaw),
      fmtBytes(r.cssGz),
      String(r.pageJs.length),
      budget ? `${fmtBytes(budget)} ${r.jsGz > budget ? "OVER" : "ok"}` : "-",
    ];
  });
  return renderTable([header, ...body]);
}

/**
 * @param {Array<{ path: string, raw: number, gz: number, routes: string[] }>} chunks
 * @param {number} limit
 */
export function formatChunkTable(chunks, limit = 12) {
  const header = ["Chunk", "raw", "gzip", "Routes (first load)"];
  const body = chunks
    .slice(0, limit)
    .map((c) => [path.basename(c.path), fmtBytes(c.raw), fmtBytes(c.gz), c.routes.length ? c.routes.join(" ") : "(lazy)"]);
  return renderTable([header, ...body]);
}

/** @param {string[][]} rows */
function renderTable(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows
    .map((r, idx) => {
      const line = r.map((cell, i) => cell.padEnd(widths[i])).join("  ");
      return idx === 0 ? `${line}\n${widths.map((w) => "-".repeat(w)).join("  ")}` : line;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------------------------
// Source-map attribution (optional): `BUNDLE_SOURCEMAPS=1 npm run build` turns on
// `productionBrowserSourceMaps` (see next.config.ts) and `--by-package` then reports how many
// generated bytes of each big chunk come from which npm package.
// ---------------------------------------------------------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Decode one line of source-map `mappings` into segments (generated column + source index).
 * @param {string} line
 * @param {{ src: number }} state  carried across lines (source index is relative across the whole map)
 * @returns {Array<{ col: number, src: number }>}
 */
export function decodeMappingsLine(line, state) {
  const segments = [];
  let col = 0;
  for (const seg of line.split(",")) {
    if (!seg) continue;
    const values = [];
    let value = 0;
    let shift = 0;
    for (const ch of seg) {
      const digit = B64.indexOf(ch);
      if (digit === -1) throw new Error(`bad VLQ char "${ch}"`);
      value += (digit & 31) << shift;
      if (digit & 32) {
        shift += 5;
      } else {
        values.push(value & 1 ? -(value >> 1) : value >> 1);
        value = 0;
        shift = 0;
      }
    }
    col += values[0];
    if (values.length >= 4) state.src += values[1];
    segments.push({ col, src: values.length >= 4 ? state.src : -1 });
  }
  return segments;
}

/**
 * `turbopack:///[project]/node_modules/tldraw/dist-esm/x.mjs` -> `tldraw`;
 * `.../node_modules/@tldraw/editor/...` -> `@tldraw/editor`;
 * `webpack://pdf.js/./src/display/api.js` (a library shipping its own nested map) -> `pdf.js`;
 * the project's own code `[project]/src/lib/x.ts` -> `(app) src/lib`; unknown -> `(other)`.
 * @param {string} source
 */
export function packageOf(source) {
  const nm = source.lastIndexOf("node_modules/");
  if (nm !== -1) {
    const rest = source.slice(nm + "node_modules/".length).split("/");
    return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
  }
  const app = source.match(/\[project\]\/src\/([^/]+)/);
  if (app) return `(app) src/${app[1]}`;
  const nested = source.match(/^webpack:\/\/([^/]+)\//);
  if (nested) return nested[1];
  if (source.includes("[turbopack]") || source.includes("turbopack")) return "(turbopack runtime)";
  return "(other)";
}

/**
 * Attribute generated bytes to packages. Segment N owns the bytes up to segment N+1 (or end of line).
 * @param {{ sources: string[], mappings: string }} map
 * @param {string} generated the chunk's source text (for line lengths)
 * @returns {Array<{ pkg: string, bytes: number }>} sorted descending
 */
export function attributeSourceMap(map, generated) {
  const lines = generated.split("\n");
  const mappingLines = map.mappings.split(";");
  /** @type {Map<string, number>} */
  const totals = new Map();
  const state = { src: 0 };
  for (let i = 0; i < mappingLines.length; i++) {
    const segments = decodeMappingsLine(mappingLines[i], state);
    const lineLen = lines[i]?.length ?? 0;
    for (let j = 0; j < segments.length; j++) {
      const end = j + 1 < segments.length ? segments[j + 1].col : lineLen;
      const bytes = Math.max(0, end - segments[j].col);
      const pkg = segments[j].src >= 0 ? packageOf(map.sources[segments[j].src] ?? "") : "(unmapped)";
      totals.set(pkg, (totals.get(pkg) ?? 0) + bytes);
    }
  }
  return [...totals.entries()].map(([pkg, bytes]) => ({ pkg, bytes })).sort((a, b) => b.bytes - a.bytes);
}

// ---------------------------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------------------------

/**
 * Walk `<dist>/server/app` for page manifests and read everything the report needs.
 * @param {string} dist
 */
export function readBuild(dist) {
  const buildManifestPath = path.join(dist, "build-manifest.json");
  if (!fs.existsSync(buildManifestPath)) {
    throw new Error(`${buildManifestPath} not found - run \`npm run build\` first`);
  }
  /** @type {BuildManifest} */
  const buildManifest = JSON.parse(fs.readFileSync(buildManifestPath, "utf8"));
  const appDir = path.join(dist, "server", "app");
  /** @type {Array<{ route: string, buildManifest: BuildManifest, manifest: ClientReferenceManifest }>} */
  const routes = [];
  const walk = (/** @type {string} */ dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page_client-reference-manifest.js") {
        const route = routeFromManifestPath(path.relative(appDir, full));
        routes.push({ route, buildManifest, manifest: parseClientReferenceManifest(fs.readFileSync(full, "utf8")) });
      }
    }
  };
  if (fs.existsSync(appDir)) walk(appDir);

  /** @type {Map<string, Size>} */
  const sizeCache = new Map();
  const sizeOf = (/** @type {string} */ rel) => {
    let s = sizeCache.get(rel);
    if (!s) {
      const buf = fs.readFileSync(path.join(dist, rel));
      s = { raw: buf.length, gz: zlib.gzipSync(buf).length };
      sizeCache.set(rel, s);
    }
    return s;
  };

  const chunksDir = path.join(dist, "static", "chunks");
  const allChunks = fs.existsSync(chunksDir)
    ? fs
        .readdirSync(chunksDir)
        .filter((f) => f.endsWith(".js") || f.endsWith(".css"))
        .map((f) => `static/chunks/${f}`)
    : [];

  return { buildManifest, routes, sizeOf, allChunks, polyfills: buildManifest.polyfillFiles ?? [] };
}

/**
 * @param {ReturnType<typeof readBuild>} build
 * @param {ReturnType<typeof parseArgs>} args
 */
export function buildReport(build, args) {
  const rows = aggregateRoutes(build.routes, build.sizeOf);
  const routesByChunk = new Map();
  for (const r of rows) for (const f of [...r.js, ...r.css]) routesByChunk.set(f, [...(routesByChunk.get(f) ?? []), r.route]);
  const chunks = build.allChunks
    .map((p) => ({ path: p, ...build.sizeOf(p), routes: routesByChunk.get(p) ?? [] }))
    .sort((a, b) => b.raw - a.raw);
  const duplicates = findLikelyDuplicateChunks(chunks);
  const violations = checkBudgets(rows, args.budgets);
  const totals = chunks.reduce((acc, c) => ({ raw: acc.raw + c.raw, gz: acc.gz + c.gz }), { raw: 0, gz: 0 });
  return { rows, chunks, duplicates, violations, totals, polyfills: build.polyfills };
}

/**
 * Turbopack names the map file with its own hash (`0krg....js` -> `0g3b....js.map`), so follow the
 * trailing `//# sourceMappingURL=` comment instead of guessing `<chunk>.map`.
 * @param {string} generated chunk source text
 * @returns {string | null} the URL as written (relative to the chunk's directory), or null
 */
export function sourceMapUrlOf(generated) {
  const tail = generated.slice(-4096);
  const matches = [...tail.matchAll(/\/\/[#@]\s*sourceMappingURL=(\S+)/g)];
  if (!matches.length) return null;
  const url = matches[matches.length - 1][1].trim();
  return url.startsWith("data:") ? null : url;
}

/**
 * @param {string} dist
 * @param {Array<{ path: string, raw: number }>} chunks
 * @param {number} limit
 */
function attributeChunks(dist, chunks, limit = 4) {
  const out = [];
  for (const c of chunks.slice(0, limit)) {
    if (!c.path.endsWith(".js")) continue;
    const generated = fs.readFileSync(path.join(dist, c.path), "utf8");
    const url = sourceMapUrlOf(generated);
    const mapPath = url ? path.join(dist, path.dirname(c.path), url) : path.join(dist, `${c.path}.map`);
    if (!fs.existsSync(mapPath)) continue;
    const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    out.push({ chunk: c.path, packages: attributeSourceMap(map, generated).slice(0, 15) });
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  if (args.help) {
    console.log(
      "usage: node scripts/check-bundle.mjs [--dist .next] [--json] [--by-package] [--budget '/route=gzipBytes']",
    );
    process.exit(0);
  }
  let build;
  try {
    build = readBuild(args.dist);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  const report = buildReport(build, args);
  const attribution = args.byPackage ? attributeChunks(args.dist, report.chunks) : [];

  if (args.json) {
    console.log(JSON.stringify({ ...report, budgets: args.budgets, attribution }, null, 2));
  } else {
    console.log(`Client bundle report (${args.dist}) - sizes are raw / gzip (zlib default level)\n`);
    console.log(formatRouteTable(report.rows, args.budgets));
    console.log(`\nLargest chunks (${report.chunks.length} files, ${fmtBytes(report.totals.raw)} raw / ${fmtBytes(report.totals.gz)} gzip total):\n`);
    console.log(formatChunkTable(report.chunks));
    if (report.polyfills.length) {
      console.log(`\nPolyfills (noModule, not counted): ${report.polyfills.map((p) => `${path.basename(p)} ${fmtBytes(build.sizeOf(p).raw)}`).join(", ")}`);
    }
    if (report.duplicates.length) {
      console.log("\nLikely duplicated chunks (same byte size, different route graphs):");
      for (const d of report.duplicates) console.log(`  ${fmtBytes(d.raw)}  ${d.paths.map((p) => path.basename(p)).join("  ")}`);
    }
    if (args.byPackage) {
      if (!attribution.length) {
        console.log("\n--by-package: no .map files found. Build with BUNDLE_SOURCEMAPS=1 npm run build.");
      }
      for (const a of attribution) {
        console.log(`\n${path.basename(a.chunk)} by package:`);
        for (const p of a.packages) console.log(`  ${fmtBytes(p.bytes).padStart(10)}  ${p.pkg}`);
      }
    }
    if (report.violations.length) {
      console.log("");
      for (const v of report.violations) {
        console.error(`BUDGET EXCEEDED ${v.route}: ${fmtBytes(v.jsGz)} gzip > ${fmtBytes(v.budget)} (over by ${fmtBytes(v.overBy)})`);
      }
    } else {
      console.log("\nAll budgets ok.");
    }
  }
  process.exit(report.violations.length ? 1 : 0);
}
