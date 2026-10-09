import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// A different plan than the real one: everything on the page must follow it.
vi.mock("@/lib/billing/unlimited", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/billing/unlimited")>();
  return { ...real, UNLIMITED_PLAN: { ...real.UNLIMITED_PLAN, name: "Agathon Test Plan", monthlyUsd: 31, trialDays: 10 } };
});

const { default: ParentsPage, metadata } = await import("@/app/(platform)/parents/page");
const { landingCopy } = await import("../copy");

const html = renderToStaticMarkup(<ParentsPage />);
const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("/parents", () => {
  it("takes the price, the trial and the plan's name from UNLIMITED_PLAN", () => {
    expect(text).toContain("$31");
    expect(text).toContain("Free for 10 days, then $31 a month for the whole family.");
    expect(text).toContain("Agathon Test Plan");
    expect(text).toContain("Start your free 10 days");
    expect(text).not.toMatch(/\$25|7-day|7 days|free week/);
    expect(String(metadata.description)).toContain("Free for 10 days");
  });

  it("never writes a price, a trial length or the yearly plan itself", () => {
    const files = [
      ...fs.readdirSync(path.join(__dirname, "..")).filter((f) => /\.(tsx?|css)$/.test(f)).map((f) => path.join(__dirname, "..", f)),
      path.join(__dirname, "../../../app/(platform)/parents/page.tsx"),
      path.join(__dirname, "../../../app/(platform)/parents/opengraph-image.tsx"),
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/\$\s?25\b|\b25 a month|7-day|\b7 days|\$199|a year|annual/i);
    }
  });

  it("says nothing it cannot back: no testimonials, ratings, user counts or results", () => {
    const words = JSON.stringify(landingCopy({ name: "Agathon Unlimited", monthlyUsd: 25, trialDays: 7 }));
    expect(words).not.toMatch(/\d+\s?%|\b\d[\d,]*\+|testimonial|rated|review|trusted by|thousands|millions|#1|best|guarantee|proven|raise[sd]? (their )?grades/i);
    expect(text).not.toMatch(/★|⭐|4\.\d\/5/);
  });

  it("has one h1 and headings in order", () => {
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  });

  it("describes every picture", () => {
    const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBeGreaterThanOrEqual(5);
    for (const img of imgs) {
      const alt = img.match(/alt="([^"]*)"/)?.[1];
      // the iPad's screen is the one blank alt: the figure around it describes the whole picture
      if (img.includes("board-ipad")) expect(alt).toBe("");
      else expect(alt && alt.length > 20, img).toBe(true);
    }
    expect(html).toMatch(/role="img" aria-label="An Agathon board on an iPad/);
  });

  it("sends Start to the sign-up form and Sign in to the sign-in form", () => {
    expect(html).toContain('href="/login?mode=signup"');
    expect(html).toContain('href="/login"');
  });

  it("lets a parent pick any grade without a script", () => {
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)];
    expect(radios).toHaveLength(10);
    expect(radios.filter((r) => r[0].includes("checked")).map((r) => r[0].match(/value="(\w+)"/)?.[1])).toEqual(["3"]);
    expect(text).toContain("Times tables");
    expect(text).toContain("Adding to 10");
    expect(text).toContain("Pythagorean theorem");
  });

  it("links the privacy answer to the Privacy Policy", () => {
    expect(html).toContain('href="/privacy"');
  });
});
