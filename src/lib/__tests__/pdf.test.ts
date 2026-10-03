/**
 * The PDF reader loads pdf.js's legacy build, page and worker: the modern build needs APIs that
 * iPadOS Safari only has from 26.x (Map.getOrInsertComputed, Promise.try, URL.parse), so a PDF
 * never opened on an iPad on iPadOS 16.4–18 (docs/QA-2026-10-03-webkit.md).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loads = vi.hoisted(() => ({ count: 0 }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => {
  loads.count++;
  return { version: "9.9.9", GlobalWorkerOptions: { workerSrc: "" } };
});
vi.mock("pdfjs-dist", () => {
  throw new Error("the modern pdf.js build must not be loaded");
});

beforeEach(() => {
  vi.resetModules();
  loads.count = 0;
});

describe("pdf.js loading", () => {
  it("loads the legacy build and points the worker at the legacy worker of the same version", async () => {
    const { loadPdfjs } = await import("../pdf");
    const pdfjs = await loadPdfjs();
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe("https://unpkg.com/pdfjs-dist@9.9.9/legacy/build/pdf.worker.min.mjs");
    expect(loads.count).toBe(1);
  });

  it("the worker URL is the legacy build's", async () => {
    const { pdfWorkerUrl } = await import("../pdf");
    expect(pdfWorkerUrl("5.7.284")).toBe("https://unpkg.com/pdfjs-dist@5.7.284/legacy/build/pdf.worker.min.mjs");
  });

  it("a failed load is tried again on the next read, not cached", async () => {
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", () => {
      throw new Error("chunk failed to load");
    });
    const { loadPdfjs } = await import("../pdf");
    await expect(loadPdfjs()).rejects.toThrow();
    await Promise.resolve();
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ version: "9.9.9", GlobalWorkerOptions: { workerSrc: "" } }));
    await expect(loadPdfjs()).resolves.toMatchObject({ version: "9.9.9" });
  });

  it("the shipped legacy build polyfills what older Safari lacks", () => {
    // pdf.js's own legacy bundle, the file this module imports: core-js shims for the APIs the
    // modern build calls bare (a pdf.js upgrade that drops them fails here, not on an iPad)
    const src = readFileSync(new URL("../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs", import.meta.url), "utf8");
    for (const api of ["getOrInsertComputed", "withResolvers", "`URL.parse` method"]) expect(src).toContain(api);
    expect(src).toMatch(/Promise\['try'\]/);
  });
});
