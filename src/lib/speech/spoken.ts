/**
 * Spoken maths: the tutor's written words (a hint, a question, a coach mark) as a child should hear
 * them. A voice reading `\frac{3}{4}` says "backslash frac", one reading `x^2` says "x caret two",
 * and `-` is a hyphen to most voices; a five-year-old needs "three quarters", "x squared", "minus".
 *
 * Pure (no DOM, no network), shared by the client (what it sends and caches) and the speak route
 * (which runs it again, so a client that forgot still gets words, never markup). Running it on its
 * own output changes nothing.
 *
 * The rules, in order:
 *  1. markup goes: HTML tags, Markdown emphasis and code ticks, links (their words stay), the
 *     `$…$`, `\(…\)`, `\[…\]` around LaTeX;
 *  2. `3/4` between whole numbers becomes a fraction (dates like 10/08/2026 are left alone);
 *  3. one left-to-right pass reads LaTeX and symbols: fractions, powers, roots, subscripts,
 *     `\text{}`, the operators (`=`, `+`, `×`, `÷`, `<`, `≤`…), and `-` by its neighbours: a hyphen
 *     in `x-axis` or `one-step`, "negative" before a number nothing is taken from, "minus" between
 *     two things;
 *  4. spaces and stray punctuation are tidied, and the result is capped at `max` characters on a
 *     sentence (else a word) boundary.
 */
import { SPEAK_MAX_CHARS } from "./contracts";

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** A fraction with one of these under the line is said by name: "three quarters", "one half". */
const DENOMINATORS: Readonly<Record<number, readonly [string, string]>> = {
  2: ["half", "halves"],
  3: ["third", "thirds"],
  4: ["quarter", "quarters"],
  5: ["fifth", "fifths"],
  6: ["sixth", "sixths"],
  7: ["seventh", "sevenths"],
  8: ["eighth", "eighths"],
  9: ["ninth", "ninths"],
  10: ["tenth", "tenths"],
  11: ["eleventh", "elevenths"],
  12: ["twelfth", "twelfths"],
};

/** LaTeX commands said as words (the spaces keep them apart from their neighbours). */
const COMMANDS: Readonly<Record<string, string>> = {
  times: " times ",
  cdot: " times ",
  ast: " times ",
  div: " divided by ",
  pm: " plus or minus ",
  mp: " minus or plus ",
  neq: " does not equal ",
  ne: " does not equal ",
  le: " is less than or equal to ",
  leq: " is less than or equal to ",
  leqslant: " is less than or equal to ",
  ge: " is greater than or equal to ",
  geq: " is greater than or equal to ",
  geqslant: " is greater than or equal to ",
  lt: " is less than ",
  gt: " is greater than ",
  approx: " is about ",
  sim: " is about ",
  equiv: " is the same as ",
  infty: " infinity ",
  degree: " degrees ",
  circ: " degrees ",
  sin: " sine ",
  cos: " cosine ",
  tan: " tangent ",
  log: " log ",
  ln: " natural log ",
  ldots: " and so on ",
  cdots: " and so on ",
  dots: " and so on ",
  to: " to ",
  rightarrow: " so ",
  Rightarrow: " so ",
  implies: " so ",
  therefore: " so ",
  angle: " angle ",
  triangle: " triangle ",
  perp: " is perpendicular to ",
  parallel: " is parallel to ",
  percent: " percent ",
  prime: " prime ",
  // layout only: nothing to say
  left: "",
  right: "",
  big: "",
  Big: "",
  bigl: "",
  bigr: "",
  Bigl: "",
  Bigr: "",
  displaystyle: "",
  textstyle: "",
  quad: " ",
  qquad: " ",
  limits: "",
  nolimits: "",
};

/** One-character commands: `\%`, `\,`, `\\`, `\{`. */
const SHORT_COMMANDS: Readonly<Record<string, string>> = {
  "%": " percent ",
  $: "",
  "{": "",
  "}": "",
  "(": " ",
  ")": " ",
  "[": " ",
  "]": " ",
  "\\": ", ",
  ",": " ",
  ";": " ",
  ":": " ",
  "!": "",
  " ": " ",
  "&": " and ",
  "#": " number ",
  _: " ",
};

