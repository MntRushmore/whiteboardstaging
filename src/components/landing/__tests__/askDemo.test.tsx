import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AskDemo, ASK_DEMO_ID } from "../AskDemo";
import { ASK_ID } from "../bands";
import { LANDING_COPY } from "../copy";

const html = renderToStaticMarkup(<AskDemo />);
const copy = LANDING_COPY.ask;
/** the section's text, entities read back */
const plain = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const text = plain(html);
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

describe("Ask on the landing page", () => {
  it("is the Ask band: its id, and named by its heading", () => {
    expect(html).toMatch(new RegExp(`^<section id="${ASK_ID}"[^>]*aria-labelledby="lp-ask-title"`));
    expect(html).toMatch(/<h2 id="lp-ask-title"/);
    expect(text).toContain(copy.eyebrow);
    for (const line of copy.title.split("\n")) expect(text).toContain(line);
    expect(text).toContain(copy.lede);
    // one mark on the section: the tutor's underline under "Just ask."
    expect(html.match(/data-kind="underline"/g)).toHaveLength(1);
  });

  it("shows the demo as one labelled picture, its insides hidden from a screen reader", () => {
    const demo = new RegExp(`<div[^>]*id="${ASK_DEMO_ID}"[^>]*role="img"[^>]*aria-label="${attr(copy.demoLabel).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*data-lp-draw="ask-demo"[^>]*><div[^>]*aria-hidden="true"`);
    expect(html).toMatch(demo);
    expect(copy.demoLabel.length).toBeGreaterThan(80);
    // a figure would count as one of the page's other pictures (landing.test): this one is a div
    expect(html).not.toMatch(/<figure/);
  });

  it("plays the real panel's words: the hello and chips, the question, the reply, the mic's", () => {
    for (const words of [copy.panelTitle, copy.placeholder, copy.hello, ...copy.chips, copy.question, copy.thinking, copy.writing]) expect(text).toContain(words);
    expect(text).toContain("Listening… Let go when you're done.");
    expect(text).toContain("Getting your words…");
    expect(text).toContain("Great question! The bottom number says how many equal pieces the whole is cut into.");
    expect(text).toContain("I drew it on your board so you can see.");
  });

  it("typesets the reply's maths as the panel does (KaTeX, a fraction set tall), never as dollar signs", () => {
    // the live reply and the unseen one that holds its room
    expect(html.match(/class="katex"/g)?.length).toBe(4);
    expect(html.match(/class="mfrac"/g)?.length).toBe(4);
    expect(text).not.toContain("$");
    expect(text).not.toContain("\\frac");
  });

  it("holds everything that moves until it is in view: paths, and every other moving element marked", () => {
    const timed = [...html.matchAll(/<(\w+)\b[^>]*style="[^"]*--(?:at|in|out|from):[^"]*"[^>]*>/g)];
    expect(timed.length).toBeGreaterThan(60);
    for (const [tag, name] of timed) {
      // a path is held by INK_START_SCRIPT's own rule; the speaker's waves are its paths
      if (name === "path" || tag.includes("--from")) continue;
      expect(tag, tag).toContain('data-lp-ink=""');
    }
  });

  it("draws the bars in the tutor's blue, with the board's flat tints", () => {
    expect(html).toContain('stroke="#4465e9"');
    expect(html).toContain('fill="#f8e2d4"');
    expect(html).toContain('fill="#d3e9e3"');
  });

  it("lists the five things Ask does, each under its own heading", () => {
    expect(copy.features).toHaveLength(5);
    for (const f of copy.features) {
      expect(html).toContain(`>${f.title.replace(/'/g, "&#x27;")}</h3>`);
      expect(text).toContain(f.body);
    }
  });

  it("has Watch again, for the motion only", () => {
    expect(html).toMatch(/<button type="button"[^>]*disabled=""[^>]*>.*Watch again<\/button>/);
  });

  it("says nothing it cannot back, in US English", () => {
    expect(text).not.toMatch(/\d+\s?%|testimonial|rated|review|trusted by|thousands|millions|#1|\bbest\b|guarantee|proven|raise[sd]? (their )?grades|★|⭐/i);
    expect(text).not.toMatch(/practis|\bmaths\b|\bticks?\b|\bticked\b|\brings?\b|\bringed\b|colour|centre|favourite/i);
  });

  it("has no gradient, glow or glass in its styles", () => {
    const css = fs.readFileSync(path.join(__dirname, "../ask.module.css"), "utf8");
    expect(css).not.toMatch(/gradient\(|backdrop-filter|filter:\s*blur|drop-shadow/i);
  });
});
