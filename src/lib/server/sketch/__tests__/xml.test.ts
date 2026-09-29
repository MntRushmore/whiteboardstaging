import { describe, expect, it } from "vitest";
import { decodeEntities, MAX_ATTRS, xmlTokens, type XmlToken } from "../xml";

const tokens = (s: string): XmlToken[] => [...xmlTokens(s)];

describe("the XML tokenizer", () => {
  it("tags, attributes in every quoting, self-closing tags, text", () => {
    expect(tokens(`<svg viewBox="0 0 10 10"><path d='M0 0' fill=red /><text>Hi</text></svg>`)).toEqual([
      { type: "open", name: "svg", attrs: { viewbox: "0 0 10 10" }, selfClosing: false },
      { type: "open", name: "path", attrs: { d: "M0 0", fill: "red" }, selfClosing: true },
      { type: "open", name: "text", attrs: {}, selfClosing: false },
      { type: "text", text: "Hi" },
      { type: "close", name: "text" },
      { type: "close", name: "svg" },
    ]);
  });

  it("names lower-cased, so <SCRIPT> is script", () => {
    expect(tokens("<SCRIPT SRC='x'></SCRIPT>")).toMatchObject([{ type: "open", name: "script", attrs: { src: "x" } }, { type: "close", name: "script" }]);
  });

  it("comments, processing instructions and DOCTYPEs are skipped unread: a declared entity is never expanded", () => {
    const doc = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><!-- <path d="M0 0"/> --><svg><text>&lol2;</text></svg>`;
    const t = tokens(doc);
    expect(t.map((x) => x.type)).toEqual(["open", "open", "text", "close", "close"]);
    expect(t[2]).toEqual({ type: "text", text: "" });
  });

  it("CDATA is text, taken as it is", () => {
    expect(tokens("<text><![CDATA[a < b & c]]></text>")[1]).toEqual({ type: "text", text: "a < b & c" });
  });

  it("the five entities and numeric references; anything else of the form &name; dropped", () => {
    expect(decodeEntities("&lt;&amp;&gt;&quot;&apos;&#65;&#x42;")).toBe(`<&>"'AB`);
    expect(decodeEntities("a&#0;b&#xD800;c&#x110000;d")).toBe("abcd");
    expect(decodeEntities("fish &chips; &amp co")).toBe("fish  &amp co");
  });

  it("broken markup never throws: a stray <, a tag cut off at the end, an unfinished tag before the next", () => {
    expect(tokens("a < b")).toEqual([{ type: "text", text: "a " }, { type: "text", text: "<" }, { type: "text", text: " b" }]);
    expect(tokens(`<svg><path d="M0 0 L10`)).toEqual([{ type: "open", name: "svg", attrs: {}, selfClosing: false }]);
    expect(tokens(`<svg><path d="M0 0"`)).toEqual([{ type: "open", name: "svg", attrs: {}, selfClosing: false }]);
    // an unfinished tag followed by another is self-closing (the next is not taken for its child)
    expect(tokens(`<path d="M0 0" <circle r="5"/>`)).toMatchObject([
      { type: "open", name: "path", selfClosing: true },
      { type: "open", name: "circle", selfClosing: true },
    ]);
    for (const junk of ["<", "<<<<", "</", "<!--", "<![CDATA[x", "<!DOCTYPE", "<?xml", "<a b='", "<a =b c>", "</a b c>"]) expect(() => tokens(junk), junk).not.toThrow();
  });

  it("attributes: no prototype keys, first one wins, at most MAX_ATTRS", () => {
    const [open] = tokens(`<g constructor="c" __proto__="p" toString="t" fill="a" fill="b">`) as Array<Extract<XmlToken, { type: "open" }>>;
    expect(open.attrs.constructor).toBe("c");
    expect(open.attrs.__proto__).toBe("p");
    expect(open.attrs.fill).toBe("a");
    expect("valueOf" in open.attrs).toBe(false);
    const many = `<g ${Array.from({ length: 100 }, (_, i) => `a${i}="${i}"`).join(" ")}/>`;
    expect(Object.keys((tokens(many)[0] as Extract<XmlToken, { type: "open" }>).attrs)).toHaveLength(MAX_ATTRS);
  });
});
