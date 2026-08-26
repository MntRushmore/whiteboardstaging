const MATHY = /[=^_\\]|[+\-*/]\s*\d|\d\s*[+\-*/=]|\\frac|\\int|\\sqrt|\\mathrm/;
const LEAD_WORD = /^(so|thus|then|hence|and|or|if|let|now|but|yes|no|try|see|use|step)$/i;

export function stripMathDelimiters(text: string): string {
  return text
    .trim()
    .replace(/^\$+|\$+$/g, "")
    .replace(/^\\\(|\\\)$/g, "")
    .replace(/^\\\[|\\\]$/g, "")
    .trim();
}

/**
 * Solve notes: handwritten lead-in words + KaTeX for the equation.
 * Socratic copy should not use this — those stay all ink.
 */
export function splitSolveNote(text: string): { leadIn: string; math: string } {
  const t = text.trim();
  if (!t) return { leadIn: "", math: "" };

  const dollar = t.match(/^([^$]*?)\$([^$]+)\$\s*$/);
  if (dollar) {
    return { leadIn: dollar[1].trim(), math: stripMathDelimiters(dollar[2]) };
  }

  const labeled = t.match(/^([A-Za-z][A-Za-z\s]{0,24}:)\s*(.+)$/);
  if (labeled && MATHY.test(labeled[2])) {
    return { leadIn: labeled[1], math: stripMathDelimiters(labeled[2]) };
  }

  const wordsThenMath = t.match(/^((?:[A-Za-z]+[,\s]+){1,8})(.+)$/);
  if (
    wordsThenMath &&
    MATHY.test(wordsThenMath[2]) &&
    !MATHY.test(wordsThenMath[1])
  ) {
    const words = wordsThenMath[1].trim().split(/\s+/);
    if (words.length >= 2 || LEAD_WORD.test(words[0] ?? "") || (words[0]?.length ?? 0) > 3) {
      return { leadIn: wordsThenMath[1].trim(), math: stripMathDelimiters(wordsThenMath[2]) };
    }
  }

  if (MATHY.test(t) && t.split(/\s+/).length <= 10) {
    return { leadIn: "", math: stripMathDelimiters(t) };
  }

  return { leadIn: t, math: "" };
}

export function estimateKatexSize(latex: string): { w: number; h: number } {
  const compact = latex.replace(/\s+/g, "");
  return {
    w: Math.min(280, Math.max(36, compact.length * 8 + 8)),
    h: 22,
  };
}
