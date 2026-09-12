import katex from "katex";

/**
 * LaTeX -> HTML string via KaTeX. Never throws: KaTeX renders parse errors as the raw
 * source in red (`throwOnError: false`), and anything else falls back to escaped text.
 * Pure (no DOM), so it is safe under vitest's node environment and in `toSvg`.
 */
export function renderLatex(latex: string, opts: { displayMode?: boolean } = {}): string {
  const src = latex.replace(/^\$+|\$+$/g, "").trim();
  if (!src) return "";
  try {
    return katex.renderToString(src, {
      throwOnError: false,
      displayMode: opts.displayMode ?? false,
      strict: "ignore",
      output: "html",
      trust: false,
    });
  } catch {
    return `<span class="live-math__raw">${escapeHtml(src)}</span>`;
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
