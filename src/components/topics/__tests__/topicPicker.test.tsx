import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MasteryLevel } from "@/lib/learning/contracts";
import { LEVEL_LABELS } from "@/lib/learning/progressView";
import { TOPIC_COPY, topicGroups } from "@/lib/learning/topics";
import { AskBox, LevelMark, TopicList } from "../TopicPicker";

const levels = (entries: Record<string, MasteryLevel>) => new Map(Object.entries(entries)) as Map<string, MasteryLevel>;
const html = (node: React.ReactElement) => renderToStaticMarkup(node).replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

describe("the topic list", () => {
  const { mine, others } = topicGroups("algebra1", levels({ negative_numbers: "mastered", add_fractions_unlike: "almost", order_of_operations: "practicing" }));
  const render = (over: Partial<Parameters<typeof TopicList>[0]> = {}) => html(<TopicList mine={mine} others={others} course="Algebra 1" busy={null} onPick={vi.fn()} {...over} />);

  it("the course's topics by area, each a real button with its name, its line and its level", () => {
    const out = render();
    expect(out).toContain(TOPIC_COPY.mine("Algebra 1"));
    for (const label of ["Numbers", "Algebra", "Functions and graphs"]) expect(out).toContain(`>${label}</h3>`);
    const fractions = out.match(/<button[^>]*data-topic="add_fractions_unlike"[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(fractions).toContain('type="button"');
    expect(fractions).toContain("Adding unlike fractions");
    expect(fractions).toContain("Different bottoms");
    expect(fractions).toContain('data-level="almost"');
    expect(fractions).toContain(LEVEL_LABELS.almost);
    expect(out).toContain('data-level="mastered"');
    expect(out).toContain('data-level="practicing"');
  });

  it("Other topics is folded away, a button that says so, until it is opened", () => {
    const closed = render();
    expect(closed).toMatch(/<button[^>]*aria-expanded="false"[^>]*>[\s\S]*Other topics/);
    expect(closed).toMatch(/<div[^>]*hidden=""[^>]*>/);
    expect(closed).not.toContain('data-topic="add_within_20"');
    const open = render({ othersOpen: true });
    expect(open).toMatch(/aria-expanded="true"/);
    expect(open).toContain('data-topic="add_within_20"');
  });

  it("while a topic board is made, every row waits and that one says it is busy", () => {
    const out = render({ busy: "add_fractions_unlike" });
    expect(out.match(/<button[^>]*data-topic="[a-z0-9_]+"[^>]*disabled=""/g)?.length).toBe(mine.flatMap((g) => g.topics).length);
    expect(out).toMatch(/data-topic="add_fractions_unlike"[^>]*aria-busy="true"/);
  });

  it("a student with a grade: their grade's path, under its name", () => {
    const third = topicGroups(null, levels({}), 3);
    const out = html(<TopicList mine={third.mine} others={third.others} course={null} grade="3rd grade" busy={null} onPick={vi.fn()} />);
    expect(out).toContain(TOPIC_COPY.mineGrade("3rd grade"));
    expect(out).not.toContain(TOPIC_COPY.mine(null));
    const listed = [...out.split(TOPIC_COPY.others)[0].matchAll(/data-topic="([a-z0-9_]+)"/g)].map((m) => m[1]);
    expect(listed).toEqual(["add_subtract_within_1000", "times_tables", "division_facts", "multiply_by_tens"]);
  });

  it("a level is its dot and its word", () => {
    const out = html(<LevelMark level="new" />);
    expect(out).toContain('data-level="new"');
    expect(out).toContain(">New<");
  });
});

describe("What do you want to work on?", () => {
  it("a labelled box, Go (a submit button, off while the box is empty) and a line saying what Go does", () => {
    const out = html(<AskBox busy={false} onSubmit={vi.fn()} />);
    const input = out.match(/<input[^>]*>/)?.[0] ?? "";
    const id = input.match(/id="([^"]+)"/)?.[1];
    expect(out).toContain(`<label for="${id}"`);
    expect(out).toContain(TOPIC_COPY.askTitle);
    expect(input).toContain('enterKeyHint="go"');
    expect(input).toContain('maxLength="500"');
    expect(input).toContain(`aria-describedby="${id?.replace(/-input$/, "-hint")}"`);
    expect(out).toMatch(/<button type="submit"[^>]*disabled=""/);
    expect(out).toContain('aria-live="polite"');
  });

  it("its question can be put otherwise", () => {
    expect(html(<AskBox busy={false} onSubmit={vi.fn()} label="Or ask for anything" />)).toContain("Or ask for anything");
  });
});
