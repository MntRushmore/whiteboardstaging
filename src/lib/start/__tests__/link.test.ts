/**
 * "Send it to my grown-up": the answers in a link (`?a=`, base64url JSON), read back checked.
 * Only the answers go in; junk, an oversize value and unknown fields are dropped, never refused.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_ANSWERS, START_ANSWERS_PARAM, START_PATH, type StartAnswers } from "../contracts";
import { cleanStartAnswers, decodeStartAnswers, encodeStartAnswers, MAX_START_ANSWERS_PARAM, startAnswersLink } from "../link";

const SAM: StartAnswers = {
  role: "kid",
  name: "Sam",
  choice: { kind: "grade", grade: 3 },
  focus: ["times_tables", "division_facts"],
  tried: { checked: true, solved: false },
  heardFrom: "tiktok",
};

/** base64url of any JSON, as a hand-made link would carry it */
function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

describe("encodeStartAnswers / decodeStartAnswers", () => {
  it("round-trips every answer", () => {
    expect(decodeStartAnswers(encodeStartAnswers(SAM))).toEqual(SAM);
    const parent: StartAnswers = { role: "parent", name: null, choice: { kind: "course", course: "algebra2" }, focus: [], tried: null, heardFrom: null };
    expect(decodeStartAnswers(encodeStartAnswers(parent))).toEqual(parent);
    expect(decodeStartAnswers(encodeStartAnswers(EMPTY_ANSWERS))).toEqual(EMPTY_ANSWERS);
  });

  it("is URL-safe as it is (base64url, no padding) and keeps a name with accents", () => {
    const zoe = { ...SAM, name: "Zoë-Anne O'Brien" };
    const value = encodeStartAnswers(zoe);
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(value)).toBe(value);
    expect(decodeStartAnswers(value)?.name).toBe("Zoë-Anne O'Brien");
  });

  it("puts only the six answers in the link, never anything else handed to it", () => {
    const sneaky = { ...SAM, email: "parent@example.com", userId: "u-1", password: "hunter22" } as unknown as StartAnswers;
    const json = Buffer.from(encodeStartAnswers(sneaky), "base64url").toString("utf8");
    expect(Object.keys(JSON.parse(json))).toEqual(["role", "name", "choice", "focus", "tried", "heardFrom"]);
    expect(json).not.toContain("@");
    expect(json).not.toContain("hunter22");
    expect(json).not.toContain("u-1");
  });

  it("reads junk as nothing", () => {
    for (const junk of [null, undefined, "", "!!!", "not base64 at all", "a", b64("just a string"), b64([1, 2]), b64(null), "eyJyb2xlIjoia2lkIg"]) {
      expect(decodeStartAnswers(junk as string), String(junk)).toBeNull();
    }
    // not UTF-8
    expect(decodeStartAnswers(Buffer.from([0xff, 0xfe, 0xfd]).toString("base64url"))).toBeNull();
  });

  it("refuses an oversize value without parsing it", () => {
    const huge = b64({ ...SAM, padding: "x".repeat(2000) });
    expect(huge.length).toBeGreaterThan(MAX_START_ANSWERS_PARAM);
    expect(decodeStartAnswers(huge)).toBeNull();
    // a real link is far under the cap
    expect(encodeStartAnswers({ ...SAM, name: "Maximiliana-Josephine Q" }).length).toBeLessThan(MAX_START_ANSWERS_PARAM / 2);
  });

  it("drops unknown fields and wrong values field by field, keeping the rest", () => {
    const decoded = decodeStartAnswers(
      b64({
        role: "teacher",
        name: "<script>",
        choice: { kind: "course", course: "astrology" },
        focus: ["times_tables", "not_a_skill", "times_tables"],
        tried: { checked: "yes" },
        heardFrom: "billboard",
        email: "parent@example.com",
        extra: { nested: true },
      }),
    );
    expect(decoded).toEqual({ role: null, name: null, choice: null, focus: ["times_tables"], tried: null, heardFrom: null });
    // more skills than MAX_FOCUS: the list is dropped whole (the contract's schema)
    expect(decodeStartAnswers(b64({ ...SAM, focus: ["times_tables", "long_division", "percents", "proportions"] }))?.focus).toEqual([]);
    expect(decoded).not.toHaveProperty("email");
    expect(decoded).not.toHaveProperty("extra");
    // a grade out of range, a fractional one
    expect(decodeStartAnswers(b64({ ...SAM, choice: { kind: "grade", grade: 9 } }))?.choice).toBeNull();
    expect(decodeStartAnswers(b64({ ...SAM, choice: { kind: "grade", grade: 2.5 } }))?.choice).toBeNull();
    // a name is trimmed, and must look like a first name
    expect(decodeStartAnswers(b64({ ...SAM, name: "  Sam  " }))?.name).toBe("Sam");
    expect(decodeStartAnswers(b64({ ...SAM, name: "Sam123" }))?.name).toBeNull();
    expect(decodeStartAnswers(b64({ ...SAM, name: "A".repeat(30) }))?.name).toBeNull();
  });

  it("an empty object is the empty answers (an old or hand-trimmed link still opens /start)", () => {
    expect(decodeStartAnswers(b64({}))).toEqual(EMPTY_ANSWERS);
    expect(cleanStartAnswers({})).toEqual(EMPTY_ANSWERS);
    expect(cleanStartAnswers("nope")).toBeNull();
    expect(cleanStartAnswers([SAM])).toBeNull();
  });
});

describe("startAnswersLink", () => {
  it("reopens /start with the answers in #a=, never in the query", () => {
    const link = startAnswersLink("https://www.agathon.app/", SAM);
    const url = new URL(link);
    expect(url.origin).toBe("https://www.agathon.app");
    expect(url.pathname).toBe(START_PATH);
    expect(url.search).toBe("");
    expect(decodeStartAnswers(new URLSearchParams(url.hash.slice(1)).get(START_ANSWERS_PARAM))).toEqual(SAM);
  });
});

describe("the grown-up link keeps the answers in its fragment", () => {
  it("puts them after #, never in the query, and reads them back from location.hash", async () => {
    const { startAnswersLink, answersFromHash } = await import("../link");
    const answers = { role: "kid", name: "Sam", choice: { kind: "grade", grade: 3 }, focus: ["times_tables"], tried: null, heardFrom: null } as const;
    const link = startAnswersLink("https://www.agathon.app/", answers);
    const url = new URL(link);
    expect(url.pathname).toBe("/start");
    expect(url.search).toBe("");
    expect(url.hash.startsWith("#a=")).toBe(true);
    expect(answersFromHash(url.hash)).toMatchObject({ role: "kid", name: "Sam", choice: { kind: "grade", grade: 3 }, focus: ["times_tables"] });
    expect(answersFromHash("")).toBeNull();
    expect(answersFromHash("#b=1")).toBeNull();
    expect(answersFromHash("#a=not-base64!!")).toBeNull();
  });
});
