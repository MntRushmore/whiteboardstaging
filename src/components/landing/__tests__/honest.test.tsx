import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { pathBounds } from "@/lib/landing/replay";
import { HELP_SCENE } from "@/lib/landing/stepInk";

const { default: ParentsPage } = await import("@/app/(platform)/parents/page");
const { Honest } = await import("../Honest");
const { TornEdge } = await import("../TornEdge");
const { HeroScene } = await import("../HeroScene");
const { HERO_SCENE, HERO_SCENE_PHONE } = await import("@/lib/landing/heroScene");
const { LANDING_COPY } = await import("../copy");
const { DARK_BAND_ATTR, HOW_ID, ASK_ID } = await import("../bands");

const plain = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("Not a cheat button (v4)", () => {
  const html = renderToStaticMarkup(<Honest />);
  const copy = LANDING_COPY.honest;

  it("says what the help holds back, in the copy's words", () => {
    expect(copy.eyebrow).toBe("Help, not answers");
    expect(copy.title).toBe("Not a cheat button.");
    expect(copy.body).toBe(
      "Help me gives a hint or writes just the next step. Ask nudges with a question before it explains. The whole worked solution only shows up if they choose Solve it, so the thinking stays theirs.",
    );
    const text = plain(html);
    for (const words of [copy.eyebrow, copy.title, copy.body, copy.link]) expect(text).toContain(words);
  });

  it("has one heading, an h2, and links to How it works", () => {
    expect([...html.matchAll(/<h([1-6])\b/g)].map((m) => m[1])).toEqual(["2"]);
    expect(html).toMatch(new RegExp(`<a[^>]*href="#${HOW_ID}"[^>]*>${copy.link}`));
  });

  it("is a dark band, so the sticky bar turns dark over it", () => {
    expect(html).toMatch(new RegExp(`<section[^>]*${DARK_BAND_ATTR}=""`));
  });

  it("is one picture to a screen reader, truly described, its scraps hidden", () => {
    const figure = html.match(/<figure\b[^>]*>/)?.[0] ?? "";
    expect(figure).toContain('role="img"');
    const label = figure.match(/aria-label="([^"]*)"/)?.[1] ?? "";
    expect(label.length).toBeGreaterThan(40);
    // it says what the scraps show: the slip, the circle, the next step, the check mark, the button
    for (const words of ["3x − 2 = 12", "circles", "3x − 6 = 12", "check mark", "Help me"]) expect(label).toContain(words);
    expect(label).not.toMatch(/\bticks?\b|\brings?\b|\bringed\b/);
  });

  it("carries the board's real ink: the Help me board's slip line, the tutor's ink drawn in after it", () => {
    const paths = [...html.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]);
    // the slip, its circle and the written step, every stroke as the board stored it; not the first
    // line, 3(x − 2) = 12 (How it works shows the whole board just above)
    const slip = HELP_SCENE.strokes.filter((s) => pathBounds(s.d).minY > 45);
    expect(slip.length).toBeGreaterThan(10);
    for (const stroke of HELP_SCENE.strokes) expect(html.includes(`d="${stroke.d}"`)).toBe(slip.includes(stroke));
    // the tutor's strokes draw in order (the circle, then the step), then the check mark lands
    const at = paths.filter((p) => p.includes("--at")).map((p) => Number(p.match(/--at:(\d+)ms/)![1]));
    const tutorCount = slip.filter((s) => s.ink === "tutor").length;
    expect(at.length).toBe(tutorCount + 1);
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThan(at[i - 1]);
    // held until it is in view, with one key for the whole collage
    expect(html).toContain('data-lp-draw="honest"');
  });

  it("sits right after How it works and before Ask, and never next to the other dark band", () => {
    const page = renderToStaticMarkup(<ParentsPage />);
    const how = page.indexOf(`id="${HOW_ID}"`);
    const honest = page.indexOf('id="lp-honest-title"');
    const ask = page.indexOf(`id="${ASK_ID}"`);
    expect(how).toBeGreaterThan(-1);
    expect(honest).toBeGreaterThan(how);
    expect(ask).toBeGreaterThan(honest);
    // the page's sections, in order: no two dark bands in a row
    const sections = [...page.matchAll(/<section\b[^>]*>/g)].map((m) => m[0].includes(DARK_BAND_ATTR));
    for (let i = 1; i < sections.length; i++) expect(sections[i] && sections[i - 1]).toBe(false);
    expect(sections.filter(Boolean)).toHaveLength(2);
  });
});

describe("TornEdge", () => {
  it("is the same tear for the same seed, another for another, and decorative", () => {
    const a = renderToStaticMarkup(<TornEdge tone="brown" seed={21} fiber />);
    expect(renderToStaticMarkup(<TornEdge tone="brown" seed={21} fiber />)).toBe(a);
    expect(renderToStaticMarkup(<TornEdge tone="brown" seed={22} fiber />)).not.toBe(a);
    expect(a).toMatch(/^<div[^>]*aria-hidden="true"/);
    expect(a).toContain('preserveAspectRatio="xMidYMax slice"');
    // two flat fills (the paper and its fibre), never a gradient
    expect([...a.matchAll(/<path\b/g)]).toHaveLength(2);
    expect(a).not.toMatch(/gradient|filter/i);
  });

  it("tears every color change on the page: into and out of both dark bands and the Join band", () => {
    const page = renderToStaticMarkup(<ParentsPage />);
    const tears = [...page.matchAll(/preserveAspectRatio="xMidYMax slice"/g)];
    expect(tears.length).toBeGreaterThanOrEqual(12);
  });
});

describe("HeroScene", () => {
  it("shows the painting with its alt, the phone's crop in its place under 700 px", () => {
    const html = renderToStaticMarkup(<HeroScene {...HERO_SCENE} phone={HERO_SCENE_PHONE} />);
    expect(html).toContain(`alt="${HERO_SCENE.alt}"`);
    expect(html).toMatch(/<source media="\(max-width: 699px\)"[^>]*hero-scene-phone/);
    // the ink on each crop's painted screen, held until in view, hidden from screen readers
    expect([...html.matchAll(/data-lp-draw="hero-scene"/g)]).toHaveLength(2);
    expect(html).not.toMatch(/matrix3d/);
  });

  it("holds the painting's place with a flat block until there is art", () => {
    const html = renderToStaticMarkup(<HeroScene />);
    expect(html).not.toContain("<img");
    expect(html).toContain('aria-hidden="true"');
  });
});