/** Commands whose argument is words to read as they are. */
const TEXT_COMMANDS = new Set(["text", "textbf", "textit", "textrm", "mathrm", "mathbf", "mathit", "mathsf", "operatorname", "mbox", "emph", "boldsymbol", "mathbb", "mathcal", "overline", "underline", "vec", "hat", "bar"]);
const FRACTION_COMMANDS = new Set(["frac", "dfrac", "tfrac", "cfrac"]);

/** Symbols said as words. `-`, `/`, `'`, `:` and the brackets depend on their neighbours (below). */
const SYMBOLS: Readonly<Record<string, string>> = {
  "=": " equals ",
  "+": " plus ",
  "×": " times ",
  "·": " times ",
  "⋅": " times ",
  "∙": " times ",
  "*": " times ",
  "÷": " divided by ",
  "±": " plus or minus ",
  "≠": " does not equal ",
  "≤": " is less than or equal to ",
  "≥": " is greater than or equal to ",
  "<": " is less than ",
  ">": " is greater than ",
  "≈": " is about ",
  "%": " percent ",
  "°": " degrees ",
  "π": " pi ",
  "√": " the square root of ",
  "∞": " infinity ",
  "²": " squared ",
  "³": " cubed ",
  "½": " one half ",
  "¼": " one quarter ",
  "¾": " three quarters ",
  "⅓": " one third ",
  "⅔": " two thirds ",
  "→": " so ",
  "⇒": " so ",
  "∴": " so ",
  "–": ", ",
  "—": ", ",
  "&": " and ",
  $: "",
  "{": "",
  "}": "",
};

/** Before a `-` that takes nothing away: it says "negative" (`= -3`, `(-2)`, `× -2`, the start). */
const UNARY_BEFORE = new Set(["=", "+", "-", "−", "×", "÷", "*", "/", "(", "[", "<", ">", "≤", "≥", "≠", ",", ":", "^", "{", "±", "·"]);

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isLetter = (c: string | undefined) => c !== undefined && /\p{L}/u.test(c);
const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);

/** The letters touching position `i` on its left (none when a space or symbol is there). */
function lettersBefore(src: string, i: number): string {
  let j = i;
  while (j > 0 && isLetter(src[j - 1])) j--;
  return src.slice(j, i);
}

/** The letters starting at `i`. */
function lettersFrom(src: string, i: number): string {
  let j = i;
  while (j < src.length && isLetter(src[j])) j++;
  return src.slice(i, j);
}

function prevNonSpace(src: string, i: number): { ch: string | undefined; at: number } {
  let j = i - 1;
  while (j >= 0 && isSpace(src[j])) j--;
  return { ch: j >= 0 ? src[j] : undefined, at: j };
}

function nextNonSpace(src: string, i: number): { ch: string | undefined; at: number } {
  let j = i + 1;
  while (j < src.length && isSpace(src[j])) j++;
  return { ch: j < src.length ? src[j] : undefined, at: j };
}

/**
 * A fraction as words: by name when both parts are whole numbers and the bottom is 2..12 ("one
 * half", "three quarters", "five eighths"), else "3 over 7" ("x plus 1, all over 2" when the top
 * is more than one thing, so the pause shows where the line is). The parts come already spoken.
 */
export function fractionWords(num: string, den: string): string {
  const n = num.trim();
  const d = den.trim();
  const negative = /^negative (\d+)$/.exec(n);
  if (negative) return `negative ${fractionWords(negative[1], d)}`;
  if (/^\d+$/.test(n) && /^\d+$/.test(d)) {
    const top = Number(n);
    const names = DENOMINATORS[Number(d)];
    if (names && top >= 1 && top <= 12) return `${NUMBER_WORDS[top]} ${top === 1 ? names[0] : names[1]}`;
  }
  return /\s/.test(n) ? `${n}, all over ${d}` : `${n} over ${d}`;
}

/** A power as words, from the exponent as written and as spoken: "squared", "cubed", "to the power of 4". */
export function powerWords(raw: string, spoken: string): string {
  const r = raw.trim();
  if (r === "\\circ" || r === "°" || r === "o") return "degrees";
  if (r === "\\prime" || r === "'") return "prime";
  const s = spoken.trim();
  if (s === "2") return "squared";
  if (s === "3") return "cubed";
  return s ? `to the power of ${s}` : "";
}

