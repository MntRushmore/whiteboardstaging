import { describe, expect, it, vi } from "vitest";
import { OUT_OF_INK_COPY } from "@/lib/billing/outOfInk";
import { LECTURE_TIMING } from "@/lib/live/lecture/contracts";
import type { LectureSnapshot } from "@/lib/live/lecture/session";
import { ROUTE_COSTS } from "@/lib/server/billing";
import {
  formatElapsed,
  handleStatusFor,
  hasLectureConsent,
  LECTURE_CONSENT_KEY,
  LECTURE_COPY,
  lectureBarModel,
  lectureBoardFor,
  lectureErrorView,
  rememberLectureConsent,
  TICKER_CHARS,
  tickerText,
} from "../lectureView";

function snap(over: Partial<LectureSnapshot> = {}, stats: Partial<LectureSnapshot["stats"]> = {}): LectureSnapshot {
  return {
    status: "listening",
    source: "elevenlabs",
    speech: "listening",
    error: null,
    notice: null,
    thinking: false,
    forcing: false,
    drawing: false,
    updating: null,
    sketching: null,
    liveVisual: false,
    pace: "normal",
    ...over,
    stats: { elapsedMs: 65_000, words: 30, sketches: 0, lastWhat: null, lastVerb: "drew", partial: "", lines: [], ...stats },
  };
}

const model = (s: LectureSnapshot, status: "listening" | "paused" = s.status === "paused" ? "paused" : "listening", now = 0) => lectureBarModel({ status, error: null, snap: s, now });

describe("lecture copy", () => {
  it("the consent note says what is kept, and what it costs matches the routes", () => {
    expect(LECTURE_COPY.consent.body).toBe(
      "Lecture mode listens through your microphone and sketches what's said. We keep the words, never the audio. Make sure recording is allowed in your class.",
    );
    expect(LECTURE_COPY.consent.start).toBe("Start listening");
    expect(LECTURE_COPY.consent.cancel).toBe("Cancel");
    // the director is billed per started minute of a session, plus 1 per speech session
    expect(ROUTE_COSTS["live/lecture"]).toBe(2);
    expect(ROUTE_COSTS["live/listen"]).toBe(1);
    expect(LECTURE_COPY.consent.cost).toMatch(/about 2 ink a minute/);
    // a picture is billed per panel the illustrator draws
    expect(LECTURE_COPY.consent.cost).toContain(`${ROUTE_COSTS["live/sketch"]} for each picture it draws`);
  });

  it("out of ink says what the board dialog says", () => {
    expect(LECTURE_COPY.errors.ink).toBe(OUT_OF_INK_COPY.title);
  });

  it("the idle notice names the real pause", () => {
    expect(LECTURE_TIMING.idlePauseMs).toBe(10 * 60_000);
    expect(LECTURE_COPY.notices.idle).toBe("Paused: nothing heard for 10 minutes.");
  });

  it("an unsupported browser is told which browsers work", () => {
    expect(LECTURE_COPY.errors.unsupported).toBe("Lecture mode needs Chrome, Edge or Safari.");
  });
});

describe("formatElapsed and the ticker", () => {
  it("formats the timer", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_900)).toBe("0:07");
    expect(formatElapsed(754_000)).toBe("12:34");
    expect(formatElapsed(3_729_000)).toBe("1:02:09");
    expect(formatElapsed(-5)).toBe("0:00");
  });

  it("keeps the newest words: the partial first, the finished lines trimmed from the front", () => {
    expect(tickerText(["Light is absorbed."], "then water")).toEqual({ heard: "Light is absorbed.", hearing: "then water" });
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const t = tickerText([long], "and now this");
    expect(t.hearing).toBe("and now this");
    expect(t.heard.startsWith("…")).toBe(true);
    expect(t.heard.endsWith("word39")).toBe(true);
    expect(t.heard.length + t.hearing.length).toBeLessThanOrEqual(TICKER_CHARS + 1);
    // a very long partial leaves no room for the lines
    expect(tickerText(["old"], "x ".repeat(200)).heard).toBe("");
  });
});

