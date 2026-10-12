import katex from "katex";

/**
 * The panel's maths, typeset by KaTeX. A dynamic import (`AskMessage`), fetched only once a reply
 * holds a formula; KaTeX's stylesheet is already global (`globals.css`). `trust` is off, so no
 * `\href` or HTML extension gets through, and a formula KaTeX cannot read answers null: the panel
 * shows it as plain words (`mathAsText`) rather than KaTeX's red source.
 */
export function renderAskMath(src: string, display: boolean): string | null {
  try {
    return katex.renderToString(askMathSource(src, display), {
      displayMode: display,
      throwOnError: true,
      strict: "ignore",
      trust: false,
      // MathML beside the HTML: a screen reader reads the formula, not its glyphs
      output: "htmlAndMathml",
      maxSize: 10,
      maxExpand: 200,
    });
  } catch {
    return null;
  }
}

/**
 * A formula as KaTeX gets it. An inline fraction is set as big as a display one: TeX's inline ½
 * shrinks its digits to about 70%, too small for a young reader (a `\tfrac` written on purpose
 * stays small).
 */
export function askMathSource(src: string, display: boolean): string {
  return !display && /\\(?:d?frac|binom)\b/.test(src) ? `\\displaystyle ${src}` : src;
}