/** An argument after `^`, `_` or a command: a `{…}` group (balanced), a command, or one character. */
function readArg(src: string, from: number): { raw: string; text: string; end: number } {
  let i = from;
  while (i < src.length && src[i] === " ") i++;
  if (i >= src.length) return { raw: "", text: "", end: i };
  if (src[i] === "{") {
    let depth = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === "\\") {
        j++;
        continue;
      }
      if (src[j] === "{") depth++;
      else if (src[j] === "}") {
        depth--;
        if (depth === 0) {
          const inner = src.slice(i + 1, j);
          return { raw: inner, text: inner, end: j + 1 };
        }
      }
    }
    const inner = src.slice(i + 1);
    return { raw: inner, text: inner, end: src.length };
  }
  if (src[i] === "\\") {
    const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
    const tok = m ? m[0] : "\\";
    return { raw: tok, text: tok, end: i + tok.length };
  }
  return { raw: src[i], text: src[i], end: i + 1 };
}

/** `[n]` after `\sqrt`, when there is one. */
function readOptional(src: string, from: number): { text: string; end: number } | null {
  let i = from;
  while (i < src.length && src[i] === " ") i++;
  if (src[i] !== "[") return null;
  const close = src.indexOf("]", i);
  if (close < 0) return null;
  return { text: src.slice(i + 1, close), end: close + 1 };
}

/** A root as words: "the square root of x", "the cube root of 8", "the 5th root of y". */
function rootWords(index: string | null, radicand: string): string {
  const n = index?.trim();
  if (!n || n === "2") return ` the square root of ${radicand} `;
  if (n === "3") return ` the cube root of ${radicand} `;
  return ` the ${n}th root of ${radicand} `;
}

/** What a `-` (or `−`) at `i` is: a hyphen, a pause, "negative" or "minus". */
function dashWords(src: string, i: number): string {
  const typedMinus = src[i] === "−";
  const before = lettersBefore(src, i);
  const after = lettersFrom(src, i + 1);
  if (!typedMinus) {
    // a hyphenated word: a word of two or more letters touches it (`x-axis`, `one-step`)
    if (before.length >= 2 || after.length >= 2) return "-";
    // a dash between words in a sentence ("Good - now try"): a pause
    const p = prevNonSpace(src, i);
    const n = nextNonSpace(src, i);
    if (isSpace(src[i - 1]) && isSpace(src[i + 1]) && lettersBefore(src, p.at + 1).length >= 2 && lettersFrom(src, n.at).length >= 2) return ", ";
  }
  const prev = prevNonSpace(src, i);
  const next = nextNonSpace(src, i).ch;
  const startsSomething = isDigit(next) || isLetter(next) || next === "(" || next === "\\" || next === "{" || next === ".";
  const unary = prev.ch === undefined || UNARY_BEFORE.has(prev.ch) || lettersBefore(src, prev.at + 1).length >= 2;
  if (unary && startsSomething) return " negative ";
  return " minus ";
}

