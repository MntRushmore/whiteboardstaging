import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LANDING_COPY } from "../copy";
import { Devices } from "../Devices";
import { ProblemStrip } from "../ProblemStrip";
import { stripItemLabel } from "@/lib/landing/strip";

const plain = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** the words of the two sections (their maths aside, which is checked on its own) */
const words = () => {
  const { strip, devices } = LANDING_COPY;
  return JSON.stringify({ label: strip.label, devices });
};

describe("the problem strip", () => {
  const html = renderToStaticMarkup(<ProblemStrip />);

  it("is one labelled section", () => {
    expect(html).toContain(`aria-label="${LANDING_COPY.strip.label}"`);
    expect(count(html, "<section")).toBe(1);
  });

  it("loops: the row three times, the copies either side hidden from screen readers", () => {
    const rows = [...html.matchAll(/<ul\b[^>]*>/g)].map((m) => m[0]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('aria-hidden="true"');
    expect(rows[1]).not.toContain("aria-hidden");
    expect(rows[2]).toContain('aria-hidden="true"');
    expect(count(html, "<li")).toBe(3 * LANDING_COPY.strip.items.length);
  });

  it("reads each line out once, and nothing else of it", () => {
    for (const item of LANDING_COPY.strip.items) {
      expect(count(html, `>${stripItemLabel(item)}<`), item.latex).toBe(1);
    }
    // the drawn maths, the grades' pills and the checks are pictures only
    for (const svg of html.match(/<svg\b[^>]*>/g) ?? []) expect(svg).toContain('aria-hidden="true"');
    const pills = html.match(/<span[^>]*aria-hidden="true"[^>]*>(K|\d+(st|nd|rd|th))<\/span>/g) ?? [];
    expect(pills).toHaveLength(3 * LANDING_COPY.strip.items.length);
  });

  it("writes its first pass in, held until it is in view; the copy is already written", () => {
    // every drawing in the first row, the drift and the strip itself carry the one key
    const keyed = count(html, 'data-lp-draw="strip"');
    expect(keyed).toBe(1 + 2 * LANDING_COPY.strip.items.length);
    expect(html).toMatch(/data-lp-ink=""/);
    // the copies' maths is static: no per-stroke timing
    const rows = html.split("<ul").slice(1);
    expect(rows[0]).not.toContain("--at:");
    expect(rows[1]).toContain("--at:");
    expect(rows[2]).not.toContain("--at:");
  });

  it("has the keyboard's way to stop the drift and to scroll the still row", () => {
    expect(html).toMatch(/<section[^>]*tabindex="0"/i);
  });
});

describe("Pencil, finger or mouse", () => {
  const html = renderToStaticMarkup(<Devices />);
  const copy = LANDING_COPY.devices;

  it("has its heading, and a card for each device with its words", () => {
    expect(html).toMatch(/<h2[^>]*id="lp-devices-title"/);
    expect(html).toContain('aria-labelledby="lp-devices-title"');
    expect(count(html, "<h3")).toBe(3);
    const text = plain(html);
    for (const item of copy.items) {
      expect(text).toContain(item.name);
      expect(text).toContain(item.title);
      expect(text).toContain(plain(item.body));
    }
  });

  it("has one labelled picture per device, its insides hidden from screen readers", () => {
    const pictures = [...html.matchAll(/<div[^>]*role="img"[^>]*aria-label="([^"]*)"[^>]*>\s*<div[^>]*aria-hidden="true"/g)];
    expect(pictures).toHaveLength(3);
    for (const [, label] of pictures) expect(label.length).toBeGreaterThan(40);
    expect(pictures.map((p) => plain(p[1]).trim())).toEqual(copy.items.map((i) => i.alt));
    for (const img of html.match(/<img\b[^>]*>/g) ?? []) {
      expect(img.match(/alt="([^"]*)"/)?.[1].length ?? 0, img).toBeGreaterThan(20);
    }
  });

  it("plays each device's moment when it is in view (one key per picture)", () => {
    for (const key of ["devices-tablet", "devices-laptop", "devices-phone"]) expect(html).toContain(`data-lp-draw="${key}"`);
    // the laptop's moving parts that are not ink (the pointer, Undo waking) are held too
    expect(count(html, 'data-lp-ink=""')).toBeGreaterThanOrEqual(2);
  });

  it("writes the copy's line with the mouse, the pointer gliding with it, and no typing bar", () => {
    expect(html).toMatch(/--dx:/);
    expect(html).not.toMatch(/Type your math|New problem|Enter/);
  });

  it("says only what is true: US English, no claims, no testimonials", () => {
    const all = words();
    expect(all).not.toMatch(/\btick|colour|practis|\bmaths\b|favourite/i);
    expect(all).toMatch(/check mark/);
    expect(all).not.toMatch(/\d+\s?%|testimonial|rated|review|trusted by|thousands|millions|#1|\bbest\b|guarantee|proven|raise[sd]? (their )?grades/i);
    expect(plain(html)).not.toMatch(/★|⭐|4\.\d\/5/);
  });
});
