/**
 * The try board's markup (src/components/try/TryBoard.tsx) in each of its states, rendered on the
 * server as the page is (no DOM in these tests; the store's behaviour is tryModel.test.ts): the
 * grade radio group, the problem, the labelled pad, the tutor's marks on each verdict, the tutor's
 * step in its hand, every error's words, the Join card (its link keeps `?ref` / `utm_*`, its trial
 * words are the plan's), and what the board's client code may import (no zod, no hand engine, no
 * live engine, no tldraw).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HandMath } from "@/components/landing/HandMath";
import { LANDING_COPY } from "@/components/landing/copy";
import { planWords } from "@/lib/landing/plan";
import { START_HREF } from "@/lib/landing/links";
import { DEFAULT_TRY_BAND, TRY_API, TRY_BANDS, TRY_MAX_LINES, type TryInk } from "@/lib/try/contracts";
import { TRY_COPY } from "../copy";
import { TryBoard, statusFor, type TryBoardProblemView } from "../TryBoard";
import type { KidRow, TryRow, TryState } from "../tryModel";

const PROBLEMS: TryBoardProblemView[] = [
  { id: "g35-6", band: "g35", hint: "Try writing both fractions in sixths.", oneStep: false, words: "1 over 2 plus 1 over 3", ink: <HandMath latex="\frac{1}{2} + \frac{1}{3}" ink="tutor" size={60} draw="try-g35-6-0" /> },
  { id: "k2-0", band: "k2", hint: "Hold up 3 fingers, then 4 more.", oneStep: true, words: "3 plus 4", ink: <HandMath latex="3 + 4" ink="tutor" size={60} draw="try-k2-0-0" /> },
];
const BANDS = TRY_BANDS.map((b) => ({ id: b.id, label: b.label }));
const TERMS = { usual: LANDING_COPY.join.terms, invited: LANDING_COPY.invited.terms };

const INK: TryInk = {
  strokes: [
    { d: "M 0 0 L 10 10", weight: 1, atMs: 0, forMs: 120 },
    { d: "M 10 0 L 0 10", weight: 1.2, atMs: 180, forMs: 140 },
  ],
  width: 60,
  height: 25,
  baseline: 23,
  durationMs: 320,
};

const kid = (over: Partial<KidRow> = {}): KidRow => ({
  kind: "kid",
  id: 1,
  strokes: [
    { x: [20, 30, 40], y: [30, 60, 30] },
    { x: [50, 70], y: [40, 40] },
  ],
  ghost: null,
  verdict: null,
  latex: null,
  ...over,
});
const empty = (id: number): KidRow => ({ kind: "kid", id, strokes: [], ghost: null, verdict: null, latex: null });

const render = (initial: Partial<TryState> = {}) =>
  renderToStaticMarkup(
    <TryBoard problems={PROBLEMS} bands={BANDS} defaultBand={DEFAULT_TRY_BAND} api={TRY_API} maxLines={TRY_MAX_LINES} terms={TERMS} finishMark={<svg data-finish-mark="" />} initial={initial} />,
  )
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

/** The live region's text. */
const said = (html: string) =>
  (html.match(/role="status"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the empty board", () => {
  const html = render();

  it("the grades as one radio group, the default band chosen", () => {
    expect(html).toMatch(/<fieldset[^>]*>\s*<legend[^>]*>Grade<\/legend>/);
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(TRY_BANDS.length);
    for (const band of TRY_BANDS) expect(html).toContain(`>${band.label}</span>`);
    const checked = radios.filter((r) => r.includes("checked"));
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain(`value="${DEFAULT_TRY_BAND}"`);
  });

  it("the problem in the tutor's hand, named for a screen reader, and Another problem", () => {
    expect(html).toContain(`aria-label="${TRY_COPY.problem("1 over 2 plus 1 over 3")}"`);
    expect(html).toMatch(/<svg[^>]*class="[^"]*tutor[^"]*"[^>]*data-lp-draw="try-g35-6-0"/);
    expect(html).toContain(TRY_COPY.another);
  });

  it("one open line with a labelled pad (the only place the page takes the pen) and its placeholder", () => {
    const pads = html.match(/<div[^>]*data-try-pad=""[^>]*>/g) ?? [];
    expect(pads).toHaveLength(1);
    expect(pads[0]).toContain('role="group"');
    expect(pads[0]).toContain(`aria-label="${TRY_COPY.pad(1, false)}"`);
    expect(html).toContain(TRY_COPY.writeHere(false));
    // touch-action: none is on the pad's class only
    const css = fs.readFileSync(path.join(__dirname, "../try.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{[^}]*touch-action:\s*none[^}]*\}/g)].map((m) => m[1].trim());
    expect(rules).toEqual([".pad"]);
  });

  it("the prompt in a polite live region; the buttons; no Join card yet", () => {
    expect(html).toMatch(/role="status" aria-live="polite"/);
    expect(said(html)).toBe(TRY_COPY.prompt(false));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Check my line<\/button>/);
    expect(html).toMatch(/<button[^>]*>Show me a step<\/button>/);
    expect(html).not.toContain("data-try-join");
  });

  it("a one-step problem asks for the answer", () => {
    const k = render({ band: "k2", problemId: "k2-0" });
    expect(said(k)).toBe(TRY_COPY.prompt(true));
    expect(k).toContain(TRY_COPY.writeHere(true));
  });
});

describe("the verdicts", () => {
  it("writing: the kid's ink in the kid's pen, and Check my line ready", () => {
    const html = render({ rows: [kid()] });
    expect(html.match(/<g class="[^"]*kid[^"]*">([\s\S]*?)<\/g>/)?.[1].match(/<path/g)).toHaveLength(2);
    expect(html).toMatch(/<button[^>]*>Check my line<\/button>/);
    expect(html).not.toMatch(/disabled=""[^>]*>Check my line/);
    expect(html).not.toContain(TRY_COPY.writeHere(false));
  });

  it("reading: said quietly, and the line marked as being read", () => {
    const html = render({ rows: [kid()], busy: "reading" });
    expect(said(html)).toBe(TRY_COPY.reading);
    expect(html).toContain("data-reading");
  });

  it("check: the tutor's check mark draws itself beside the line, the next line opens, and the Join card", () => {
    const html = render({ rows: [kid({ verdict: "check", latex: "\\frac{3}{6}" }), empty(2)], notice: { kind: "check" }, joinOpen: true });
    const mark = html.match(/<g[^>]*data-mark="check"[^>]*>[\s\S]*?<\/g>/)?.[0] ?? "";
    expect(mark).toMatch(/class="[^"]*draw/);
    expect(mark).toContain('pathLength="1"');
    expect(said(html)).toBe(TRY_COPY.verdict.checkNext);
    expect(html).toContain(TRY_COPY.row.check(1));
    expect(html.match(/data-try-pad=""/g)).toHaveLength(1);
    expect(html).toContain(`aria-label="${TRY_COPY.pad(2, false)}"`);
    expect(html).toContain("data-try-join");
  });

  it("solved: the finish (the word and the tutor's check mark) and Try another problem", () => {
    const html = render({ rows: [kid({ verdict: "solved", latex: "\\frac{5}{6}" })], notice: { kind: "solved" }, solved: "kid", joinOpen: true });
    expect(html).toContain(TRY_COPY.finish.title);
    expect(html).toContain("data-finish-mark");
    expect(said(html)).toContain(TRY_COPY.verdict.solved);
    expect(html).not.toContain("data-try-pad");
    expect(html).toMatch(/<button[^>]*>Try another problem<\/button>/);
    expect(html).toMatch(/data-solved=""/);
  });

  it("ring: a circle round the line, the nudge, and Erase and try again", () => {
    const html = render({ rows: [kid({ verdict: "ring", latex: "\\frac{2}{5}" })], notice: { kind: "ring", nudge: PROBLEMS[0].hint, note: false } });
    expect(html).toMatch(/data-mark="circle"/);
    expect(said(html)).toBe(`${TRY_COPY.verdict.ring} ${PROBLEMS[0].hint}`);
    expect(html).toMatch(/<button[^>]*>Erase and try again<\/button>/);
    expect(html).toContain(TRY_COPY.row.ring(1));
  });

  it("ring with the engine's note: the note, as it is", () => {
    const note = "This follows from the circled line. Fix that one first.";
    const html = render({ rows: [kid({ verdict: "ring" })], notice: { kind: "ring", nudge: note, note: true } });
    expect(said(html)).toBe(note);
  });

  it("unread: a question mark beside the faint ink, and write it a little bigger", () => {
    const ghost = kid().strokes;
    const html = render({ rows: [kid({ verdict: "unread", strokes: [], ghost })], notice: { kind: "unread" } });
    expect(html).toMatch(/data-mark="question"/);
    expect(html).toMatch(/class="[^"]*ghost/);
    expect(said(html)).toBe(TRY_COPY.verdict.unread);
  });

  it("unjudged: no mark, keep going", () => {
    const html = render({ rows: [kid()], notice: { kind: "unjudged" } });
    expect(html).not.toContain("data-mark");
    expect(said(html)).toBe(TRY_COPY.verdict.unjudged);
  });
});

