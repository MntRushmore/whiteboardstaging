/**
 * The picture tutor's words: the tutor prompt as the measured run sent it, Reed's painter prompt in
 * its voice form with the tutor's instructions, and the reply readers (the picture is taken only from
 * the reply's image fields, never from a URL in its text).
 */
import { describe, expect, it } from "vitest";
import { MAX_CHECKS, MODE_RULE, parseTutorReply, PICTURE_RULES, RIGHT_WORK_RULES, SIMPLE_RULE, tutorMessages, tutorText } from "../prompts";
import { getModePrompt, pictureUrlOf, REED_VOICE_INSTRUCTIONS, reedChatBody, reedPrompt } from "../reed";

describe("the tutor prompt", () => {
  it("is the measured run's text, line for line, with the v1.0 K–8 picture and right-work rules", () => {
    expect(tutorText("feedback").split("\n")).toEqual([
      'The picture is the student\'s whiteboard. The board\'s assistance mode is "feedback".',
      "First decide whether the student needs help: a mistake, unfinished work, a question, or being stuck. Finished correct work, doodles and a word still being written do not need help.",
      ...RIGHT_WORK_RULES,
      'If they need help, write the instructions for your tool draw_on_canvas (Use the Gemini 3 Pro canvas solver to add feedback, hints, or full solutions directly onto the whiteboard image.) with mode "feedback": exactly what to add to the board and where — the words, numbers, marks and arrows, each next to the part of the student\'s work it is about. Be exactly right about the maths. Under 50 words, or under 90 for a picture.',
      ...PICTURE_RULES,
      "Put additions in the empty space beside the work, at the same size as the student's writing; if there is not room for everything, write less.",
      "Never ask to circle, ring, box or rewrite any of the student's writing; point at it with an arrow from your note instead.",
      "Mode feedback: point out the mistake and where it is in a note of at most 10 words; do not write the corrected answer.",
      '"correct" is true only when the board has finished maths work and every step of it is right (then needsHelp is false); false for doodles, words, unfinished or wrong work.',
      expect.stringMatching(/^"checks": when the instructions draw a picture or write numbers/),
      expect.stringMatching(/^"answer": the problem's final answer/),
      'Reply with only this JSON, nothing before or after it: {"needsHelp": true or false, "correct": true or false, "instructions": "...", "checks": ["..."], "answer": "..."}',
    ]);
    expect(MODE_RULE.suggest).toBe("Mode suggest: give a hint for the next step only; never write the answer.");
    expect(MODE_RULE.answer).toBe("Mode answer (Solve): write the complete worked solution, every step, ending with the final answer.");
  });

  it("asks for the picture a kid asked for, with every count, and dark shading (the 11-13 demo)", () => {
    const t = tutorText("suggest");
    expect(t).toContain("MUST draw that picture, never words alone");
    expect(t).toContain("for EACH number, exactly how many tens rods");
    expect(t).toContain("bars of the SAME length");
    expect(t).toContain("never a pale fill");
    // right work stays right: the tutor's own blue picture plus the kid's answer is a checkmark
    expect(t).toContain("Blue ink on the board is the tutor's own earlier help");
    expect(t).toContain("the lower line is their answer");
    // a picture asked for is never Solve's plain-arithmetic shortcut
    expect(SIMPLE_RULE).toContain("nothing on the board asks for a picture or a model");
  });

  it("reads the checks and the answer only when something is drawn", () => {
    const many = JSON.stringify(Array.from({ length: 9 }, (_, i) => `check ${i}`));
    const d = parseTutorReply(`{"needsHelp": true, "instructions": "Draw 4 rods", "checks": ${many}, "answer": " 85 "}`, 1000);
    expect(d?.checks).toHaveLength(MAX_CHECKS);
    expect(d?.answer).toBe("85");
    expect(parseTutorReply('{"needsHelp": true, "instructions": "x", "checks": ["", 3, "ok"]}', 1000)?.checks).toEqual(["ok"]);
    expect(parseTutorReply('{"needsHelp": false, "correct": true, "instructions": "", "checks": ["a"], "answer": "85"}', 1000)).toEqual({ needsHelp: false, instructions: "", correct: true });
  });

  it("sends Reed's voice tutor as the system, then the board image, then the text", () => {
    const m = tutorMessages("suggest", "data:image/png;base64,AAAA");
    expect(m[0]).toEqual({ role: "system", content: REED_VOICE_INSTRUCTIONS });
    expect(m[1].content).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      { type: "text", text: tutorText("suggest") },
    ]);
  });

  it("reads \"correct\" only when the work needs no help (2026-10-26: a checkmark for right work)", () => {
    expect(parseTutorReply('{"needsHelp": false, "correct": true, "instructions": ""}', 1000)).toEqual({ needsHelp: false, instructions: "", correct: true });
    expect(parseTutorReply('{"needsHelp": true, "correct": true, "instructions": "Look at 7"}', 1000)).toEqual({ needsHelp: true, instructions: "Look at 7" });
    expect(parseTutorReply('{"needsHelp": false, "correct": false, "instructions": ""}', 1000)).toEqual({ needsHelp: false, instructions: "" });
  });

  it("asks Solve, and only Solve, for plain arithmetic as \"simple\" (the regular tutor writes it)", () => {
    expect(tutorText("answer")).toContain(SIMPLE_RULE);
    expect(tutorText("feedback")).not.toContain(SIMPLE_RULE);
    expect(parseTutorReply('{"needsHelp": true, "simple": "1+1", "wroteEquals": true, "instructions": ""}', 1000)).toEqual({ needsHelp: true, instructions: "", simple: "1+1", wroteEquals: true });
    expect(parseTutorReply('{"needsHelp": true, "simple": "  ", "instructions": "x"}', 1000)).toEqual({ needsHelp: true, instructions: "x" });
  });

  it("reads the reply from the first { to the last }", () => {
    expect(parseTutorReply('```json\n{"needsHelp": true, "instructions": " Circle the 7. "}\n```', 1000)).toEqual({ needsHelp: true, instructions: "Circle the 7." });
    expect(parseTutorReply('Sure! {"needsHelp": false, "instructions": ""} done', 1000)).toEqual({ needsHelp: false, instructions: "" });
    expect(parseTutorReply('{"needsHelp": true, "instructions": "' + "x".repeat(50) + '"}', 10)?.instructions).toHaveLength(10);
    expect(parseTutorReply("no json here", 1000)).toBeNull();
    expect(parseTutorReply('{"needsHelp": "yes"}', 1000)).toBeNull();
    expect(parseTutorReply('{"needsHelp": tru', 1000)).toBeNull();
  });
});

