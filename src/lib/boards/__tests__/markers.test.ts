import { describe, expect, it } from "vitest";
import { askKickoffKey, ASK_KICKOFF_MAX, clearAskKickoff, readAskKickoff, writeAskKickoff } from "../askKickoff";
import { MARKER_TTL_MS, readMarker, type StorageLike } from "../deviceMarker";
import { hasPracticeMarker, practiceMarkerKey, readPracticeMarker, writePracticeMarker } from "@/lib/learning/practiceMarker";

function memory(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

const NOW = 5_000_000;

describe("the Ask kickoff marker", () => {
  it("round trip: written by the home, read by the board, left until it is sent", () => {
    const s = memory();
    expect(writeAskKickoff({ boardId: "b1", message: "  test on quadratics Friday ", createdAt: NOW }, s)).toBe(true);
    expect(readAskKickoff("b1", NOW + 1000, s)).toEqual({ boardId: "b1", message: "test on quadratics Friday", createdAt: NOW });
    // a remount reads it again: only the send clears it
    expect(readAskKickoff("b1", NOW + 2000, s)?.message).toBe("test on quadratics Friday");
    clearAskKickoff("b1", s);
    expect(readAskKickoff("b1", NOW + 3000, s)).toBeNull();
  });

  it("nothing to send, another board's, too old or unreadable: none (and cleared)", () => {
    const s = memory();
    expect(writeAskKickoff({ boardId: "b1", message: "   ", createdAt: NOW }, s)).toBe(false);
    expect(s.map.size).toBe(0);
    writeAskKickoff({ boardId: "b1", message: "fractions", createdAt: NOW }, s);
    expect(readAskKickoff("b2", NOW, s)).toBeNull();
    expect(readAskKickoff("b1", NOW + MARKER_TTL_MS + 1, s)).toBeNull();
    expect(s.map.has(askKickoffKey("b1"))).toBe(false);
    s.setItem(askKickoffKey("b3"), "{not json");
    expect(readAskKickoff("b3", NOW, s)).toBeNull();
    expect(s.map.has(askKickoffKey("b3"))).toBe(false);
    s.setItem(askKickoffKey("b4"), JSON.stringify({ boardId: "b4", message: 3, createdAt: NOW }));
    expect(readAskKickoff("b4", NOW, s)).toBeNull();
  });

  it("at most the chat's message length", () => {
    const s = memory();
    writeAskKickoff({ boardId: "b1", message: "x".repeat(ASK_KICKOFF_MAX + 50), createdAt: NOW }, s);
    expect(readAskKickoff("b1", NOW, s)?.message).toHaveLength(ASK_KICKOFF_MAX);
  });

  it("no storage (private mode, a refusing browser): nothing written, nothing read, nothing thrown", () => {
    const refusing: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(writeAskKickoff({ boardId: "b1", message: "fractions", createdAt: NOW }, refusing)).toBe(false);
    expect(readAskKickoff("b1", NOW, refusing)).toBeNull();
    expect(() => clearAskKickoff("b1", refusing)).not.toThrow();
    expect(writeAskKickoff({ boardId: "b1", message: "fractions", createdAt: NOW }, null)).toBe(false);
    expect(readMarker("k", () => true, NOW, null)).toBeNull();
  });
});

describe("the practice marker, with a topic's examples", () => {
  const problems = [["2x + 3 = 11"], ["5x - 4 = 21"]];

  it("keeps a topic's worked-example candidates; a practice marker has none", () => {
    const s = memory();
    writePracticeMarker({ boardId: "b1", skill: "two_step_equations", problems, examples: [["3x + 1 = 7"]], createdAt: NOW }, s);
    expect(readPracticeMarker("b1", NOW, s)?.examples).toEqual([["3x + 1 = 7"]]);
    writePracticeMarker({ boardId: "b2", skill: "two_step_equations", problems, createdAt: NOW }, s);
    expect(hasPracticeMarker("b2", s)).toBe(true);
    expect(readPracticeMarker("b2", NOW, s)?.examples).toBeUndefined();
  });

  it("refuses (and clears) a marker whose examples are not problems", () => {
    const s = memory();
    s.setItem(practiceMarkerKey("b1"), JSON.stringify({ boardId: "b1", skill: "fractions", problems, examples: [[]], createdAt: NOW }));
    expect(readPracticeMarker("b1", NOW, s)).toBeNull();
    expect(hasPracticeMarker("b1", s)).toBe(false);
    s.setItem(practiceMarkerKey("b2"), JSON.stringify({ boardId: "b2", skill: "fractions", problems, examples: "3x", createdAt: NOW }));
    expect(readPracticeMarker("b2", NOW, s)).toBeNull();
  });
});
