/**
 * Unit tests for the pure aggregation in scripts/check-bundle.mjs, driven by fixture manifests
 * shaped like the Next 16.2 (Turbopack) output. No filesystem, no build.
 */
import { describe, expect, it } from "vitest";
import {
  BUDGETS,
  aggregateRoutes,
  attributeSourceMap,
  checkBudgets,
  collectRouteFiles,
  decodeMappingsLine,
  findLikelyDuplicateChunks,
  fmtBytes,
  formatRouteTable,
  packageOf,
  parseArgs,
  parseClientReferenceManifest,
  routeFromManifestPath,
  sourceMapUrlOf,
} from "../../scripts/check-bundle.mjs";

const LAYOUT = "[project]/src/app/layout";
const ROOT_MAIN = ["static/chunks/main-a.js", "static/chunks/main-b.js"];

const buildManifest = {
  rootMainFiles: ROOT_MAIN,
  polyfillFiles: ["static/chunks/polyfill.js"],
};

const boardManifest = {
  entryJSFiles: {
    [LAYOUT]: ["static/chunks/layout.js", "static/chunks/supabase.js"],
    "[project]/src/app/error": ["static/chunks/layout.js", "static/chunks/error.js"],
    "[project]/src/app/board/[id]/page": ["static/chunks/layout.js", "static/chunks/tldraw-board.js", "static/chunks/board.js"],
  },
  entryCSSFiles: {
    [LAYOUT]: [{ path: "static/chunks/globals.css", inlined: false }],
    "[project]/src/app/board/[id]/page": [
      { path: "static/chunks/globals.css", inlined: false },
      { path: "static/chunks/tldraw.css", inlined: false },
      { path: "static/chunks/inlined.css", inlined: true },
    ],
  },
};

const trainManifest = {
  entryJSFiles: {
    [LAYOUT]: ["static/chunks/layout.js", "static/chunks/supabase.js"],
    "[project]/src/app/train/page": ["static/chunks/tldraw-train.js", "static/chunks/train.js"],
  },
  entryCSSFiles: {
    [LAYOUT]: [{ path: "static/chunks/globals.css", inlined: false }],
  },
};

const rootManifest = {
  entryJSFiles: {
    [LAYOUT]: ["static/chunks/layout.js", "static/chunks/supabase.js"],
    "[project]/src/app/page": ["static/chunks/home.js"],
  },
  entryCSSFiles: {},
};

// raw sizes; gzip is modelled as raw / 4 so the two columns stay distinguishable
const RAW: Record<string, number> = {
  "static/chunks/main-a.js": 100_000,
  "static/chunks/main-b.js": 50_000,
  "static/chunks/layout.js": 20_000,
  "static/chunks/supabase.js": 80_000,
  "static/chunks/error.js": 4_000,
  "static/chunks/tldraw-board.js": 1_000_000,
  "static/chunks/tldraw-train.js": 1_000_000,
  "static/chunks/board.js": 60_000,
  "static/chunks/train.js": 10_000,
  "static/chunks/home.js": 30_000,
  "static/chunks/globals.css": 16_000,
  "static/chunks/tldraw.css": 8_000,
  "static/chunks/polyfill.js": 110_000,
};
const sizeOf = (p: string) => {
  if (!(p in RAW)) throw new Error(`fixture has no size for ${p}`);
  return { raw: RAW[p], gz: RAW[p] / 4 };
};

const routes = [
  { route: "/board/[id]", buildManifest, manifest: boardManifest },
  { route: "/train", buildManifest, manifest: trainManifest },
  { route: "/", buildManifest, manifest: rootManifest },
];

describe("parseClientReferenceManifest", () => {
  it("reads the object assigned to the route key, not the `|| {}` fallback", () => {
    const src =
      'globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n' +
      'globalThis.__RSC_MANIFEST["/board/[id]/page"] = {"moduleLoading":{"prefix":""},"entryJSFiles":{"[project]/src/app/board/[id]/page":["static/chunks/a.js"]},"entryCSSFiles":{}};';
    expect(parseClientReferenceManifest(src)).toEqual({
      entryJSFiles: { "[project]/src/app/board/[id]/page": ["static/chunks/a.js"] },
      entryCSSFiles: {},
    });
  });

  it("defaults missing maps to empty objects and rejects non-manifest input", () => {
    expect(parseClientReferenceManifest('x["/p"] = {}')).toEqual({ entryJSFiles: {}, entryCSSFiles: {} });
    expect(() => parseClientReferenceManifest("nothing here")).toThrow(/no JSON object/);
  });
});