describe("Reed's painter prompt", () => {
  it("in its voice form always asks for a picture, and carries the tutor's instructions", () => {
    const p = reedPrompt("feedback", "voice", "Circle the 7 in red.");
    expect(p.startsWith(getModePrompt("feedback", "voice"))).toBe(true);
    expect(p).toContain("- ALWAYS generate an updated image of the canvas; do not respond with text-only.");
    expect(p).not.toContain("If the user does NOT seem to need help");
    expect(p.endsWith("\n\nAdditional drawing instructions from the tutor:\nCircle the 7 in red.")).toBe(true);
    expect(reedPrompt("answer", "voice", null)).toBe(getModePrompt("answer", "voice"));
  });

  it("is sent as Reed's body: the image part, then the text, image and text out, minimal reasoning", () => {
    expect(reedChatBody("m", "data:image/png;base64,AAAA", "P")).toEqual({
      model: "m",
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }, { type: "text", text: "P" }] }],
      modalities: ["image", "text"],
      reasoning_effort: "minimal",
    });
  });
});

describe("pictureUrlOf", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgo=";

  it("takes message.images[0].image_url.url, or an image part of the content", () => {
    expect(pictureUrlOf({ images: [{ image_url: { url: PNG } }] })).toBe(PNG);
    expect(pictureUrlOf({ content: [{ type: "text", text: "here" }, { type: "image_url", image_url: { url: PNG } }] })).toBe(PNG);
    expect(pictureUrlOf({ content: [{ type: "output_image", url: PNG }] })).toBe(PNG);
  });

  it("never takes a URL out of the reply's text (imgur's 'image does not exist' once covered a board)", () => {
    expect(pictureUrlOf({ content: `Here you go: ${PNG}` })).toBeNull();
    expect(pictureUrlOf({ content: "Here you go: https://i.imgur.com/abc123.png" })).toBeNull();
    expect(pictureUrlOf({ content: [{ type: "text", text: "https://i.imgur.com/abc123.png" }] })).toBeNull();
  });

  it("never takes a remote URL even in an image field (the server does not fetch what a model wrote)", () => {
    expect(pictureUrlOf({ images: [{ image_url: { url: "https://i.imgur.com/abc123.png" } }] })).toBeNull();
    expect(pictureUrlOf(null)).toBeNull();
    expect(pictureUrlOf({ images: [] })).toBeNull();
  });
});
