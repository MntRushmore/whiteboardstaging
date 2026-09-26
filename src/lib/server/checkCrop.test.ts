import { describe, expect, it } from "vitest";
import { CheckRequestSchema, SolveRequestSchema, type CheckRequest } from "@/lib/live/contracts";
import { buildCheckMessages, CHECK_SYSTEM_PROMPT } from "@/lib/server/prompts/check";
import { buildSolveMessages, SOLVE_SYSTEM_PROMPT } from "@/lib/server/prompts/solve";

/**
 * "Ask about this": Help on ink Live cannot read as maths sends a crop of that ink with an
 * ordinary check. The contract (schema), what the model sees (an image part), and the word
 * problem wording of the solve prompt.
 */

const CROP = "data:image/jpeg;base64,ZmFrZQ==";
const REGION = { x: 0, y: 0, w: 400, h: 200 };
const LINE = { id: "l1", latex: "", bbox: [0, 0, 1, 1] as [number, number, number, number], local: { kind: "unknown" as const, verdict: "unknown" as const } };
const base = { boardId: "board-1", mode: "feedback" as const, region: REGION, lines: [LINE], focusLineId: "l1" };

describe("CheckRequestSchema.crop", () => {
  it("accepts a data:image crop on an explicit request for a focus line", () => {
    const parsed = CheckRequestSchema.safeParse({ ...base, userAsked: true, crop: CROP });
    expect(parsed.success).toBe(true);
    // and a line with no LaTeX (a failed read) is a valid focus line
    expect(parsed.success && parsed.data.lines[0].latex).toBe("");
  });

  it("still accepts a check with no crop, userAsked defaulting to false", () => {
    const parsed = CheckRequestSchema.safeParse(base);
    expect(parsed.success && parsed.data.userAsked).toBe(false);
  });

  it("rejects a crop on an automatic check, or without a focus line", () => {
    expect(CheckRequestSchema.safeParse({ ...base, crop: CROP }).success).toBe(false);
    expect(CheckRequestSchema.safeParse({ ...base, userAsked: false, crop: CROP }).success).toBe(false);
    const { focusLineId: _f, ...noFocus } = base;
    void _f;
    expect(CheckRequestSchema.safeParse({ ...noFocus, userAsked: true, crop: CROP }).success).toBe(false);
  });

  it("rejects anything that is not a data:image URL, and anything over the recognize crop cap", () => {
    expect(CheckRequestSchema.safeParse({ ...base, userAsked: true, crop: "https://example.com/x.png" }).success).toBe(false);
    expect(CheckRequestSchema.safeParse({ ...base, userAsked: true, crop: "data:text/html;base64,AAAA" }).success).toBe(false);
    const huge = `data:image/jpeg;base64,${"A".repeat(280_001)}`;
    expect(CheckRequestSchema.safeParse({ ...base, userAsked: true, crop: huge }).success).toBe(false);
  });
});

describe("buildCheckMessages", () => {
  it("sends the crop as an image_url part next to the usual text", () => {
    const req = CheckRequestSchema.parse({ ...base, userAsked: true, crop: CROP }) as CheckRequest;
    const [system, user] = buildCheckMessages(req);
    expect(system).toEqual({ role: "system", content: CHECK_SYSTEM_PROMPT });
    expect(Array.isArray(user.content)).toBe(true);
    const parts = user.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts.map((p) => p.type)).toEqual(["text", "image_url"]);
    expect(parts[1].image_url).toEqual({ url: CROP });
    expect(parts[0].text).toMatch(/image attached/);
    expect(parts[0].text).toMatch(/focus line id: l1/);
  });

  it("stays plain text without a crop (no image part is ever invented)", () => {
    const [, user] = buildCheckMessages(CheckRequestSchema.parse({ ...base, userAsked: true }) as CheckRequest);
    expect(typeof user.content).toBe("string");
    expect(user.content as string).not.toMatch(/image attached/);
  });

  it("tells the model what an attached image is, and that it answers in words", () => {
    expect(CHECK_SYSTEM_PROMPT).toMatch(/WHEN AN IMAGE IS ATTACHED/);
    expect(CHECK_SYSTEM_PROMPT).toMatch(/kind text is prose/);
  });
});

describe("buildSolveMessages — word problems", () => {
  const wordProblem = SolveRequestSchema.parse({
    boardId: "board-1",
    region: REGION,
    lines: [
      {
        id: "q",
        latex: "\\text{A train travels 60 km in 2 hours. What is its speed?}",
        bbox: [0, 0, 1, 1],
        local: { kind: "text", verdict: "none" },
      },
    ],
  });

  it("names text lines as the question and asks for assignment steps", () => {
    const [system, user] = buildSolveMessages(wordProblem);
    expect(system.content).toBe(SOLVE_SYSTEM_PROMPT);
    expect(SOLVE_SYSTEM_PROMPT).toMatch(/kind text are prose/);
    expect(SOLVE_SYSTEM_PROMPT).toMatch(/v = \\frac\{60\}\{2\}/);
    expect(user.content as string).toMatch(/word problem/);
    expect(user.content as string).toMatch(/kind: text/);
  });

  it("says nothing about word problems when there is no prose", () => {
    const [, user] = buildSolveMessages({ ...wordProblem, lines: [{ ...wordProblem.lines[0], latex: "2x+3=11", local: { kind: "equation", verdict: "none" } }] });
    expect(user.content as string).not.toMatch(/word problem/);
  });
});