describe("routeFromManifestPath", () => {
  it("maps manifest locations to app routes", () => {
    expect(routeFromManifestPath("page_client-reference-manifest.js")).toBe("/");
    expect(routeFromManifestPath("board/[id]/page_client-reference-manifest.js")).toBe("/board/[id]");
    expect(routeFromManifestPath("(marketing)/pricing/page_client-reference-manifest.js")).toBe("/pricing");
    expect(routeFromManifestPath("train\\page_client-reference-manifest.js")).toBe("/train");
  });

  it("rejects route handlers and other files", () => {
    expect(() => routeFromManifestPath("api/ocr/route_client-reference-manifest.js")).toThrow(/not a page manifest/);
  });
});

describe("collectRouteFiles", () => {
  it("unions runtime, layout, boundary and page chunks once each and skips polyfills", () => {
    const { js, css, pageJs } = collectRouteFiles(buildManifest, boardManifest, "/board/[id]");
    expect(js).toEqual([
      "static/chunks/main-a.js",
      "static/chunks/main-b.js",
      "static/chunks/layout.js",
      "static/chunks/supabase.js",
      "static/chunks/error.js",
      "static/chunks/tldraw-board.js",
      "static/chunks/board.js",
    ]);
    expect(js).not.toContain("static/chunks/polyfill.js");
    expect(pageJs).toEqual(["static/chunks/layout.js", "static/chunks/tldraw-board.js", "static/chunks/board.js"]);
    expect(css).toEqual(["static/chunks/globals.css", "static/chunks/tldraw.css"]);
  });

  it("finds the page segment for the root route", () => {
    expect(collectRouteFiles(buildManifest, rootManifest, "/").pageJs).toEqual(["static/chunks/home.js"]);
  });
});

describe("aggregateRoutes", () => {
  it("sums raw and gzip per route and sorts heaviest first", () => {
    const rows = aggregateRoutes(routes, sizeOf);
    expect(rows.map((r) => r.route)).toEqual(["/board/[id]", "/train", "/"]);
    const board = rows[0];
    expect(board.jsRaw).toBe(100_000 + 50_000 + 20_000 + 80_000 + 4_000 + 1_000_000 + 60_000);
    expect(board.jsGz).toBe(board.jsRaw / 4);
    expect(board.cssRaw).toBe(24_000);
    expect(board.cssGz).toBe(6_000);
    expect(rows[2].jsRaw).toBe(100_000 + 50_000 + 20_000 + 80_000 + 30_000);
  });
});

describe("checkBudgets", () => {
  const rows = aggregateRoutes(routes, sizeOf);

  it("passes when under budget and reports the overage when not", () => {
    const boardGz = rows[0].jsGz;
    expect(checkBudgets(rows, { "/board/[id]": boardGz })).toEqual([]);
    expect(checkBudgets(rows, { "/board/[id]": boardGz - 1 })).toEqual([
      { route: "/board/[id]", jsGz: boardGz, budget: boardGz - 1, overBy: 1 },
    ]);
  });

  it("ignores budgets for routes that are not in the build", () => {
    expect(checkBudgets(rows, { "/gone": 1 })).toEqual([]);
  });

  it("ships with a budget for the board route", () => {
    expect(BUDGETS["/board/[id]"]).toBeGreaterThan(0);
  });
});

describe("findLikelyDuplicateChunks", () => {
  it("groups equal-size chunks above the threshold", () => {
    const chunks = Object.entries(RAW).map(([p, raw]) => ({ path: p, raw }));
    expect(findLikelyDuplicateChunks(chunks)).toEqual([
      { raw: 1_000_000, paths: ["static/chunks/tldraw-board.js", "static/chunks/tldraw-train.js"] },
    ]);
    // main-a (100 KB) is unique; layout.js / supabase.js are different sizes - none reported
    expect(findLikelyDuplicateChunks(chunks, 1)).toHaveLength(1);
  });
});