describe("lectureBarModel", () => {
  it("off: hidden; consent: the note; starting", () => {
    expect(lectureBarModel({ status: "off", error: null, snap: null, now: 0 }).mode).toBe("hidden");
    expect(lectureBarModel({ status: "consent", error: null, snap: null, now: 0 }).mode).toBe("consent");
    expect(lectureBarModel({ status: "starting", error: null, snap: null, now: 0 })).toMatchObject({ mode: "starting", label: LECTURE_COPY.starting });
  });

  it("listening: the live dot, the timer, the words", () => {
    const m = model(snap({}, { lines: ["Mitochondria make ATP."], partial: "through the electron" }));
    expect(m).toMatchObject({ mode: "active", label: "Listening", dot: "recording", liveVisual: false, timer: "1:05", heard: "Mitochondria make ATP.", hearing: "through the electron", placeholder: null, paused: false });
    expect(m.status).toEqual({ text: LECTURE_COPY.status.waiting, tone: "muted" });
    expect(m.drawThat).toEqual({ enabled: true, busy: false });
  });

  it("before anything is heard: a placeholder, and Draw that waits", () => {
    const m = model(snap({}, { words: 0 }));
    expect(m.placeholder).toBe(LECTURE_COPY.placeholder);
    expect(m.drawThat.enabled).toBe(false);
    expect(model(snap({ status: "paused" }, { words: 0 })).placeholder).toBe(LECTURE_COPY.pausedPlaceholder);
  });

  it("paused and reconnecting: a grey dot and their label", () => {
    expect(model(snap({ status: "paused" }))).toMatchObject({ label: "Paused", dot: "paused", paused: true });
    expect(model(snap({ speech: "reconnecting" }))).toMatchObject({ label: "Reconnecting…", dot: "reconnecting", paused: false });
  });

  it("what the tutor is doing: sketching, then looking (Draw that), then a notice, then what it drew", () => {
    const drew = snap({}, { lastWhat: "bar chart: GDP growth by year", sketches: 1 });
    expect(model(drew).status).toEqual({ lead: "Drew:", text: "bar chart: GDP growth by year", tone: "done" });
    expect(model(snap({}, { lastWhat: "bar chart: Sales", lastVerb: "updated" })).status).toEqual({ lead: "Updated:", text: "bar chart: Sales", tone: "done" });
    expect(model({ ...drew, notice: { kind: "retrying" } }).status).toEqual({ text: LECTURE_COPY.notices.retrying, tone: "notice" });
    expect(model({ ...drew, forcing: true }).status).toEqual({ text: LECTURE_COPY.status.looking, tone: "busy" });
    expect(model({ ...drew, forcing: true }).drawThat).toEqual({ enabled: false, busy: true });
    expect(model({ ...drew, forcing: true, drawing: true }).status).toEqual({ text: "Sketching…", tone: "busy" });
  });

  it("an update of a live visual says so, and the Live pulse shows while a visual is live (not while paused)", () => {
    expect(model(snap({ drawing: true, updating: "chart" })).status).toEqual({ text: "Updating the chart…", tone: "busy" });
    expect(model(snap({ drawing: true, updating: "diagram" })).status).toEqual({ text: "Updating the diagram…", tone: "busy" });
    expect(model(snap({ drawing: true, updating: null })).status.text).toBe("Sketching…");
    expect(model(snap({ liveVisual: true })).liveVisual).toBe(true);
    expect(model(snap({ status: "paused", liveVisual: true })).liveVisual).toBe(false);
  });

  it("a sketch: 'Drawing the comic…' (or 'Drawing…') while its frames go on and its panels come, then what it drew", () => {
    const busy = { tone: "busy" };
    expect(model(snap({ drawing: true, sketching: "comic" })).status).toEqual({ ...busy, text: "Drawing the comic…" });
    expect(model(snap({ drawing: true, sketching: "picture" })).status).toEqual({ ...busy, text: "Drawing…" });
    // the run is over, the panels are still coming: the words so far are not the news yet
    const loading = snap({ sketching: "comic" }, { lastWhat: "comic (4 panels): Officer Vega", sketches: 1 });
    expect(model(loading).status).toEqual({ ...busy, text: "Drawing the comic…" });
    // a chart updated meanwhile says so while it is written
    expect(model({ ...loading, drawing: true, updating: "chart" }).status.text).toBe("Updating the chart…");
    expect(model({ ...loading, sketching: null }).status).toEqual({ lead: "Drew:", text: "comic (4 panels): Officer Vega", tone: "done" });
  });

  it("notices in words", () => {
    const text = (notice: LectureSnapshot["notice"], now = 0) => model(snap({ notice }), "listening", now).status.text;
    expect(text({ kind: "idle" })).toBe(LECTURE_COPY.notices.idle);
    expect(text({ kind: "nothing" })).toBe(LECTURE_COPY.notices.nothing);
    expect(text({ kind: "nothing", note: "Nothing visual was said." })).toBe("Nothing visual was said.");
    expect(text({ kind: "empty" })).toBe(LECTURE_COPY.notices.empty);
    expect(text({ kind: "rate_limited", retryAtMs: 20_500 }, 10_000)).toBe("Taking a short break. Back in 11 s.");
    expect(text({ kind: "board_failed" })).toBe(LECTURE_COPY.notices.boardFailed);
    expect(text({ kind: "sketch_failed", failed: 1, panels: 4 })).toBe("Couldn't draw 1 of the 4 panels.");
    expect(text({ kind: "sketch_failed", failed: 4, panels: 4 })).toBe("Couldn't draw the comic.");
    expect(text({ kind: "sketch_failed", failed: 1, panels: 1 })).toBe("Couldn't draw that picture.");
  });

  it("errors: words for each, retry where trying again can help", () => {
    expect(lectureBarModel({ status: "error", error: "mic-denied", snap: null, now: 0 }).error).toEqual({ code: "mic-denied", message: LECTURE_COPY.errors["mic-denied"], ink: false, retry: true });
    expect(lectureErrorView("ink")).toMatchObject({ ink: true, retry: false });
    expect(lectureErrorView("unsupported").retry).toBe(false);
    expect(lectureErrorView("unauthorized").retry).toBe(false);
    expect(lectureErrorView("network").retry).toBe(true);
    // the handle's error wins; the snapshot's is the fallback
    expect(lectureBarModel({ status: "error", error: null, snap: snap({ status: "error", error: "board" }), now: 0 }).error?.code).toBe("board");
  });

  it("a stopped session is off", () => {
    expect(handleStatusFor({ status: "stopped" })).toBe("off");
    expect(handleStatusFor({ status: "paused" })).toBe("paused");
  });
});