describe("Show me a step", () => {
  it("the tutor's step in its blue hand, each stroke timed to write itself in, then a fresh line", () => {
    const rows: TryRow[] = [{ kind: "tutor", id: 1, latex: "\\frac{3}{6}+\\frac{2}{6}", ink: INK }, empty(2)];
    const html = render({ rows, notice: { kind: "helped", solves: false } });
    const svg = html.match(/<svg[^>]*data-tutor-step=""[^>]*>[\s\S]*?<\/svg>/)?.[0] ?? "";
    expect(svg).toMatch(/class="[^"]*tutor[^"]*draw/);
    expect(svg.match(/<path/g)).toHaveLength(2);
    expect(svg).toContain("--at:180ms");
    expect(svg).toContain("--for:140ms");
    expect(svg).toContain('d="M 0 0 L 10 10"');
    // drawn at the page's hand size: 60 / the server's 40
    const width = Number(svg.match(/width="([\d.]+)"/)?.[1]);
    expect(width).toBeGreaterThan(INK.width * 1.4);
    expect(said(html)).toBe(TRY_COPY.helped);
    expect(html).toContain(TRY_COPY.row.tutor(1, "3 over 6 plus 2 over 6"));
  });

  it("a step that is the answer: the finish and the Join card", () => {
    const html = render({ rows: [{ kind: "tutor", id: 1, latex: "= \\frac{5}{6}", ink: INK }], notice: { kind: "helped", solves: true }, solved: "tutor", joinOpen: true });
    expect(html).toContain(TRY_COPY.finish.tutorTitle);
    expect(said(html)).toContain(TRY_COPY.helpedSolved);
    expect(html).toContain("data-try-join");
  });

  it("no step: that's the answer", () => {
    expect(said(render({ notice: { kind: "noStep" } }))).toBe(TRY_COPY.noStep);
  });
});

describe("errors", () => {
  it("each says what happened in words, in the live region", () => {
    expect(said(render({ notice: { kind: "rate", retryAfterMs: 5 * 60_000 } }))).toBe(`${TRY_COPY.errors.rate} You can check again in about 5 minutes.`);
    expect(said(render({ notice: { kind: "rate", retryAfterMs: 20_000 } }))).toBe(`${TRY_COPY.errors.rate} You can check again in a minute.`);
    expect(said(render({ notice: { kind: "upstream" } }))).toBe(TRY_COPY.errors.upstream);
    expect(said(render({ notice: { kind: "down" }, down: true, joinOpen: true }))).toBe(TRY_COPY.errors.down);
    expect(said(render({ notice: { kind: "offline" } }))).toBe(TRY_COPY.errors.offline);
    expect(said(render({ notice: { kind: "invalid" } }))).toBe(TRY_COPY.errors.invalid);
  });

  it("the tutor taking a break opens the Join card, without a \"like this\" when nothing was checked", () => {
    const html = render({ notice: { kind: "down" }, down: true, joinOpen: true });
    expect(html).toContain("data-try-join");
    expect(html).toContain(TRY_COPY.join.titleDown);
    expect(html).toContain(TRY_COPY.join.bodyDown);
    expect(html).not.toContain(TRY_COPY.join.body);
  });

  it("statusFor: busy wins over a notice", () => {
    expect(statusFor({ busy: "helping", notice: { kind: "check" }, solved: null }, null).text).toBe(TRY_COPY.helping);
  });
});

describe("the Join card", () => {
  const joinOf = (html: string) => html.match(/<aside[^>]*data-try-join=""[^>]*>[\s\S]*?<\/aside>/)?.[0] ?? "";

  it("one honest sentence, the plan's trial words, Join Agathon to /start, and Try another problem", () => {
    const card = joinOf(render({ rows: [kid({ verdict: "check" }), empty(2)], notice: { kind: "check" }, joinOpen: true, checkedOnce: true }));
    expect(card).toContain(TRY_COPY.join.title);
    expect(card).toContain(TRY_COPY.join.body);
    expect(card).toContain(planWords().terms);
    expect(card).toMatch(new RegExp(`<a[^>]*href="${START_HREF}"[^>]*>Join Agathon</a>`));
    expect(card).toMatch(/<button[^>]*>Try another problem<\/button>/);
  });

  it("keeps the visit's ?ref= and utm_* on the Join link", () => {
    vi.stubGlobal("window", { location: { search: "?ref=BCDF2345&utm_source=tiktok&utm_campaign=try&gclid=x", href: "https://www.agathon.app/try?ref=BCDF2345" } });
    const card = joinOf(render({ joinOpen: true, notice: { kind: "check" } }));
    const href = card.match(/<a[^>]*href="([^"]+)"/)?.[1] ?? "";
    const url = new URL(href, "https://www.agathon.app");
    expect(url.pathname).toBe(START_HREF);
    expect(Object.fromEntries(url.searchParams)).toEqual({ ref: "BCDF2345", utm_source: "tiktok", utm_campaign: "try" });
  });
});

