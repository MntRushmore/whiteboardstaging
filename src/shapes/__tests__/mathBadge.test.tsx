import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LIVE_VERDICTS } from "@/lib/live/contracts";
import {
  BADGE_COPY,
  BADGE_TAP_EVENT,
  BADGE_TAP_HINT,
  badgeLabel,
  badgeTitle,
  dispatchBadgeTap,
  isBadgeStatus,
  noteLineFor,
  type BadgeTapDetail,
} from "../math/badge";
import { Badge, NoteLine } from "../math/MathShapeUtil";

describe("badge helpers", () => {
  it("only ok / warn / solved render a badge", () => {
    expect(LIVE_VERDICTS.filter(isBadgeStatus)).toEqual(["ok", "warn", "solved"]);
  });

  it("title is the note when present, otherwise the default copy", () => {
    expect(badgeTitle("warn", "")).toBe(BADGE_COPY.warn);
    expect(badgeTitle("warn", "  Count the atoms on each side ")).toBe("Count the atoms on each side");
    expect(badgeTitle("ok", "")).toBe("Checks out");
    expect(badgeTitle("solved", "")).toBe("Solved");
  });

  it("accessible name carries the copy, the note and (for the amber dot) the tap affordance", () => {
    expect(badgeLabel("ok", "")).toBe("Checks out");
    expect(badgeLabel("ok", "Balanced")).toBe("Checks out: Balanced");
    expect(badgeLabel("solved", "Solved")).toBe("Solved");
    expect(badgeLabel("warn", "")).toBe(`Look here — ${BADGE_TAP_HINT}`);
    expect(badgeLabel("warn", "Count the atoms on each side")).toBe(`Look here: Count the atoms on each side — ${BADGE_TAP_HINT}`);
  });

  it("noteLineFor: warn notes and Balanced notes get a secondary line, others do not", () => {
    expect(noteLineFor("warn", "Count the atoms on each side")).toEqual({ text: "Count the atoms on each side", latex: "" });
    expect(noteLineFor("ok", "Balanced")).toEqual({ text: "Balanced", latex: "" });
    expect(noteLineFor("ok", "Balanced: 4\\,\\mathrm{Fe} + 3\\,\\mathrm{O_{2}} \\rightarrow 2\\,\\mathrm{Fe_{2}O_{3}}")).toEqual({
      text: "Balanced:",
      latex: "4\\,\\mathrm{Fe} + 3\\,\\mathrm{O_{2}} \\rightarrow 2\\,\\mathrm{Fe_{2}O_{3}}",
    });
    expect(noteLineFor("none", "Balanced: 2H_2 + O_2 \\rightarrow 2H_2O")?.text).toBe("Balanced:");
    expect(noteLineFor("warn", "")).toBeNull();
    expect(noteLineFor("warn", "   ")).toBeNull();
    expect(noteLineFor("ok", "Checks out")).toBeNull();
    expect(noteLineFor("none", "Couldn't read this")).toBeNull();
    expect(noteLineFor("solved", "x = 4")).toBeNull();
    expect(noteLineFor("unknown", "some hint")).toBeNull();
  });
});

describe("dispatchBadgeTap", () => {
  const original = globalThis.window;
  afterEach(() => {
    if (original === undefined) {
      // @ts-expect-error restore the node global (no window in vitest's node environment)
      delete globalThis.window;
    } else {
      globalThis.window = original;
    }
  });

  it("returns false without a window (SSR / node)", () => {
    // @ts-expect-error simulate SSR
    delete globalThis.window;
    expect(dispatchBadgeTap({ lineId: "l1", shapeId: "shape:a" })).toBe(false);
  });

  it("dispatches a live:badge-tap CustomEvent with { lineId, shapeId } on window", () => {
    const dispatchEvent = vi.fn<(ev: Event) => boolean>(() => true);
    globalThis.window = { dispatchEvent } as unknown as Window & typeof globalThis;
    expect(dispatchBadgeTap({ lineId: "line-7", shapeId: "shape:echo7" })).toBe(true);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const ev = dispatchEvent.mock.calls[0][0] as CustomEvent<BadgeTapDetail>;
    expect(ev).toBeInstanceOf(CustomEvent);
    expect(ev.type).toBe(BADGE_TAP_EVENT);
    expect(ev.type).toBe("live:badge-tap");
    expect(ev.detail).toEqual({ lineId: "line-7", shapeId: "shape:echo7" });
  });
});

describe("<Badge> markup", () => {
  it("renders nothing for none / pending / unknown", () => {
    for (const status of ["none", "pending", "unknown"] as const) {
      expect(renderToStaticMarkup(<Badge status={status} note="x" lineId="l" shapeId="s" />)).toBe("");
    }
  });

  it("is a <button> with the status class, tooltip and accessible name", () => {
    const html = renderToStaticMarkup(<Badge status="warn" note="Count the atoms on each side" lineId="l1" shapeId="shape:1" />);
    expect(html.startsWith("<button")).toBe(true);
    expect(html).toContain('type="button"');
    expect(html).toContain('class="live-math__badge live-math__badge--warn"');
    expect(html).toContain('title="Count the atoms on each side"');
    expect(html).toContain(`aria-label="Look here: Count the atoms on each side — ${BADGE_TAP_HINT}"`);
    // the amber dot has no text content
    expect(html).toMatch(/><\/button>$/);

    const ok = renderToStaticMarkup(<Badge status="ok" note="" lineId="l" shapeId="s" />);
    expect(ok).toContain("live-math__badge--ok");
    expect(ok).toContain(">✓</button>");
    expect(ok).toContain('title="Checks out"');

    const solved = renderToStaticMarkup(<Badge status="solved" note="" lineId="l" shapeId="s" />);
    expect(solved).toContain("live-math__badge--solved");
    expect(solved).toContain(">Solved</button>");
  });
});

describe("<NoteLine> markup", () => {
  it("renders plain notes as text and Balanced notes with KaTeX", () => {
    const plain = renderToStaticMarkup(<NoteLine line={{ text: "Count the atoms on each side", latex: "" }} title="Count the atoms on each side" />);
    expect(plain).toContain('class="live-math__note"');
    expect(plain).toContain("Count the atoms on each side");
    expect(plain).not.toContain("katex");

    const balanced = renderToStaticMarkup(
      <NoteLine line={{ text: "Balanced:", latex: "4\\,\\mathrm{Fe} + 3\\,\\mathrm{O_{2}} \\rightarrow 2\\,\\mathrm{Fe_{2}O_{3}}" }} title="Balanced: …" />,
    );
    expect(balanced).toContain("Balanced:");
    expect(balanced).toContain('class="katex"');
    expect(balanced).toContain("Fe");
    expect(balanced).not.toContain("katex-error");
  });
});
