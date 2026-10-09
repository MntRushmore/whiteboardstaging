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
 *     `$…$`, `\(…\)`, `\[…\]` around LaTeX; a fill-in blank (`3 + __ = 5`) is "blank";
 *  2. `|x − 3|` (and `\left|…\right|`, `\lvert…\rvert`) is "the absolute value of x minus 3";
 *  3. `3/4` between whole numbers becomes a fraction, at the end of a sentence too (dates like
 *     10/08/2026 and decimals like 1/2.5 are left alone);
 *  4. one left-to-right pass reads LaTeX and symbols: fractions, powers, roots, subscripts,
 *     `\text{}`, the operators (`=`, `+`, `×`, `÷`, `<`, `≤`…), and `-` by its neighbours: a hyphen
 *     in `x-axis` or `one-step`, "negative" before a number nothing is taken from (a new sentence
 *     included), "minus" between two things. A bracket around a sum or a difference, or under a
 *     power, is said ("open bracket 3 plus 4 close bracket times 2"); one around a single thing
 *     (`(−2)`, `f(x)`) is not. A fraction's bottom, or an exponent, that is more than one thing is
 *     said so the group is heard ("the fraction with 1 on top and x plus 1 on the bottom", "2 to
 *     the x plus 1 power");
 *  5. spaces and stray punctuation are tidied, and the result is capped at `max` characters on a
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
  // a box to fill in: `3 + \square = 5`
  square: " blank ",
  Box: " blank ",
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
  "□": " blank ",
  "☐": " blank ",
  // an absolute-value bar without its pair (rule 2 reads the pairs)
  "|": " ",
  $: "",
  "{": "",
  "}": "",
};

/**
 * Before a `-` that takes nothing away: it says "negative" (`= -3`, `(-2)`, `× -2`, the start, a
 * new sentence as in `Good. -2 is right`, an opening quote as in `“-3”`).
 */
const UNARY_BEFORE = new Set(["=", "+", "-", "−", "×", "÷", "*", "/", "(", "[", "<", ">", "≤", "≥", "≠", ",", ":", "^", "{", "±", "·", ".", "?", "!", ";", "“", "‘"]);

/** Spoken operators: words with one of these in them are more than one thing. */
const COMPOUND_WORDS = / (plus|minus|times|over|divided by|equals|plus or minus|minus or plus) /;

/** Already spoken words that are more than one term ("x plus 1"; never "negative 1" or "2 x"). */
function compound(spoken: string): boolean {
  return COMPOUND_WORDS.test(` ${spoken} `);
}

/** What makes a bracketed group more than one thing (a relation like `=` does not: that is prose). */
const GROUPING_SYMBOLS = new Set(["+", "×", "÷", "*", "±", "·", "⋅", "∙"]);
const GROUPING_COMMANDS = new Set(["times", "cdot", "ast", "div", "pm", "mp"]);

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
 * is more than one thing, so the pause shows where the line is; "the fraction with 12 on top and 4
 * plus 2 on the bottom" when the bottom is, since "12 over 4 plus 2" is another number). The parts
 * come already spoken.
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
  if (compound(d)) return `the fraction with ${n} on top and ${d} on the bottom`;
  return /\s/.test(n) ? `${n}, all over ${d}` : `${n} over ${d}`;
}

/**
 * A power as words, from the exponent as written and as spoken: "squared", "cubed", "to the power
 * of 4", and "to the x plus 1 power" when the exponent is more than one thing (the closing word
 * ends the group: "2 to the power of x plus 1" is 2^x + 1).
 */
