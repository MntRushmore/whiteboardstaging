// Browser-side PDF rendering helper. Uses pdfjs-dist with the published
// worker file from a CDN — avoids bundler-specific worker setup that can
// break under Turbopack.
//
// The LEGACY build, page and worker alike: pdf.js 5's modern build calls Map.getOrInsertComputed,
// Promise.try, URL.parse and Promise.withResolvers without a fallback, which iPadOS Safari only has
// from 26.x (17.4 for withResolvers). On an iPad on iPadOS 16.4–18 a PDF never opened ("Couldn't
// read this PDF", or "Reading PDF…" for ever). The legacy build carries those as polyfills and
// targets Safari 16.4, the app's own floor (Next's browserslist). It is only ever lazy-loaded.

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<Pdfjs> | null = null;

/** The worker matching `version`, from the legacy build (an ES module: pdf.js 4+ workers are). */
export function pdfWorkerUrl(version: string): string {
  return `https://unpkg.com/pdfjs-dist@${version}/legacy/build/pdf.worker.min.mjs`;
}

export async function loadPdfjs(): Promise<Pdfjs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl(pdfjs.version);
      return pdfjs;
    })();
    // a failed load (offline, a CDN hiccup) is tried again next time, not remembered for good
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

export type PdfPagePreview = {
  pageNumber: number;
  thumbnailUrl: string;
  width: number;
  height: number;
};

/** Load a PDF from a File and return small thumbnails for every page. */
export async function loadPdfThumbnails(
  file: File,
  maxPages = 20,
): Promise<PdfPagePreview[]> {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const out: PdfPagePreview[] = [];
  const total = Math.min(doc.numPages, maxPages);

  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 0.4 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    out.push({
      pageNumber: i,
      thumbnailUrl: canvas.toDataURL("image/png"),
      width: viewport.width,
      height: viewport.height,
    });
  }

  return out;
}

/** Render a specific PDF page to a high-resolution PNG data URL. */
export async function renderPdfPage(
  file: File,
  pageNumber: number,
  /** Target the rendered page to be at most this wide in CSS pixels. */
  maxWidthPx = 1600,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const page = await doc.getPage(pageNumber);

  // Choose a scale so the rendered page is up to maxWidthPx wide.
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(maxWidthPx / baseViewport.width, 3);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D context");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: viewport.width,
    height: viewport.height,
  };
}
