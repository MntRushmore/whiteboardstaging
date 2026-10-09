/**
 * A day's board counts on its own day, for its own student (`dailyMarkerFor`): yesterday's board
 * opened today, or a marker another profile on the same device left, is an ordinary board.
 */
import { describe, expect, it } from "vitest";
import type { StorageLike } from "@/lib/boards/deviceMarker";
import { dailyMarkerFor, readDailyMarker, writeDailyMarker } from "../dailyMarker";

const BOARD = "b1000000-0000-4000-8000-000000000001";
const KID = "u-kid";
const HOUR = 3_600_000;

function memory(): StorageLike {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe("dailyMarkerFor", () => {
  it("today's set, this student's: the board counts", () => {
    const storage = memory();
    writeDailyMarker({ boardId: BOARD, userId: KID, day: "2026-10-08", goal: 5, createdAt: 0 }, storage);
    expect(dailyMarkerFor(BOARD, { day: "2026-10-08", userId: KID }, HOUR, storage)).toMatchObject({ boardId: BOARD, userId: KID, day: "2026-10-08" });
  });

  it("yesterday's board opened today: no daily board (nothing counts toward yesterday, or today)", () => {
    const storage = memory();
    // Monday 8 pm's set, opened Tuesday at noon: still inside the marker's 36 hours
    writeDailyMarker({ boardId: BOARD, userId: KID, day: "2026-10-05", goal: 5, createdAt: 0 }, storage);
    expect(readDailyMarker(BOARD, 16 * HOUR, storage)).not.toBeNull();
    expect(dailyMarkerFor(BOARD, { day: "2026-10-06", userId: KID }, 16 * HOUR, storage)).toBeNull();
  });

  it("another student's marker on this device: not theirs", () => {
    const storage = memory();
    writeDailyMarker({ boardId: BOARD, userId: "u-sibling", day: "2026-10-08", goal: 5, createdAt: 0 }, storage);
    expect(dailyMarkerFor(BOARD, { day: "2026-10-08", userId: KID }, HOUR, storage)).toBeNull();
  });

  it("a marker from before markers named their student still counts on its own board, today", () => {
    const storage = memory();
    writeDailyMarker({ boardId: BOARD, day: "2026-10-08", goal: 5, createdAt: 0 }, storage);
    expect(dailyMarkerFor(BOARD, { day: "2026-10-08", userId: KID }, HOUR, storage)?.boardId).toBe(BOARD);
    expect(dailyMarkerFor(BOARD, { day: "2026-10-09", userId: KID }, HOUR, storage)).toBeNull();
  });

  it("a marker naming no one sensible is no marker", () => {
    const storage = memory();
    storage.setItem(`agathon.daily.${BOARD}`, JSON.stringify({ boardId: BOARD, userId: 7, day: "2026-10-08", goal: 5, createdAt: 0 }));
    expect(readDailyMarker(BOARD, HOUR, storage)).toBeNull();
  });
});