export function powerWords(raw: string, spoken: string): string {
  const r = raw.trim();
  if (r === "\\circ" || r === "°" || r === "o") return "degrees";
  if (r === "\\prime" || r === "'") return "prime";
  const s = spoken.trim();
  if (s === "2") return "squared";
  if (s === "3") return "cubed";
  if (!s) return "";
  return compound(s) ? `to the ${s} power` : `to the power of ${s}`;
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
  // a word before it (`is -3`), a contraction's or a possessive's (`What's -3`, `line 2's -5`), or
  // an opening straight quote (`"-3"`); a bare `'` is a prime (`y' - 3`) and a closing `"` ends a
  // quote (`"x" - 3`): both take something away
  const word = lettersBefore(src, prev.at + 1);
  const afterApostrophe = word.length >= 1 && /['’]/.test(src[prev.at - word.length] ?? "");
  const openQuote = prev.ch === '"' && (prev.at === 0 || isSpace(src[prev.at - 1]));
  const unary = prev.ch === undefined || UNARY_BEFORE.has(prev.ch) || openQuote || word.length >= 2 || afterApostrophe;
  if (unary && startsSomething) return " negative ";
  return " minus ";
}

/** The `)` or `]` that closes the bracket at `open` (the brackets inside counted), or -1. */
function closingBracket(src: string, open: number): number {
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    const ch = src[j];
    if (ch === "\\") {
      // a command's name is passed over (`\right` is, the `)` after it is not), as is an escaped character
      const name = /^[A-Za-z]+/.exec(src.slice(j + 1))?.[0] ?? "";
      j += Math.max(1, name.length);
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/**
 * Whether the bracket from `open` to `close` is said: it groups a sum, a difference or a product
 * (`(3 + 4) × 2`, `10 - (3 + 2)`), or a power is on it and it holds more than a lone letter or
 * number (`(-3)^2`, `(2x)^2`). One around a single thing (`(−2) × 3`, `f'(x)`), an equation or
 * prose ("(see line 2)") is not: nothing hangs on where it ends.
 */
function bracketSaid(src: string, open: number, close: number): boolean {
  if (nextNonSpace(src, close).ch === "^") return !/^\s*(\p{L}|\d+(\.\d+)?)\s*$/u.test(src.slice(open + 1, close));
  let depth = 0;
  for (let j = open + 1; j < close; j++) {
    const ch = src[j];
    if (ch === "\\") {
      const name = /^[A-Za-z]+/.exec(src.slice(j + 1))?.[0] ?? "";
      if (depth === 0 && GROUPING_COMMANDS.has(name)) return true;
      j += Math.max(1, name.length);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (depth === 0 && (GROUPING_SYMBOLS.has(ch) || ((ch === "-" || ch === "−") && dashWords(src, j) === " minus "))) return true;
  }
  return false;
}

/** A blank to fill in, `?` standing alone beside an operator (`3 + ? = 5`). */
const BLANK_NEIGHBOURS = /[=+\-−×÷*<>≤≥≠]/;
/** Operators around a number that make a trailing `s` a variable (`4s = 20`), not a plural (`2s`). */
const PLURAL_BREAKERS = /[=+\-−×÷*\/^<>≤≥≠·]/;

/** The one pass over LaTeX and symbols (rule 4). Recursive for groups. */
function speakPass(src: string): string {
  let out = "";
  let i = 0;
  // the closing brackets to say ("close bracket"), found when their opening one was
  const saidClose = new Set<number>();
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
        out += `${whole && /^(negative )?\p{L}/u.test(words) && !/ over /.test(words) && !words.startsWith("the fraction") ? " and " : " "}${words} `;
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
      if (name === "abs") {
        // rule 2's absolute value; more than one thing inside ends with a pause, as ", all over" does
        const a = readArg(src, i);
        const inner = tidy(speakPass(a.text));
        out += ` the absolute value of ${inner}${compound(inner) ? "," : ""} `;
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
      const close = closingBracket(src, i);
      const said = close > i && bracketSaid(src, i, close);
      // `3(x + 2)`, `(x + 1)(x - 1)`, `3\left(…`: the brackets multiply; a number before an aside
      // in brackets ("line 2 (the one with x)") does not
      const at = src.endsWith("\\left", i) ? i - "\\left".length : i;
      const prev = prevNonSpace(src, at);
      out += c === "(" && (isDigit(prev.ch) || prev.ch === ")") && (prev.at === at - 1 || said) ? " times " : " ";
      if (said) {
        out += " open bracket ";
        saidClose.add(close);
      }
      i++;
      continue;
    }
    if (c === ")" || c === "]") {
      out += saidClose.has(i) ? " close bracket " : " ";
      i++;
      continue;
    }

    if (c === "?" && (i === 0 || isSpace(src[i - 1]))) {
      // standing alone: a blank beside an operator (`3 + ? = 5`), the mark itself mid-sentence
      // ("That ? means…"); a `?` ending a sentence touches its last word and is left alone
      const p = prevNonSpace(src, i).ch;
      const n = nextNonSpace(src, i).ch;
      const blank = (p !== undefined && BLANK_NEIGHBOURS.test(p)) || (n !== undefined && BLANK_NEIGHBOURS.test(n));
      if (blank || (isSpace(src[i + 1]) && n !== undefined && /\p{Ll}/u.test(n))) {
        out += blank ? " blank " : " question mark ";
        i++;
        continue;
      }
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
    // `2x` is "2 x" (a voice reads "2x" as "twice"); `2nd`, `10am` stay as they are, and so does a
    // plural number in words ("count by 2s", "the 10s place"), but not `4s = 20` or `P = 4s`
    if (isDigit(c) && isLetter(src[i + 1]) && !isLetter(src[i + 2]) && !pluralNumber(src, i)) out += " ";
    i++;
  }
  return out;
}

/** `2s`, `10s`: the digit at `i` ends a number with a plural "s" after it, in words rather than maths. */
function pluralNumber(src: string, i: number): boolean {
  if (src[i + 1] !== "s") return false;
  let start = i;
  while (isDigit(src[start - 1])) start--;
  const before = prevNonSpace(src, start).ch;
  const after = nextNonSpace(src, i + 1).ch;
  return !(before !== undefined && PLURAL_BREAKERS.test(before)) && !(after !== undefined && PLURAL_BREAKERS.test(after));
}

/** Rule 1: markup that is no words (and a fill-in blank's underscores, which are a word). */
function stripMarkup(text: string): string {
  return text
    .replace(/(^|[\s(=+−×÷-])_+(?=[\s)=+−×÷.,!?-]|$)/g, "$1 blank ")
    .replace(/<\/?[a-z][^<>]*>/gi, " ")
    .replace(/\[([^\]]+)\]\((?:https?:|\/)[^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\s)[*_](\S[^*_]*?\S|\S)[*_](?=\s|[.,!?;:]|$)/g, "$1$2")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/\$\$?|\\\(|\\\)|\\\[|\\\]/g, " ");
}

/**
 * Rule 2: an absolute value's bars, as `\abs{…}` for the pass (which says "the absolute value of").
 * `\left|`, `\right|`, `\lvert`, `\rvert` and `\vert` are bars first.
 */
function absoluteValues(text: string): string {
  return text.replace(/\\left\s*\||\\right\s*\||\\[lr]?vert(?![A-Za-z])/g, "|").replace(/\|([^|\n]+)\|/g, " \\abs{$1} ");
}

/**
 * Rule 3: `3/4` between whole numbers is a fraction (not inside a date or a longer run); a full stop
 * after it ends the sentence, only a digit after the stop makes it a decimal (`1/2.5`).
 */
function plainFractions(text: string): string {
  return text.replace(/(?<![\d./])(\d+)\s*\/\s*(\d+)(?![\d/]|\.\d)/g, "\\frac{$1}{$2}");
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
    return capSpoken(tidy(speakPass(plainFractions(absoluteValues(stripMarkup(text))))), max);
  } catch {
    return capSpoken(tidy(text.replace(/[\\{}$^_]/g, " ")), max);
  }
}
