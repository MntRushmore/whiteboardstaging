/**
 * The /try page (src/app/(platform)/try/page.tsx): public and indexable, its own title and
 * canonical address, every problem of every band written on the server in the tutor's hand and
 * handed to the board, and the landing page's two ways to it (the hero's quiet link and the bar's
 * link) without a second filled button. Also the problems' words for a screen reader and the ink
 * helpers' geometry.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TryPage, { metadata } from "@/app/(platform)/try/page";
import { Hero } from "@/components/landing/Hero";
import { LandingNav } from "@/components/landing/LandingNav";
import { LANDING_COPY } from "@/components/landing/copy";
import { START_HREF } from "@/lib/landing/links";
import { DEFAULT_TRY_BAND, TRY_PATH } from "@/lib/try/contracts";
import { TRY_PROBLEMS, tryProblems } from "@/lib/try/problems";
import { TRY_COPY } from "../copy";
import { helpScale, HELP_INK_SIZE, inkBox, inkD, markPaths, TRY_HAND_SIZE } from "../tryInk";
import { latexWords } from "../words";

const html = renderToStaticMarkup(<TryPage />).replace(/&#x27;/g, "'");

describe("the page", () => {
  it("is public and meant to be found: its own title, description, canonical /try and index, follow", () => {
    expect(metadata.title).toEqual({ absolute: TRY_COPY.meta.title });
    expect(metadata.description).toBe(TRY_COPY.meta.description);
    expect(metadata.alternates?.canonical).toBe(TRY_PATH);
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.openGraph).toMatchObject({ url: TRY_PATH, title: TRY_COPY.meta.ogTitle });
  });

  it("one h1, the eyebrow and the one line of what to do", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
    expect(h1.replace(/<[^>]+>/g, "")).toBe(TRY_COPY.title);
    expect(TRY_COPY.titleLines.join(" ")).toBe(TRY_COPY.title);
    expect(html).toContain(TRY_COPY.lede);
    expect(html).toContain(TRY_COPY.eyebrow);
  });

  it("the default band's first problem is on the page in the tutor's hand, written on the server", () => {
    const first = tryProblems(DEFAULT_TRY_BAND)[0];
    expect(html).toMatch(new RegExp(`<svg[^>]*class="[^"]*tutor[^"]*"[^>]*data-lp-draw="try-${first.id}-0"`));
    expect(html).toContain(`aria-label="${TRY_COPY.problem(latexWords(first.lines[0]))}"`);
  });

  it("the bar: the name home, Sign in and Join Agathon", () => {
    const nav = html.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(nav).toContain('href="/"');
    expect(nav).toContain(`href="${START_HREF}"`);
    expect(nav).toContain(">Join Agathon<");
  });

  it("every problem can be written by the hand and said in words", () => {
    for (const p of TRY_PROBLEMS) {
      const words = latexWords(p.lines.join(", "));
      expect(words, p.id).not.toMatch(/[\\{}^_]/);
      expect(words.length, p.id).toBeGreaterThan(0);
    }
  });
});

describe("the landing page's ways to it", () => {
  it("the hero: Try it free as a quiet link beside the one Join button", () => {
    const hero = renderToStaticMarkup(<Hero />);
    const link = hero.match(new RegExp(`<a[^>]*href="${TRY_PATH}"[^>]*>${LANDING_COPY.hero.tryIt}`))?.[0] ?? "";
    expect(link).toMatch(/class="[^"]*textLink/);
    // still one filled button, and it is Join
    const pills = hero.match(/<a[^>]*class="[^"]*_pill_[^>]*>[^<]*/g) ?? [];
    expect(pills).toHaveLength(1);
    expect(pills[0]).toContain(`href="${START_HREF}"`);
  });

  it("the bar: Try it free among its links", () => {
    const nav = renderToStaticMarkup(<LandingNav />);
    expect(nav).toMatch(new RegExp(`<a[^>]*href="${TRY_PATH}"[^>]*>${LANDING_COPY.nav.tryIt}</a>`));
  });
});

describe("latexWords", () => {
  it("says the starters' math the way a person would", () => {
    expect(latexWords("6 \\times 7")).toBe("6 times 7");
    expect(latexWords("42 \\div 6")).toBe("42 divided by 6");
    expect(latexWords("\\frac{2}{7} + \\frac{3}{7}")).toBe("2 over 7 plus 3 over 7");
    expect(latexWords("7 - 3")).toBe("7 minus 3");
    expect(latexWords("-3 + 8")).toBe("negative 3 plus 8");
    expect(latexWords("2x + 3 = 11")).toBe("2x plus 3 equals 11");
    expect(latexWords("3^{2} + 4^{2} = c^{2}")).toBe("3 squared plus 4 squared equals c squared");
    expect(latexWords("x + 65^{\\circ} = 180^{\\circ}")).toBe("x plus 65 degrees equals 180 degrees");
    expect(latexWords("\\sqrt{x + 3} = 5")).toBe("the square root of x plus 3 equals 5");
    expect(latexWords("2^{x} = 32")).toBe("2 to the power x equals 32");
  });
});

describe("the ink's geometry", () => {
  it("a tap is a dot; a stroke is one path", () => {
    expect(inkD({ x: [5], y: [6] })).toBe("M 5 6 L 5.1 6");
    expect(inkD({ x: [0, 10.04], y: [0, 5] })).toBe("M 0 0 L 10 5");
    expect(inkBox([])).toBeNull();
    expect(inkBox([{ x: [10, 30], y: [5, 40] }])).toEqual({ x: 10, y: 5, w: 20, h: 35 });
  });

  it("the tutor's marks stay on the line's width: a check after ink at the edge, a circle round a long line", () => {
    const xs = (paths: string[]) => paths.flatMap((d) => [...d.matchAll(/[ML] (-?[\d.]+) /g)].map((m) => Number(m[1])));
    const check = xs(markPaths("check", { x: 250, y: 20, w: 60, h: 50 }, 3, 320));
    expect(Math.max(...check)).toBeLessThanOrEqual(316.5);
    const ring = xs(markPaths("circle", { x: 10, y: 20, w: 290, h: 50 }, 3, 320));
    expect(Math.min(...ring)).toBeGreaterThanOrEqual(-60);
    expect(Math.max(...ring)).toBeLessThanOrEqual(380);
    // a short line's check sits just after it, as on the board
    const near = xs(markPaths("check", { x: 20, y: 20, w: 40, h: 50 }, 3, 320));
    expect(Math.min(...near)).toBeGreaterThan(60);
    expect(Math.min(...near)).toBeLessThan(90);
  });

  it("the tutor's step goes from the server's hand size to the page's, but never out of its line", () => {
    expect(helpScale({ width: 60, height: 25 }, TRY_HAND_SIZE, 104, 300)).toBeCloseTo(TRY_HAND_SIZE / HELP_INK_SIZE);
    expect(helpScale({ width: 60, height: 100 }, TRY_HAND_SIZE, 104, 300)).toBeCloseTo((104 * 0.92) / 100);
    expect(helpScale({ width: 400, height: 25 }, TRY_HAND_SIZE, 104, 300)).toBeCloseTo(300 / 400);
  });
});
