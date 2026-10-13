/**
 * The /start screens as the server renders them (renderToStaticMarkup): what each one says and
 * offers for a grown-up and for a kid, and the try board's problem for a grade. The flow's logic is
 * src/lib/start/__tests__/flow.test.ts; the account screen is StartAccount.test.tsx.
 */
import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EMPTY_ANSWERS, type StartAnswers } from "@/lib/start/contracts";
import { flowCopy } from "@/lib/start/flow";
import type { StartInkLine, StartInkSet } from "@/lib/start/inkSet";
import { buildPlan } from "@/lib/start/plan";
import { TRY_PROBLEMS } from "@/lib/try/problems";

vi.mock("next/image", () => ({ default: (props: { alt: string; src: string }) => <span role="img" aria-label={props.alt} data-src={props.src} /> }));

const { StartWho } = await import("../screens/StartWho");
const { StartGrade } = await import("../screens/StartGrade");
const { StartFocus } = await import("../screens/StartFocus");
const { StartProof } = await import("../screens/StartProof");
const { StartBuilding } = await import("../screens/StartBuilding");
const { StartPlan } = await import("../screens/StartPlan");
const { tryBand, tryProblemFor } = await import("../screens/StartTry");

const SAM: StartAnswers = { ...EMPTY_ANSWERS, role: "parent", name: "Sam", choice: { kind: "grade", grade: 3 }, focus: ["times_tables"] };
const MAYA: StartAnswers = { ...SAM, role: "kid", name: "Maya" };
const ref = () => createRef<HTMLHeadingElement>();
const noop = () => undefined;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const LINE: StartInkLine = { strokes: [{ d: "M 0 0 L 10 10", w: 1, at: 0, for: 100 }], width: 40, height: 37, durationMs: 100 };
const INK: StartInkSet = { skills: { times_tables: { latex: ["6 \\times 7"], lines: [LINE] }, division_facts: { latex: ["42 \\div 6"], lines: [LINE] } }, problems: {} };

describe("who", () => {
  it("two big cards, nothing picked yet, each one a button", () => {
    const html = renderToStaticMarkup(<StartWho copy={flowCopy(EMPTY_ANSWERS).who} role={null} onPick={noop} motifs={{ parent: <i />, kid: <i /> }} titleRef={ref()} />);
    expect(text(html)).toContain("Who’s getting started?");
    expect(html.match(/<button[^>]*aria-pressed="false"/g)).toHaveLength(2);
    expect(text(html)).toMatch(/I’m a parent .* I’m a kid/);
  });

  it("the one picked is pressed", () => {
    const html = renderToStaticMarkup(<StartWho copy={flowCopy(SAM).who} role="parent" onPick={noop} motifs={{ parent: <i />, kid: <i /> }} titleRef={ref()} />);
    expect(html).toContain('data-role="parent" aria-pressed="true"');
    expect(html).toContain('data-role="kid" aria-pressed="false"');
  });
});

describe("grade", () => {
  it("nine tiles, Kindergarten to 8th, then High school", () => {
    const html = renderToStaticMarkup(<StartGrade copy={flowCopy(SAM).grade} choice={null} onPick={noop} titleRef={ref()} />);
    expect(text(html)).toContain("What grade is Sam in?");
    expect(html).toContain('aria-label="Kindergarten"');
    expect(html).toContain('aria-label="8th grade"');
    expect(text(html)).toContain("High school");
  });

  it("a course picked before: the courses open", () => {
    const html = renderToStaticMarkup(<StartGrade copy={flowCopy(MAYA).grade} choice={{ kind: "course", course: "geometry" }} onPick={noop} titleRef={ref()} />);
    expect(text(html)).toContain("Which class are you taking?");
    expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?Geometry/);
  });
});

