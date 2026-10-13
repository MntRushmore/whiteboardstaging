/**
 * The try marker (src/lib/try/marker.ts) and the one-time `try_board` step after a sign-in
 * (src/lib/try/afterSignIn.ts, called by AttributionCapture): what the device keeps, that it only
 * merges upward, that it is recorded once per account and never for an account older than the try
 * or a kid profile, and that nothing throws when storage is blocked. Storage and the recorder are
 * fakes; no network.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/funnel/record", () => ({ recordFunnelStep: vi.fn(async () => undefined) }));

const { TRY_MARKER_KEY } = await import("../contracts");
const { markTryRecorded, readTryMarker, TRY_MARKER_STORAGE_KEY, TRY_RECORDED_KEY, TRY_SIGNUP_SLACK_MS, tryBoardDecision, writeTryMarker } = await import("../marker");
const { recordTryBoard } = await import("../afterSignIn");
const { recordFunnelStep } = await import("@/lib/funnel/record");

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  };
}
const blocked = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

const T0 = new Date("2026-10-13T15:00:00.000Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

describe("the key", () => {
  it("is the contract's TRY_MARKER_KEY, here and in AttributionCapture (which cannot import the contract: it brings zod)", () => {
    expect(TRY_MARKER_STORAGE_KEY).toBe(TRY_MARKER_KEY);
    const capture = fs.readFileSync(path.join(process.cwd(), "src/components/funnel/AttributionCapture.tsx"), "utf8");
    expect(capture).toContain(`getItem(${JSON.stringify(TRY_MARKER_KEY)})`);
    expect(capture).not.toMatch(/from "@\/lib\/try\/contracts"/);
  });
});

describe("writeTryMarker", () => {
  it("the first verdict sets the time; checked and solved only ever turn on", () => {
    const s = memory();
    expect(writeTryMarker(s, { checked: false, solved: false }, T0)).toEqual({ at: T0.toISOString(), checked: false, solved: false });
    expect(writeTryMarker(s, { checked: true, solved: false }, later(1000))).toEqual({ at: T0.toISOString(), checked: true, solved: false });
    expect(writeTryMarker(s, { checked: false, solved: false }, later(2000))).toEqual({ at: T0.toISOString(), checked: true, solved: false });
    expect(writeTryMarker(s, { checked: false, solved: true }, later(3000))).toEqual({ at: T0.toISOString(), checked: true, solved: true });
    expect(writeTryMarker(s, { checked: false, solved: false }, later(4000))).toEqual({ at: T0.toISOString(), checked: true, solved: true });
    expect(JSON.parse(s.items.get(TRY_MARKER_KEY)!)).toEqual({ at: T0.toISOString(), checked: true, solved: true });
  });

  it("a solved line counts as checked", () => {
    expect(writeTryMarker(memory(), { checked: false, solved: true }, T0)).toMatchObject({ checked: true, solved: true });
  });

  it("never throws: blocked or missing storage keeps nothing", () => {
    expect(writeTryMarker(blocked, { checked: true, solved: false }, T0)).toBeNull();
    expect(writeTryMarker(null, { checked: true, solved: false }, T0)).toBeNull();
    expect(readTryMarker(blocked)).toBeNull();
  });

  it("ignores what is not a marker", () => {
    expect(readTryMarker(memory({ [TRY_MARKER_KEY]: "nope" }))).toBeNull();
    expect(readTryMarker(memory({ [TRY_MARKER_KEY]: JSON.stringify({ at: "yesterday" }) }))).toBeNull();
    expect(readTryMarker(memory({ [TRY_MARKER_KEY]: JSON.stringify({ at: T0.toISOString(), checked: "yes" }) }))).toEqual({ at: T0.toISOString(), checked: false, solved: false });
  });
});

describe("tryBoardDecision", () => {
  const tried = (checked = true, solved = false) => memory({ [TRY_MARKER_KEY]: JSON.stringify({ at: T0.toISOString(), checked, solved }) });

  it("sends { checked, solved } for an account made after the try", () => {
    expect(tryBoardDecision(tried(true, true), { id: "u1", created_at: later(60_000).toISOString() })).toEqual({ kind: "send", meta: { checked: true, solved: true } });
    // the device's clock a little ahead of the server's
    expect(tryBoardDecision(tried(), { id: "u1", created_at: later(-TRY_SIGNUP_SLACK_MS + 1000).toISOString() }).kind).toBe("send");
    // no creation time known: it is sent
    expect(tryBoardDecision(tried(), { id: "u1" }).kind).toBe("send");
  });

  it("skips an account made before the try (an old account trying the board later)", () => {
    expect(tryBoardDecision(tried(), { id: "u1", created_at: later(-TRY_SIGNUP_SLACK_MS - 1000).toISOString() })).toEqual({ kind: "skip" });
  });

  it("nothing without a marker, an account, or for a kid profile", () => {
    expect(tryBoardDecision(memory(), { id: "u1" })).toEqual({ kind: "none" });
    expect(tryBoardDecision(tried(), null)).toEqual({ kind: "none" });
    expect(tryBoardDecision(tried(), { id: "k1" }, true)).toEqual({ kind: "none" });
    expect(tryBoardDecision(null, { id: "u1" })).toEqual({ kind: "none" });
  });

  it("once per account: a recorded account is not sent again, another account on the device still is", () => {
    const s = tried();
    markTryRecorded(s, "u1");
    expect(tryBoardDecision(s, { id: "u1" })).toEqual({ kind: "none" });
    expect(tryBoardDecision(s, { id: "u2" }).kind).toBe("send");
    expect(JSON.parse(s.items.get(TRY_RECORDED_KEY)!)).toEqual(["u1"]);
  });
});

describe("recordTryBoard (after a sign-in)", () => {
  const tried = () => memory({ [TRY_MARKER_KEY]: JSON.stringify({ at: T0.toISOString(), checked: true, solved: false }) });

  it("records try_board with the marker's meta once, and never again for that account", async () => {
    const s = tried();
    const record = vi.fn(async () => undefined);
    await recordTryBoard({ id: "u1", email: "parent@example.com", created_at: later(5 * 60_000).toISOString() }, record, s);
    await recordTryBoard({ id: "u1", email: "parent@example.com", created_at: later(5 * 60_000).toISOString() }, record, s);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith("try_board", { checked: true, solved: false });
  });

  it("an older account is remembered without recording; a kid profile is left for its grown-up", async () => {
    const s = tried();
    const record = vi.fn(async () => undefined);
    await recordTryBoard({ id: "old", created_at: later(-24 * 3600_000).toISOString() }, record, s);
    expect(record).not.toHaveBeenCalled();
    expect(JSON.parse(s.items.get(TRY_RECORDED_KEY)!)).toEqual(["old"]);
    await recordTryBoard({ id: "kid", email: "kid.abc123@kids.agathon.app" }, record, s);
    expect(record).not.toHaveBeenCalled();
  });

  it("uses the app's recorder by default, and never throws on blocked storage", async () => {
    await expect(recordTryBoard({ id: "u1" }, undefined, blocked)).resolves.toBeUndefined();
    await recordTryBoard({ id: "u9" }, undefined, tried());
    expect(recordFunnelStep).toHaveBeenCalledWith("try_board", { checked: true, solved: false });
  });
});
