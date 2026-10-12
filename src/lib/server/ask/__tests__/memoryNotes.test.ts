/**
 * What the tutor may remember (src/lib/server/ask/memoryNotes.ts): how a kid learns, never who they
 * are; the notes as stored; and the cheap guess that skips the memory model for a "thanks".
 */
import { describe, expect, it } from "vitest";
import { ASK_LIMITS } from "@/lib/live/ask/contracts";
import { cleanMemoryNote, cleanMemoryNotes, droppedNotes, memoryNoteAllowed, memoryWorthy, sameNotes } from "../memoryNotes";

describe("memoryNoteAllowed: how they learn", () => {
  it.each([
    "Gets stuck on borrowing across a zero",
    "Mixes up the bottom numbers when adding fractions",
    "A picture helps with fractions",
    "Likes word problems about animals",
    "Likes soccer and dinosaurs",
    "Likes Minecraft",
    "Likes Roblox and space",
    "Asked for shorter hints",
    "Wants to try first before getting help",
    "Tends to miss a step when subtracting",
    "Uses fact families to check subtraction",
    "Knows the Pythagorean Theorem but forgets to square root at the end",
    "Gets frustrated by long problems; one step at a time helps",
    "Struggles to add 3-digit numbers like 386 + 247",
    "Now adds unlike fractions on their own",
    "Word problems about pizza make fractions click",
  ])("keeps %j", (note) => {
    expect(memoryNoteAllowed(note)).toBe(true);
  });
});

describe("memoryNoteAllowed: never who they are", () => {
  it.each([
    // names
    ["a full name", "Maya Lopez likes word problems about dogs"],
    ["a name mid-note", "Likes problems about their dog Biscuit Jones"],
    ["a name said as one", "Their dog is named Biscuit"],
    ["a title and a name", "Says Mrs. Lee teaches it differently"],
    ["Miss and a name", "Practices with Miss Patel"],
    // school
    ["the school", "Goes to Lincoln Elementary"],
    ["a teacher", "Their teacher wants long division shown this way"],
    ["a classmate", "Compares scores with classmates"],
    // family and friends
    ["a parent", "Mom helps with homework at night"],
    ["a sibling", "Has a little brother who also does math"],
    ["a friend", "Does homework with a best friend"],
    ["family", "Family moved recently"],
    // where they live and how to reach them
    ["where they live", "Lives in Ohio near the lake"],
    ["an address", "Gave their street address by mistake"],
    ["an email", "Email is kid123@example.com"],
    ["a phone number", "Call 555-123-4567 after school"],
    ["a long number", "Zip is 94110"],
    ["a handle", "Plays as @mathwiz on games"],
    ["a website", "Watches videos on www.example.com"],
    ["a username", "Their Roblox username is MathKid"],
    // age and birthday
    ["a birthday", "Birthday is in May"],
    ["an age", "Is 9 years old"],
    // health
    ["a diagnosis", "Has ADHD and loses focus"],
    ["dyslexia", "Is dyslexic and reads slowly"],
    ["medicine", "Takes medication in the morning"],
    ["being sick", "Was sick last week and missed lessons"],
    // feelings and home life
    ["sadness", "Felt sad about their grades"],
    ["anxiety", "Gets anxious about timed tests"],
    ["bullying", "Is being bullied"],
    ["fear", "Is scared of getting it wrong"],
    ["crying", "Started crying on hard problems"],
    ["worry", "Worried about home"],
    // beliefs and background
    ["religion", "Goes to church on Sundays"],
    // and nothing that is not a note
    ["empty", "   "],
    ["no words", "12 + 7"],
    ["too long", "Likes word problems ".repeat(10)],
  ])("drops %s", (_what, note) => {
    expect(memoryNoteAllowed(note)).toBe(false);
  });

  it("is not fooled by a non-string", () => {
    expect(memoryNoteAllowed(42 as unknown as string)).toBe(false);
  });
});

describe("cleanMemoryNote / cleanMemoryNotes", () => {
  it("one line, single spaces, no list marker or quotes", () => {
    expect(cleanMemoryNote('  - "Likes   shorter\nhints"  ')).toBe("Likes shorter hints");
    expect(cleanMemoryNote("2. Gets stuck on borrowing")).toBe("Gets stuck on borrowing");
    expect(cleanMemoryNote("")).toBeNull();
    expect(cleanMemoryNote(7)).toBeNull();
  });

  it("cuts a long note at a word, within the cap", () => {
    const long = `Gets stuck when ${"the numbers get bigger and ".repeat(10)}end`;
    const cut = cleanMemoryNote(long)!;
    expect(cut.length).toBeLessThanOrEqual(ASK_LIMITS.memoryNote);
    expect(long.startsWith(cut)).toBe(true);
    expect(cut.endsWith(" ")).toBe(false);
  });

  it("drops personal notes and repeats, and keeps at most the cap", () => {
    const notes = cleanMemoryNotes([
      "Likes shorter hints",
      "likes shorter hints.",
      "Mom checks the homework",
      "Gets stuck on borrowing across a zero",
      7,
      ...Array.from({ length: 20 }, (_, i) => `Likes word problems about topic ${i}`),
    ]);
    expect(notes[0]).toBe("Likes shorter hints");
    expect(notes[1]).toBe("Gets stuck on borrowing across a zero");
    expect(notes).not.toContain("Mom checks the homework");
    expect(notes).toHaveLength(ASK_LIMITS.memoryNotes);
    expect(cleanMemoryNotes(null)).toEqual([]);
  });
});

describe("sameNotes / droppedNotes", () => {
  it("the same notes, case and end punctuation aside", () => {
    expect(sameNotes(["Likes hints."], ["likes hints"])).toBe(true);
    expect(sameNotes(["A", "B"], ["B", "A"])).toBe(false);
    expect(sameNotes(["A"], ["A", "B"])).toBe(false);
  });

  it("counts the notes that are gone", () => {
    expect(droppedNotes(["A", "B", "C"], ["b", "D"])).toBe(2);
    expect(droppedNotes([], ["A"])).toBe(0);
  });
});

describe("memoryWorthy: skip the model for an exchange that teaches nothing", () => {
  const reply = "Great job! 7 + 5 is 12.";
  it.each(["thanks!", "Thank you", "ok", "OK.", "yes", "nope", "lol", "hi", "12", "x = 3", "fractions"])("skips %j", (message) => {
    expect(memoryWorthy(message, reply)).toBe(false);
  });

  it.each([
    "I don't get fractions",
    "can you explain why",
    "shorter hints please",
    "I like dinosaurs",
    "what is 3/4 + 1/8?",
    "help me with long division",
    "stuck",
  ])("asks about %j", (message) => {
    expect(memoryWorthy(message, reply)).toBe(true);
  });

  it("skips an exchange with no reply", () => {
    expect(memoryWorthy("I don't get fractions", "  ")).toBe(false);
  });
});
