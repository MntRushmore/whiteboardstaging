/**
 * A forgiving XML tokenizer for the illustrator's SVG, and nothing more: tags, attributes and text,
 * in document order. Never a DOM, never a parser that does anything on its own: comments,
 * processing instructions and DOCTYPEs are skipped WITHOUT reading them (so a declared entity is
 * never expanded — no "billion laughs"), CDATA is text, and only the five XML entities and numeric
 * character references are decoded (any other `&name;` is dropped).
 *
 * A model's markup is often broken: a tag never closed, a `<` in text, a reply cut off mid-tag.
 * None of that throws: an unclosed tag is just an open tag, a stray `<` is text, and whatever is
 * cut off at the end is left out. Element and attribute names are lower-cased (SVG's are
 * case-sensitive, but `<SCRIPT>` must not slip past a filter written for `script`).
 */

export type XmlToken =
  | { type: "open"; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: "close"; name: string }
  | { type: "text"; text: string };

/** At most this many attributes are read per tag (the rest are skipped). */
export const MAX_ATTRS = 48;

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };

/** The five XML entities and numeric references decoded; anything else of the form `&name;` removed. */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{0,31});/g, (_, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      const valid = Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return valid ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[ref] ?? "";
  });
}

const isNameStart = (c: string) => /[A-Za-z_:]/.test(c);
const isSpace = (c: string) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";

/** The tokens of `src`, lazily (the caller may stop early). */
export function* xmlTokens(src: string): Generator<XmlToken, void, undefined> {
  const n = src.length;
  let i = 0;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      yield { type: "text", text: decodeEntities(src.slice(i)) };
      return;
    }
    if (lt > i) yield { type: "text", text: decodeEntities(src.slice(i, lt)) };
    i = lt;
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      if (end < 0) return;
      i = end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9);
      yield { type: "text", text: src.slice(i + 9, end < 0 ? n : end) };
      if (end < 0) return;
      i = end + 3;
      continue;
    }
    if (src.startsWith("<!", i)) {
      // a DOCTYPE (with or without an internal subset in [ ]) or another declaration: skipped unread
      let j = i + 2;
      let bracket = 0;
      for (; j < n; j++) {
        const c = src[j];
        if (c === "[") bracket++;
        else if (c === "]") bracket = Math.max(0, bracket - 1);
        else if (c === ">" && bracket === 0) break;
      }
      if (j >= n) return;
      i = j + 1;
      continue;
    }
    if (src.startsWith("<?", i)) {
      const end = src.indexOf("?>", i + 2);
      if (end < 0) return;
      i = end + 2;
      continue;
    }
    if (src[i + 1] === "/") {
      const end = src.indexOf(">", i + 2);
      if (end < 0) return;
      const name = src.slice(i + 2, end).trim().split(/\s/)[0].toLowerCase();
      if (name) yield { type: "close", name };
      i = end + 1;
      continue;
    }
    if (!isNameStart(src[i + 1] ?? "")) {
      // a stray "<" in text ("a < b"): text
      yield { type: "text", text: "<" };
      i++;
      continue;
    }
    // an open tag: its name, its attributes, then > or />
    let j = i + 1;
    while (j < n && !isSpace(src[j]) && src[j] !== ">" && src[j] !== "/") j++;
    const name = src.slice(i + 1, j).toLowerCase();
    // no prototype: an attribute called "constructor" or "__proto__" is just a name
    const attrs = Object.create(null) as Record<string, string>;
    let count = 0;
    let selfClosing = false;
    let closed = false;
    while (j < n) {
      while (j < n && isSpace(src[j])) j++;
      if (j >= n) break;
      if (src[j] === ">") {
        closed = true;
        j++;
        break;
      }
      if (src[j] === "/" && src[j + 1] === ">") {
        closed = true;
        selfClosing = true;
        j += 2;
        break;
      }
      if (src[j] === "/" || src[j] === "=" || src[j] === "<") {
        // junk inside a tag: skipped; a "<" means the tag was never finished (read as self-closing,
        // so the elements after it are not taken for its children)
        if (src[j] === "<") {
          selfClosing = true;
          break;
        }
        j++;
        continue;
      }
      let k = j;
      while (k < n && !isSpace(src[k]) && src[k] !== "=" && src[k] !== ">" && src[k] !== "/" && src[k] !== "<") k++;
      const attr = src.slice(j, k).toLowerCase();
      j = k;
      while (j < n && isSpace(src[j])) j++;
      let value = "";
      if (src[j] === "=") {
        j++;
        while (j < n && isSpace(src[j])) j++;
        const q = src[j];
        if (q === '"' || q === "'") {
          const end = src.indexOf(q, j + 1);
          if (end < 0) {
            // an unterminated value runs to the end of the reply: the tag is cut off
            j = n;
            break;
          }
          value = src.slice(j + 1, end);
          j = end + 1;
        } else {
          let e = j;
          while (e < n && !isSpace(src[e]) && src[e] !== ">") e++;
          value = src.slice(j, e);
          j = e;
        }
      }
      if (attr && count < MAX_ATTRS && !(attr in attrs)) {
        attrs[attr] = decodeEntities(value);
        count++;
      }
    }
    if (!closed && j >= n) {
      // cut off mid-tag at the end of the reply: an element we cannot trust to be whole
      return;
    }
    yield { type: "open", name, attrs, selfClosing };
    i = j;
  }
}