describe("the words and the weight", () => {
  it("no price, no trial length, no numbers of its own: those come from the plan", () => {
    const strings = JSON.stringify(TRY_COPY, (_k, v) => (typeof v === "function" ? String(v) : v));
    expect(strings).not.toMatch(/\$\d|\b\d+ days?\b|\bweek\b/);
    expect(strings).not.toMatch(/\btick\b|\bmaths\b/i);
  });

  it("flat fills only: no gradients, glows or glass in the board's CSS", () => {
    const css = fs.readFileSync(path.join(__dirname, "../try.module.css"), "utf8");
    expect(css).not.toMatch(/gradient\(|backdrop-filter|filter:\s*blur|drop-shadow/);
  });

  it("the board's client code imports no zod, no contract at runtime, no hand engine, no live engine and no tldraw", () => {
    const dir = path.join(__dirname, "..");
    for (const file of ["TryBoard.tsx", "tryModel.ts", "tryInk.ts", "copy.ts", "words.ts", "../../lib/try/marker.ts"]) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gm)].map((m) => ({ type: Boolean(m[1]), from: m[2] }));
      for (const { type, from } of imports) {
        expect(from, `${file}: ${from}`).not.toMatch(/^zod$|^tldraw|@\/lib\/live\/engine|@\/lib\/landing\/handInk|^@\/lib\/hand$|HandMath|InkMark|@\/lib\/try\/problems/);
        if (from === "@/lib/try/contracts" || from === "@/lib/live/contracts") expect(type, `${file} imports ${from} for its types only`).toBe(true);
      }
    }
  });
});
