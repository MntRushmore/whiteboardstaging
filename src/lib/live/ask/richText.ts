/**
 * The tutor's reply as the panel shows it (docs/ASK-V2.md): Markdown-lite — paragraphs, `**bold**`,
 * `-` and `1.` lists, `$…$` inline and `$$…$$` display maths — parsed into a small tree the panel
 * renders with React (text nodes, so never raw HTML) and KaTeX for the maths.
 *
 * Robust to a reply still streaming: anything unclosed stays text until it closes. A `$` with no
 * partner is a dollar sign ("I have $5 and $3"), and a `$$` block still being written shows its
 * source rather than flickering. Only `**` is kinder while streaming: an opened bold makes the rest
 * bold, so the kid never sees the asterisks flash.
 *
 * Pure: no React, no DOM. Unit-tested in __tests__/richText.test.ts.
 */

export type RichInline = { t: "text"; v: string } | { t: "bold"; c: RichInline[] } | { t: "math"; v: string; display: boolean } | { t: "br" };

export type RichBlock =
  | { t: "p"; c: RichInline[] }
  | { t: "ul"; items: RichInline[][] }
  | { t: "ol"; start: number; items: RichInline[][] }
  | { t: "math"; v: string };

export interface RichTextOptions {
  /** the reply is still arriving: an opened `**` makes the rest bold */
  streaming?: boolean;
}

/** Longer than this between `$`s is not one formula (a stray `$` paired with one paragraphs later). */
const MAX_MATH = 600;

const BULLET = /^\s{0,3}[-*•]\s+(.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
/** a Markdown heading: shown as a bold line (the model is asked not to, but may) */
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
/** a horizontal rule: dropped */
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

export function parseRichText(src: string, opts: RichTextOptions = {}): RichBlock[] {
  const text = src.replace(/\r\n?/g, "\n");
  const blocks: RichBlock[] = [];
  let para: string[] = [];
  let list: { t: "ul" | "ol"; start: number; items: string[] } | null = null;

  const flushPara = () => {
    const joined = para.join("\n").trim();
    para = [];
    if (!joined) return;
    // a paragraph that is one closed `$$…$$` is a display block of its own
    const whole = /^\$\$([\s\S]+?)\$\$$/.exec(joined) ?? /^\\\[([\s\S]+?)\\\]$/.exec(joined);
    if (whole && whole[1].trim() && whole[1].length <= MAX_MATH) {
      blocks.push({ t: "math", v: whole[1].trim() });
      return;
    }
    const c = trimBreaks(parseInline(joined, opts));
    if (c.length > 0) blocks.push({ t: "p", c });
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((s) => trimBreaks(parseInline(s.trim(), opts))).filter((c) => c.length > 0);
    if (items.length > 0) blocks.push(list.t === "ul" ? { t: "ul", items } : { t: "ol", start: list.start, items });
    list = null;
  };

  // inside an unfinished `$$` (an odd count so far in this paragraph): its lines are maths, not list items
  let openDisplay = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      if (openDisplay) {
        para.push(line);
        continue;
      }
      flushPara();
      flushList();
      continue;
    }
    if (!openDisplay) {
      const bullet = BULLET.exec(line);
      const numbered = bullet ? null : NUMBERED.exec(line);
      if (bullet || numbered) {
        flushPara();
        const kind = bullet ? "ul" : "ol";
        if (!list || list.t !== kind) {
          flushList();
          list = { t: kind, start: numbered ? Number(numbered[1]) : 1, items: [] };
        }
        list.items.push(bullet ? bullet[1] : numbered![2]);
        openDisplay = countDisplay(list.items[list.items.length - 1]) % 2 === 1;
        continue;
      }
      if (list && /^\s{2,}\S/.test(line)) {
        // an indented line under an item carries it on
        list.items[list.items.length - 1] += ` ${line.trim()}`;
        openDisplay = countDisplay(list.items[list.items.length - 1]) % 2 === 1;
        continue;
      }
      if (RULE.test(line)) {
        flushPara();
        flushList();
        continue;
      }
      const heading = HEADING.exec(line);
      if (heading) {
        flushPara();
        flushList();
        para.push(`**${heading[1].replace(/\*\*/g, "")}**`);
        flushPara();
        continue;
      }
    }
    if (list && !openDisplay) flushList();
    if (list && openDisplay) {
      list.items[list.items.length - 1] += `\n${line}`;
      openDisplay = countDisplay(list.items[list.items.length - 1]) % 2 === 1;
      continue;
    }
    para.push(line);
    openDisplay = countDisplay(para.join("\n")) % 2 === 1;
  }
  flushPara();
  flushList();
  return blocks;
}

/** How many unescaped `$$` a piece of text holds. */
function countDisplay(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "$" && s[i + 1] === "$") {
      n++;
      i++;
    }
  }
  return n;
}

/** Line breaks next to a display formula or at either end are its own spacing, not the text's. */
function trimBreaks(nodes: RichInline[]): RichInline[] {
  const out: RichInline[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.t === "br") {
      const prev = out[out.length - 1];
      const next = nodes[i + 1];
      if (!prev || !next || (prev.t === "math" && prev.display) || (next.t === "math" && next.display)) continue;
    }
    out.push(n);
  }
  return out;
}

/**
 * One paragraph's inline marks. `$…$` opens only on a `$` followed by a non-space and closes on one
 * preceded by a non-space and not followed by a digit (Pandoc's rule), so prices stay prices.
 */
