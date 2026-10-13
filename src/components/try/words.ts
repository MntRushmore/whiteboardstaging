/**
 * A line of the try board's LaTeX as a screen reader should say it: "6 times 7", "2 over 7 plus 3
 * over 7", "x squared". The try board's problems are the onboarding's starters (arithmetic,
 * fractions, equations, a few powers, roots, logs and angles), so this knows those and, for
 * anything else, drops the LaTeX's markup rather than reading it out. Pure.
 */

const WORDS: ReadonlyArray<[RegExp, string]> = [
  [/\\left|\\right/g, ""],
  [/\\(?:d|t)?frac\{([^{}]*)\}\{([^{}]*)\}/g, " $1 over $2 "],
  [/\\sqrt\{([^{}]*)\}/g, " the square root of $1 "],
  [/\^\{\\circ\}|\^\\circ|°/g, " degrees "],
  [/\^\{2\}|\^2(?!\d)/g, " squared "],
  [/\^\{3\}|\^3(?!\d)/g, " cubed "],
  [/\^\{([^{}]*)\}/g, " to the power $1 "],
  [/\^(\w)/g, " to the power $1 "],
  [/\\log_\{([^{}]*)\}/g, " log base $1 of "],
  [/\\(sin|cos|tan)\b/g, " $1 "],
  [/\\times|\\cdot|×/g, " times "],
  [/\\div|÷/g, " divided by "],
  [/\\pm/g, " plus or minus "],
  [/\\neq/g, " is not equal to "],
  [/\\le(?:q)?\b/g, " is at most "],
  [/\\ge(?:q)?\b/g, " is at least "],
  [/\\pi\b/g, " pi "],
  [/\+/g, " plus "],
  [/(^\s*|[(=]\s*)-(?=\s*[\da-z(])/gi, "$1 negative "],
  [/-|−/g, " minus "],
  [/=/g, " equals "],
  [/</g, " is less than "],
  [/>/g, " is greater than "],
  [/\\[a-zA-Z]+/g, " "],
  [/[{}\\]/g, " "],
];

export function latexWords(latex: string): string {
  let text = latex;
  for (const [pattern, words] of WORDS) text = text.replace(pattern, words);
  return text.replace(/\s+/g, " ").trim();
}
