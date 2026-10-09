/**
 * Read aloud in the browser (`../readAloud.ts`) against fakes for the window, <audio>,
 * speechSynthesis, the session, the profile and the board: nothing is made for a student whose read
 * aloud is off (grade 3 and up by default), the watcher follows the setting, a touch's pointerdown
 * never primes the browser's voice, a check's notes are said as one phrase, and what the tutor says
 * on a K-2 board (a ringed line's note, the cheer or kind word beside a mark) reaches the speaker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "tldraw";
import { READ_ALOUD_KEY, readAloudKey } from "@/lib/speech/contracts";
import { celebrate, cheerWords, INITIAL_CELEBRATE, MISS_WORDS, type Cheer } from "@/lib/live/celebrate";

const env = vi.hoisted(() => ({
  user: "kid" as string | null,
  grades: {} as Record<string, number | null>,
  hints: [] as Array<{ id: string; message?: string; question?: string }>,
}));

vi.mock("tldraw", () => ({
  react: (_name: string, fn: () => void) => {
    fn();
    return () => undefined;
  },
}));
vi.mock("@/lib/billing/inkDialog", () => ({ penIsResting: () => true }));
vi.mock("@/lib/learning/profile", () => ({ readLearnerProfile: async (id: string) => ({ grade: env.grades[id] ?? null }) }));
vi.mock("@/lib/live/liveStore", () => ({ liveStore: { openHints: { get: () => env.hints } } }));
vi.mock("@/lib/logger", () => ({ clientMetric: () => undefined }));
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: env.user ? { user: { id: env.user }, access_token: "jwt" } : null } }) } },
}));
vi.mock("@/lib/speech/speakClient", () => ({ fetchSpeech: vi.fn(async () => new Blob(["mp3"])) }));

class FakeAudio {
  static made: FakeAudio[] = [];
  src = "";
  preload = "";
  played: string[] = [];
  constructor() {
    FakeAudio.made.push(this);
  }
  play(): Promise<void> {
    this.played.push(this.src);
    return Promise.resolve();
  }
  pause(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

class FakeUtterance {
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

const synth = { spoken: [] as FakeUtterance[], speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] };

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

type Changes = { added: Record<string, unknown>; updated: Record<string, [unknown, unknown]>; removed: Record<string, unknown> };

function fakeEditor() {
  let listener: ((e: { changes: Changes }) => void) | null = null;
  const editor = {
    on: vi.fn(),
    off: vi.fn(),
    inputs: { isPointing: false, isDragging: false, buttons: new Set() },
    store: {
      listen: vi.fn<(fn: (e: { changes: Changes }) => void, opts?: { scope: string; source: string }) => () => void>((fn) => {
        listener = fn;
        return () => {
          listener = null;
        };
      }),
    },
  };
  return {
    editor: editor as unknown as Editor,
    raw: editor,
    /** the live loop writes a model's notes as remote changes */
    remote: (changes: Partial<Changes>) => listener?.({ changes: { added: {}, updated: {}, removed: {}, ...changes } }),
  };
}

/** A line's readback, ringed, with the check model's note on it (liveLoop's `AI_NOTE_META`). */
const ringed = (id: string, note: string) => ({ id, typeName: "shape", type: "math", meta: { aiNote: true }, props: { status: "warn", note } });
const plain = (id: string) => ({ id, typeName: "shape", type: "math", meta: {}, props: { status: "pending", note: "" } });

let win: EventTarget & { localStorage: Storage };
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

async function load() {
  const speakerModule = await import("@/lib/speech/speaker");
  const speak = vi.spyOn(speakerModule.Speaker.prototype, "speak").mockResolvedValue("voice");
  const m = await import("../readAloud");
  return { m, speak };
}