export function parseInline(src: string, opts: RichTextOptions = {}): RichInline[] {
  const out: RichInline[] = [];
  let buf = "";
  const pushText = (s: string) => {
    buf += s;
  };
  const flush = () => {
    if (!buf) return;
    const parts = buf.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) out.push({ t: "br" });
      if (p) out.push({ t: "text", v: p });
    });
    buf = "";
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    // an escaped dollar or asterisk is the character itself
    if (ch === "\\" && (next === "$" || next === "*")) {
      pushText(next);
      i += 2;
      continue;
    }
    // \( … \) and \[ … \]: what models write when they forget the dollars
    if (ch === "\\" && (next === "(" || next === "[")) {
      const close = next === "(" ? "\\)" : "\\]";
      const end = src.indexOf(close, i + 2);
      const body = end === -1 ? "" : src.slice(i + 2, end);
      if (end !== -1 && body.trim() && body.length <= MAX_MATH) {
        flush();
        out.push({ t: "math", v: body.trim(), display: next === "[" });
        i = end + 2;
        continue;
      }
      pushText(ch);
      i += 1;
      continue;
    }
    if (ch === "$" && next === "$") {
      const end = findDisplayClose(src, i + 2);
      const body = end === -1 ? "" : src.slice(i + 2, end);
      if (end !== -1 && body.trim() && body.length <= MAX_MATH) {
        flush();
        out.push({ t: "math", v: body.trim(), display: true });
        i = end + 2;
        continue;
      }
      // unclosed (still streaming) or empty: the dollars are text
      pushText("$$");
      i += 2;
      continue;
    }
    if (ch === "$") {
      const end = next !== undefined && !/\s/.test(next) ? findInlineClose(src, i + 1) : -1;
      if (end !== -1) {
        flush();
        out.push({ t: "math", v: src.slice(i + 1, end), display: false });
        i = end + 1;
        continue;
      }
      pushText("$");
      i += 1;
      continue;
    }
    if (ch === "*" && next === "*") {
      const end = findBoldClose(src, i + 2);
      if (end !== -1) {
        const inner = parseInline(src.slice(i + 2, end), opts);
        flush();
        if (inner.length > 0) out.push({ t: "bold", c: inner });
        i = end + 2;
        continue;
      }
      if (opts.streaming) {
        // an opened bold still being written: the rest is bold, and no asterisks flash
        const inner = parseInline(src.slice(i + 2), opts);
        flush();
        if (inner.length > 0) out.push({ t: "bold", c: inner });
        i = src.length;
        continue;
      }
      pushText("**");
      i += 2;
      continue;
    }
    pushText(ch);
    i += 1;
  }
  flush();
  return out;
}

/** The `$$` closing one opened before `from`, or -1. */
function findDisplayClose(src: string, from: number): number {
  for (let j = from; j < src.length - 1; j++) {
    if (src[j] === "\\") {
      j++;
      continue;
    }
    if (src[j] === "$" && src[j + 1] === "$") return j;
  }
  return -1;
}

/**
 * The `$` closing an inline formula opened before `from`, or -1. Only the NEXT dollar can close it:
 * when that one cannot (a space before it, a digit after it, a `$$`), the opener was a dollar sign
 * ("$5. Then $x$" is a price and then a formula).
 */
function findInlineClose(src: string, from: number): number {
  for (let j = from; j < src.length && j - from <= MAX_MATH; j++) {
    const c = src[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c !== "$") continue;
    const before = src[j - 1];
    const after = src[j + 1];
    if (after === "$" || j === from || /\s/.test(before) || (after !== undefined && /\d/.test(after))) return -1;
    return j;
  }
  return -1;
}

/** The `**` closing a bold opened before `from`, or -1 (an empty `****` is not bold). */
function findBoldClose(src: string, from: number): number {
  const end = src.indexOf("**", from);
  return end > from ? end : -1;
}

/** The reply's words without marks, for read-aloud and screen readers: maths as its source. */
export function plainText(blocks: readonly RichBlock[]): string {
  const inline = (nodes: readonly RichInline[]): string =>
    nodes.map((n) => (n.t === "text" ? n.v : n.t === "bold" ? inline(n.c) : n.t === "math" ? n.v : "\n")).join("");
  return blocks
    .map((b) => {
      if (b.t === "p") return inline(b.c);
      if (b.t === "math") return b.v;
      return b.items.map((it, k) => `${b.t === "ol" ? `${b.start + k}.` : "-"} ${inline(it)}`).join("\n");
    })
    .join("\n\n");
}

/**
 * A formula as plain words and symbols, for the moment before KaTeX loads (or when it cannot read
 * the formula): `\frac{3}{4}` reads 3/4, `x^2` x², `\times` ×. Never the backslashes a kid can't read.
 */
export function mathAsText(src: string): string {
  return src
    .replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
    .replace(/\\sqrt\{([^{}]*)\}/g, "√($1)")
    .replace(/\^\{?\\circ\}?|\\degree/g, "°")
    .replace(/\^\{?2\}?/g, "²")
    .replace(/\^\{?3\}?/g, "³")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\c?dot(?:s)?\b/g, "·")
    .replace(/\\pm/g, "±")
    .replace(/\\leq?\b/g, "≤")
    .replace(/\\geq?\b/g, "≥")
    .replace(/\\neq?\b/g, "≠")
    .replace(/\\approx/g, "≈")
    .replace(/\\pi\b/g, "π")
    .replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:left|right)\b/g, "")
    .replace(/\\[,;:! ]/g, " ")
    .replace(/\\([a-zA-Z]+)/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Does the reply hold any maths (the panel loads KaTeX only then)? */
export function hasMath(blocks: readonly RichBlock[]): boolean {
  const inline = (nodes: readonly RichInline[]): boolean => nodes.some((n) => n.t === "math" || (n.t === "bold" && inline(n.c)));
  return blocks.some((b) => b.t === "math" || (b.t === "p" ? inline(b.c) : b.items.some(inline)));
}