describe("focus", () => {
  it("each skill with its example in the tutor's hand (its words for a screen reader), and Not sure", () => {
    const html = renderToStaticMarkup(<StartFocus copy={flowCopy(SAM).focus} options={["times_tables", "division_facts"]} focus={["times_tables"]} ink={INK} onToggle={noop} onNotSure={noop} onNext={noop} titleRef={ref()} />);
    expect(text(html)).toContain("What’s tricky for Sam right now?");
    expect(text(html)).toContain("Multiply facts like 6 × 7");
    expect(html.match(/<svg/g)?.length).toBeGreaterThanOrEqual(3); // two examples and one check
    expect(text(html)).toContain("Not sure");
    expect(text(html)).toContain("1 of 3 picked");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Continue/);
  });

  it("three picked: the rest wait, and Continue is ready", () => {
    const html = renderToStaticMarkup(
      <StartFocus copy={flowCopy(SAM).focus} options={["times_tables", "division_facts", "multiply_by_tens", "add_subtract_within_1000"]} focus={["times_tables", "division_facts", "multiply_by_tens"]} ink={null} onToggle={noop} onNotSure={noop} onNext={noop} titleRef={ref()} />,
    );
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(1);
    expect(text(html)).toContain("That’s 3.");
  });

  it("nothing picked: Continue waits", () => {
    const html = renderToStaticMarkup(<StartFocus copy={flowCopy(SAM).focus} options={["times_tables"]} focus={[]} ink={null} onToggle={noop} onNotSure={noop} onNext={noop} titleRef={ref()} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue/);
  });
});

describe("proof, the beat and the plan", () => {
  it("proof: the real Progress picture, and no claims beyond it", () => {
    const html = renderToStaticMarkup(<StartProof copy={flowCopy(SAM).proof} onNext={noop} titleRef={ref()} />);
    expect(html).toContain('data-src="/landing/progress-week.webp"');
    expect(text(html)).not.toMatch(/\d+%|families|parents love|best/i);
  });

  it("the beat: three true lines about the plan", () => {
    const html = renderToStaticMarkup(<StartBuilding copy={flowCopy(SAM).building} firstSkill="Times tables" onDone={noop} titleRef={ref()} />);
    expect(text(html)).toContain("Making Sam’s plan…");
    expect(text(html)).toContain("3rd grade problems");
    expect(text(html)).toContain("Starting with Times tables");
  });

  it("the plan: the path from the first skill, the first board, and the button to save it", () => {
    const html = renderToStaticMarkup(<StartPlan copy={flowCopy(SAM).plan} plan={buildPlan(SAM)} ink={INK} tried={{ checked: true, solved: true }} onSave={noop} titleRef={ref()} />);
    const words = text(html);
    expect(words).toContain("Sam’s plan is ready");
    expect(words).toMatch(/Start here Times tables .* Next 3-digit adding and subtracting .* Then Division facts/);
    expect(words).toContain("Solved one already");
    expect(words).toContain("Sam’s first board Times tables. Sam writes, and the tutor checks each line.");
    expect(words).toContain("Save Sam’s plan");
    expect(words).toContain("Free to save. No card needed.");
  });
});

describe("the try board's problem", () => {
  it("the grade's band, and the starter for the first skill at the kid's grade", () => {
    expect(tryBand({ kind: "grade", grade: 0 })).toBe("k2");
    expect(tryBand({ kind: "grade", grade: 4 })).toBe("g35");
    expect(tryBand({ kind: "grade", grade: 8 })).toBe("g68");
    expect(tryBand({ kind: "course", course: "algebra2" })).toBe("hs");
    expect(tryBand(null)).toBe("g35");
    const id = tryProblemFor({ kind: "grade", grade: 3 }, "times_tables");
    const p = TRY_PROBLEMS.find((q) => q.id === id);
    expect(p).toMatchObject({ band: "g35", grade: 3, skill: "times_tables" });
    // a skill with no starter: the grade's first
    expect(TRY_PROBLEMS.find((q) => q.id === tryProblemFor({ kind: "grade", grade: 5 }, "nothing"))?.grade).toBe(5);
  });
});