beforeEach(() => {
  vi.resetModules();
  env.user = "kid";
  env.grades = { kid: 1, older: 5 };
  env.hints = [];
  FakeAudio.made = [];
  synth.spoken = [];
  synth.speak.mockReset().mockImplementation((u: FakeUtterance) => void synth.spoken.push(u));
  win = Object.assign(new EventTarget(), { localStorage: memoryStorage(), speechSynthesis: synth });
  vi.stubGlobal("window", win);
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("read aloud off (grade 3 and up, nothing chosen): nothing is made", () => {
  it("no watcher, no speaker, and a tap never touches the page's audio", async () => {
    env.user = "older";
    const { m, speak } = await load();
    const board = fakeEditor();
    m.watchBoardWhileOn(board.editor);
    m.sayAuto("Nice!");
    await flush();
    for (const type of ["pointerdown", "pointerup", "touchend", "click"]) win.dispatchEvent(new Event(type));
    expect(board.raw.on).not.toHaveBeenCalled();
    expect(board.raw.store.listen).not.toHaveBeenCalled();
    expect(FakeAudio.made).toEqual([]);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it("switched on in Board options, for this student only: the watcher starts; off again, it stops", async () => {
    env.user = "older";
    const { m } = await load();
    const board = fakeEditor();
    m.watchBoardWhileOn(board.editor);
    await flush();
    m.setReadAloud(true);
    await vi.waitFor(() => expect(board.raw.on).toHaveBeenCalledTimes(1));
    expect(win.localStorage.getItem(readAloudKey("older"))).toBe("on");
    expect(win.localStorage.getItem(readAloudKey("kid"))).toBeNull();
    m.setReadAloud(false);
    await vi.waitFor(() => expect(board.raw.off).toHaveBeenCalledTimes(1));
  });
});

describe("read aloud on (K-2 by default)", () => {
  it("the watcher starts; a touch's pointerdown unlocks the audio but primes the voice only on the pointerup", async () => {
    const { m } = await load();
    const board = fakeEditor();
    m.watchBoardWhileOn(board.editor);
    await vi.waitFor(() => expect(board.raw.on).toHaveBeenCalled());
    expect(FakeAudio.made).toHaveLength(1);

    win.dispatchEvent(new Event("pointerdown"));
    expect(FakeAudio.made[0].played[0]).toMatch(/^data:audio\/wav;base64,/);
    expect(synth.speak).not.toHaveBeenCalled();
    win.dispatchEvent(new Event("pointerup"));
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0]).toMatchObject({ text: " ", volume: 0 });
  });

  it("a device-wide choice from before the setting was per user is taken over by the first student", async () => {
    win.localStorage.setItem(READ_ALOUD_KEY, "off");
    const { m } = await load();
    await expect(m.isReadAloudOn()).resolves.toBe(false);
    expect(win.localStorage.getItem(READ_ALOUD_KEY)).toBeNull();
    expect(win.localStorage.getItem(readAloudKey("kid"))).toBe("off");
  });

  it("a ringed line's note reaches the speaker, once the pen rests", async () => {
    vi.useFakeTimers();
    const { m, speak } = await load();
    const board = fakeEditor();
    m.watchBoardWhileOn(board.editor);
    await vi.waitFor(() => expect(board.raw.store.listen).toHaveBeenCalled());
    board.remote({ updated: { l1: [plain("l1"), ringed("l1", "Look again at the right side of line 2.")] } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(speak.mock.calls).toEqual([["Look again at the right side of line 2.", { waitForPause: true, polite: false }]]);
  });

  it("the cheer or kind word beside a mark reaches the speaker, politely (never over the tutor's note)", async () => {
    const { m, speak } = await load();
    const miss = celebrate(INITIAL_CELEBRATE, "l1", "circle").cheer as Cheer;
    const win1 = celebrate(INITIAL_CELEBRATE, "l2", "check").cheer as Cheer;
    // what Celebrations does with the bubble it shows
    m.sayAuto(cheerWords(miss), { polite: true });
    m.sayAuto(cheerWords(win1), { polite: true });
    await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(2));
    expect(speak.mock.calls).toEqual([
      [MISS_WORDS[0], { waitForPause: true, polite: true }],
      ["Nice!", { waitForPause: true, polite: true }],
    ]);
  });

  it("a check's notes in a burst are said as one phrase, most important first, each once", async () => {
    vi.useFakeTimers();
    const { m, speak } = await load();
    const board = fakeEditor();
    m.watchBoardWhileOn(board.editor);
    await vi.waitFor(() => expect(board.raw.store.listen).toHaveBeenCalled());
    board.remote({ updated: { l2: [plain("l2"), ringed("l2", "Check the sign on line 2.")] } });
    await vi.advanceTimersByTimeAsync(300);
    board.remote({ added: { l3: ringed("l3", "Look at line 3.") } });
    board.remote({ updated: { l4: [plain("l4"), ringed("l4", "Check the sign on line 2.")] } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(speak.mock.calls.map((c) => c[0])).toEqual(["Check the sign on line 2. Look at line 3."]);
  });

  it("the student's own edits and the hint cards open before the watcher are never read", async () => {
    vi.useFakeTimers();
    env.hints = [{ id: "h1", message: "Old hint" }];
    const { m, speak } = await load();
    const board = fakeEditor();
    m.watchBoardWhileOn(board.editor);
    await vi.waitFor(() => expect(board.raw.store.listen).toHaveBeenCalled());
    expect(board.raw.store.listen.mock.calls[0][1]).toEqual({ scope: "document", source: "remote" });
    board.remote({ updated: { l1: [plain("l1"), plain("l1")] } });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(speak).not.toHaveBeenCalled();
  });
});