/** The one pass over LaTeX and symbols (rule 3). Recursive for groups. */
function speakPass(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === "\\") {
      const m = /^\\([A-Za-z]+|.)?/.exec(src.slice(i));
      const name = m?.[1] ?? "";
      i += 1 + name.length;
      if (!name) continue;
      if (FRACTION_COMMANDS.has(name)) {
        const a = readArg(src, i);
        const b = readArg(src, a.end);
        const whole = isDigit(prevNonSpace(src, i - 1 - name.length).ch);
        const words = fractionWords(tidy(speakPass(a.text)), tidy(speakPass(b.text)));
        out += `${whole && /^(negative )?\p{L}/u.test(words) && !/ over /.test(words) ? " and " : " "}${words} `;
        i = b.end;
        continue;
      }
      if (name === "sqrt") {
        const opt = readOptional(src, i);
        const a = readArg(src, opt ? opt.end : i);
        out += rootWords(opt ? tidy(speakPass(opt.text)) : null, tidy(speakPass(a.text)));
        i = a.end;
        continue;
      }
      if (TEXT_COMMANDS.has(name)) {
        const a = readArg(src, i);
        out += ` ${speakPass(a.text)} `;
        i = a.end;
        continue;
      }
      if (name === "left" || name === "right") {
        // `\left.` / `\right.` is an invisible delimiter
        if (src[i] === ".") i++;
        continue;
      }
      if (name.length === 1 && !isLetter(name)) {
        out += SHORT_COMMANDS[name] ?? " ";
        continue;
      }
      const word = COMMANDS[name];
      out += word !== undefined ? word : ` ${name} `;
      continue;
    }

    if (c === "^") {
      const a = readArg(src, i + 1);
      out += ` ${powerWords(a.raw, tidy(speakPass(a.text)))} `;
      i = a.end;
      continue;
    }

    if (c === "_") {
      const a = readArg(src, i + 1);
      out += ` ${speakPass(a.text)} `;
      i = a.end;
      continue;
    }

    if (c === "-" || c === "−") {
      out += dashWords(src, i);
      i++;
      continue;
    }

    if (c === "/") {
      // between words it is "or" (`and/or`), between maths "over" (`x/2`); between numbers that
      // were no fraction (rule 2) it is a date, which voices read well as written
      const words = lettersBefore(src, i).length >= 2 && lettersFrom(src, i + 1).length >= 2;
      out += words ? " or " : isDigit(src[i - 1]) && isDigit(src[i + 1]) ? "/" : " over ";
      i++;
      continue;
    }

    if (c === "(" || c === "[") {
      // `3(x + 2)`, `(x + 1)(x - 1)`: the brackets multiply
      const prev = prevNonSpace(src, i).ch;
      out += c === "(" && (isDigit(prev) || prev === ")") ? " times " : " ";
      i++;
      continue;
    }
    if (c === ")" || c === "]") {
      out += " ";
      i++;
      continue;
    }

    if (c === "'" && lettersBefore(src, i).length === 1 && !isLetter(src[i + 1])) {
      out += " prime ";
      i++;
      continue;
    }

    if (c === ":" && isDigit(src[i - 1]) && isDigit(src[i + 1])) {
      out += " to ";
      i++;
      continue;
    }

    const symbol = SYMBOLS[c];
    if (symbol !== undefined) {
      out += symbol;
      i++;
      continue;
    }

    out += c;
    // `2x` is "2 x" (a voice reads "2x" as "twice"); `2nd`, `10am` stay as they are
    if (isDigit(c) && isLetter(src[i + 1]) && !isLetter(src[i + 2])) out += " ";
    i++;
  }
  return out;
}

/** Rule 1: markup that is no words. */
function stripMarkup(text: string): string {
  return text
    .replace(/<\/?[a-z][^<>]*>/gi, " ")
    .replace(/\[([^\]]+)\]\((?:https?:|\/)[^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\s)[*_](\S[^*_]*?\S|\S)[*_](?=\s|[.,!?;:]|$)/g, "$1$2")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/\$\$?|\\\(|\\\)|\\\[|\\\]/g, " ");
}

/** Rule 2: `3/4` between whole numbers is a fraction (not inside a date or a longer run). */
function plainFractions(text: string): string {
  return text.replace(/(?<![\d./])(\d+)\s*\/\s*(\d+)(?![\d./])/g, "\\frac{$1}{$2}");
}

/** Spaces and punctuation after the pass: one space, none before a stop, no doubled commas. */
function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/,(\s*,)+/g, ",")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();
}

/**
 * At most `max` characters: whole sentences when the first ones fill at least half of it, else
 * whole words, ending with a full stop rather than a word cut in two.
 */
export function capSpoken(text: string, max: number = SPEAK_MAX_CHARS): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  const sentenceEnd = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  if (sentenceEnd >= max / 2) return text.slice(0, sentenceEnd + 1);
  const space = head.lastIndexOf(" ");
  const cut = (space > 0 ? text.slice(0, space) : text.slice(0, max - 1)).replace(/[\s,;:-]+$/, "");
  return `${cut}.`.slice(0, max);
}

/**
 * The words to say for `text` (a hint, a question, a coach mark), at most `max` characters; ""
 * when nothing is left to say (markup only). Never throws.
 */
export function spokenText(text: string, max: number = SPEAK_MAX_CHARS): string {
  if (typeof text !== "string" || !text.trim()) return "";
  try {
    return capSpoken(tidy(speakPass(plainFractions(stripMarkup(text)))), max);
  } catch {
    return capSpoken(tidy(text.replace(/[\\{}$^_]/g, " ")), max);
  }
}