describe("parseArgs", () => {
  it("parses flags in both spellings and overrides budgets", () => {
    const args = parseArgs(["--dist", "out", "--json", "--budget", "/board/[id]=123", "--budget=/train=9"]);
    expect(args.dist).toBe("out");
    expect(args.json).toBe(true);
    expect(args.budgets["/board/[id]"]).toBe(123);
    expect(args.budgets["/train"]).toBe(9);
    expect(parseArgs([]).budgets).toEqual(BUDGETS);
    expect(parseArgs(["--by-package"]).byPackage).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(() => parseArgs(["--budget", "nope"])).toThrow(/--budget expects/);
    expect(() => parseArgs(["--budget", "/x=abc"])).toThrow(/--budget expects/);
    expect(() => parseArgs(["--wat"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--dist"])).toThrow(/needs a value/);
  });
});

describe("formatting", () => {
  it("formats bytes with sensible units", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(2048)).toBe("2.0 KB");
    expect(fmtBytes(3 * 1024 * 1024)).toBe("3.00 MB");
  });

  it("renders a table with budget status", () => {
    const rows = aggregateRoutes(routes, sizeOf);
    const table = formatRouteTable(rows, { "/board/[id]": 1 });
    expect(table).toContain("/board/[id]");
    expect(table).toContain("OVER");
    expect(table.split("\n")[0]).toMatch(/^Route/);
  });
});

describe("source-map attribution", () => {
  it("follows the trailing sourceMappingURL comment (Turbopack hashes the map name separately)", () => {
    expect(sourceMapUrlOf('console.log(1);\n\n//# sourceMappingURL=0g3bn4jo9o~~p.js.map\n')).toBe("0g3bn4jo9o~~p.js.map");
    expect(sourceMapUrlOf("//# sourceMappingURL=data:application/json;base64,e30=")).toBeNull();
    expect(sourceMapUrlOf("no map here")).toBeNull();
  });

  it("decodes VLQ mappings with cross-line source indices", () => {
    const state = { src: 0 };
    // AAAA = col 0, src +0; ICAA = col +4, src +1
    expect(decodeMappingsLine("AAAA,ICAA", state)).toEqual([
      { col: 0, src: 0 },
      { col: 4, src: 1 },
    ]);
    // next line: "AAAA" keeps src 1 (relative, carried over); a segment without a source has src -1
    expect(decodeMappingsLine("AAAA,C", state)).toEqual([
      { col: 0, src: 1 },
      { col: 1, src: -1 },
    ]);
  });

  it("names packages from source paths", () => {
    expect(packageOf("[project]/node_modules/tldraw/dist-esm/index.mjs")).toBe("tldraw");
    expect(packageOf("[project]/node_modules/@tldraw/editor/dist-esm/x.mjs")).toBe("@tldraw/editor");
    expect(packageOf("turbopack:///[project]/src/app/board/[id]/page.tsx")).toBe("(app) src/app");
    // pdfjs-dist ships its own nested source map, so its sources never mention node_modules
    expect(packageOf("webpack://pdf.js/./src/display/api.js")).toBe("pdf.js");
    expect(packageOf("[turbopack]/browser/runtime.ts")).toBe("(turbopack runtime)");
    expect(packageOf("weird")).toBe("(other)");
  });

  it("attributes generated bytes to the owning source until the next segment", () => {
    // line 0 is 10 chars: cols 0-3 -> sources[0] (katex), cols 4-9 -> sources[1] (tldraw)
    const map = {
      sources: ["[project]/node_modules/katex/dist/katex.mjs", "[project]/node_modules/tldraw/dist-esm/a.mjs"],
      mappings: "AAAA,ICAA",
    };
    expect(attributeSourceMap(map, "0123456789")).toEqual([
      { pkg: "tldraw", bytes: 6 },
      { pkg: "katex", bytes: 4 },
    ]);
  });
});
