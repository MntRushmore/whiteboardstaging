import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LectureSnapshot } from "@/lib/live/lecture/session";

// the lazy out-of-credits panel pulls in the billing and Supabase modules: not needed to render
vi.mock("@/components/billing/OutOfCreditsPanel", () => ({ OutOfCreditsPanel: () => <p>panel</p> }));

import { LectureBar } from "../LectureBar";
import { LectureButton } from "../LectureButton";
import { LECTURE_COPY } from "../lectureView";
import type { LectureHandle, LectureLiveState } from "../useLecture";

/** the markup with its entities read back (apostrophes are escaped) */
const render = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

function handle(status: LectureHandle["status"], snapshot: Partial<LectureSnapshot> | null = null, over: Partial<LectureHandle> = {}): LectureHandle {
  const state: LectureLiveState | null = snapshot
    ? {
        at: 0,
        snapshot: {
          status: status === "paused" ? "paused" : "listening",
          source: "script",
          speech: "listening",
          error: null,
          notice: null,
          thinking: false,
          forcing: false,
          drawing: false,
          updating: null,
          liveVisual: false,
          pace: "normal",
          ...snapshot,
          stats: {
            elapsedMs: 125_000,
            words: 12,
            sketches: 1,
            lastWhat: "cycle: evaporation → condensation",
            lastVerb: "drew",
            partial: "and then it rains",
            lines: ["The water cycle has four stages."],
            ...snapshot.stats,
          },
        },
      }
    : null;
  const noop = vi.fn();
  return {
    status,
    error: null,
    source: null,
    live: { subscribe: () => () => undefined, get: () => state },
    start: noop,
    confirmConsent: noop,
    cancelConsent: noop,
    stop: noop,
    pause: noop,
    resume: noop,
    drawThat: noop,
    startScripted: noop,
    ...over,
  };
}

describe("LectureBar", () => {
  it("renders nothing when off", () => {
    expect(render(<LectureBar lecture={handle("off")} />)).toBe("");
  });

  it("the consent note: its words and its two buttons", () => {
    const html = render(<LectureBar lecture={handle("consent")} />);
    expect(html).toContain("We keep the words, never the audio.");
    expect(html).toContain(LECTURE_COPY.consent.start);
    expect(html).toContain(LECTURE_COPY.consent.cancel);
    expect(html).toContain('data-lecture-bar="consent"');
  });

  it("listening: the dot, the timer, the words, what was drawn, and the three controls", () => {
    const html = render(<LectureBar lecture={handle("listening", {})} />);
    expect(html).toContain("Listening");
    expect(html).toContain("2:05");
    expect(html).toContain("The water cycle has four stages.");
    expect(html).toContain("and then it rains");
    expect(html).toContain("Drew:");
    expect(html).toContain("cycle: evaporation → condensation");
    expect(html).not.toContain(LECTURE_COPY.live); // no live visual yet
    expect(html).toContain(LECTURE_COPY.drawThat);
    expect(html).toContain(`aria-label="${LECTURE_COPY.pause}"`);
    expect(html).toContain(`aria-label="${LECTURE_COPY.stop}"`);
    expect(html).toContain("animate-[ping_1.8s"); // the recording dot's ring
    // the panel sits above tldraw's toolbar, centred, and fits a 400 px board (16 px each side)
    expect(html).toContain("bottom-20");
    expect(html).toContain("px-4");
    expect(html).toContain("max-w-[480px]");
  });

  it("paused: Resume instead of Pause, no pulsing dot", () => {
    const html = render(<LectureBar lecture={handle("paused", { status: "paused" })} />);
    expect(html).toContain(`aria-label="${LECTURE_COPY.resume}"`);
    expect(html).not.toContain("animate-[ping_1.8s");
  });

  it("sketching shows while the board writes; an update says so", () => {
    expect(render(<LectureBar lecture={handle("listening", { drawing: true })} />)).toContain("Sketching…");
    expect(render(<LectureBar lecture={handle("listening", { drawing: true, updating: "chart" })} />)).toContain("Updating the chart…");
  });

  it("a live chart: the Live pulse, and what was updated", () => {
    const html = render(<LectureBar lecture={handle("listening", { liveVisual: true, stats: { lastWhat: "bar chart: Sales by quarter", lastVerb: "updated" } as LectureSnapshot["stats"] })} />);
    expect(html).toContain(`>${LECTURE_COPY.live}<`);
    expect(html).toContain("Updated:");
    expect(html).toContain("bar chart: Sales by quarter");
  });

  it("an error: its words and a way out", () => {
    const html = render(<LectureBar lecture={handle("error", null, { error: "mic-denied" })} />);
    expect(html).toContain(LECTURE_COPY.errors["mic-denied"]);
    expect(html).toContain(LECTURE_COPY.tryAgain);
    expect(html).toContain(LECTURE_COPY.close);
  });

  it("out of credits: the board's out-of-credits panel (its short form while it loads)", () => {
    const html = render(<LectureBar lecture={handle("error", null, { error: "credits" })} />);
    expect(html).toContain(LECTURE_COPY.errors.credits);
    expect(html).not.toContain(LECTURE_COPY.tryAgain);
  });
});

describe("LectureButton", () => {
  it("off: turns lecture mode on", () => {
    const html = render(<LectureButton lecture={handle("off")} />);
    expect(html).toContain(">Lecture<");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(`title="${LECTURE_COPY.buttonHint}"`);
  });

  it("listening: pressed, with the recording dot", () => {
    const html = render(<LectureButton lecture={handle("listening")} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("bg-red-500");
    expect(html).toContain(`title="${LECTURE_COPY.stopHint}"`);
  });
});