describe("consent, once per device", () => {
  it("remembers it, and survives a storage that throws", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(hasLectureConsent(storage)).toBe(false);
    rememberLectureConsent(storage);
    expect(store.get(LECTURE_CONSENT_KEY)).toBe("1");
    expect(hasLectureConsent(storage)).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(hasLectureConsent(broken)).toBe(false);
    expect(() => rememberLectureConsent(broken)).not.toThrow();
    expect(hasLectureConsent(null)).toBe(false);
  });
});

describe("lectureBoardFor", () => {
  it("null when the controller has no lecture methods", () => {
    expect(lectureBoardFor(() => ({}))).toBeNull();
    expect(lectureBoardFor(() => ({ lectureScreen: () => ({ empty: true, topic: null, drawn: [], room: 1, active: [] }) }))).toBeNull();
  });

  it("calls the controller of the moment, as a method", async () => {
    const saved: string[] = [];
    const a = {
      name: "a",
      lectureScreen() {
        return { empty: this.name === "a", topic: null, drawn: [], room: 1, active: [] };
      },
      runLectureActions: vi.fn(async () => ({ outcomes: [], screensAdded: 0 })),
      saveLectureTranscript: (t: string) => void saved.push(`a:${t}`),
    };
    const b = { ...a, name: "b", saveLectureTranscript: (t: string) => void saved.push(`b:${t}`) };
    let current: typeof a = a;
    const board = lectureBoardFor(() => current)!;
    expect(board.screen().empty).toBe(true);
    board.saveTranscript("one");
    current = b;
    expect(board.screen().empty).toBe(false);
    board.saveTranscript("two");
    await board.run([{ type: "new_screen" }]);
    expect(saved).toEqual(["a:one", "b:two"]);
    expect(a.runLectureActions).toHaveBeenCalledWith([{ type: "new_screen" }], undefined);
    // a run's options (the way to the illustrator) reach the controller
    const opts = { onSketch: () => undefined };
    await board.run([{ type: "new_screen" }], opts);
    expect(a.runLectureActions).toHaveBeenLastCalledWith([{ type: "new_screen" }], opts);
    current = {} as typeof a;
    expect(() => board.screen()).toThrow(/no lectureScreen/);
  });
});
