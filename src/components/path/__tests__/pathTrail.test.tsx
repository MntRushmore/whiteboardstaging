import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MasteryLevel } from "@/lib/learning/contracts";
import { buildPathView, PATH_COPY } from "@/lib/path/pathView";
import { PathCount, PathTrail, PickGrade, StarsKey } from "../PathTrail";

const levels = (entries: Record<string, MasteryLevel> = {}) => new Map(Object.entries(entries)) as Map<string, MasteryLevel>;
const html = (node: React.ReactElement) => renderToStaticMarkup(node).replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

const grade3 = buildPathView({ kind: "grade", grade: 3 }, levels({ add_subtract_within_1000: "mastered", times_tables: "practicing" }));

describe("the trail", () => {
  const out = html(<PathTrail view={grade3} busy={null} onOpen={vi.fn()} />);

  it("a real ordered list named for the path, one button per stop in teaching order", () => {
    expect(out).toMatch(/<ol[^>]*aria-label="3rd grade path"/);
    const buttons = [...out.matchAll(/<button[^>]*data-node="([a-z_0-9]+)"/g)].map((m) => m[1]);
    expect(buttons).toEqual(["add_subtract_within_1000", "times_tables", "division_facts", "multiply_by_tens"]);
    expect(out.match(/<li /g)?.length).toBe(4);
    for (const b of out.match(/<button[^>]*>/g) ?? []) expect(b).toContain('type="button"');
  });

  it("each button says the whole stop: its name, its place, whether it is next, its stars", () => {
    for (const n of grade3.nodes) expect(out).toContain(`aria-label="${n.label}"`);
    expect(out).toMatch(/<button[^>]*aria-label="Times tables, step 2 of 4\. Next up\.[^"]*"[^>]*aria-current="step"/);
    expect(out.match(/aria-current="step"/g)?.length).toBe(1);
  });

  it("done is marked done, the next says Next up, the rest look locked (and still open)", () => {
    expect(out).toMatch(/<li[^>]*data-state="done"[\s\S]*?data-badge="done"/);
    expect(out).toContain(`>${PATH_COPY.nextUp}<`);
    expect(out.match(/data-state="upcoming"/g)?.length).toBe(2);
    expect(out.match(/data-badge="locked"/g)?.length).toBe(2);
    expect(out).not.toMatch(/<button[^>]*disabled/);
  });

  it("the trail is walked up to the next stop", () => {
    const walked = [...out.matchAll(/<li[^>]*data-stop=""[^>]*>/g)].map((m) => /data-walked/.test(m[0]));
    expect(walked).toEqual([true, false, false, false]);
  });

  it("while a topic board is made, that stop is busy and every stop waits", () => {
    const algebra1 = buildPathView({ kind: "course", course: "algebra1" }, levels());
    // Algebra 1's fractions stop is the K-8 skill `add_fractions_unlike` since the catalog's split
    const stop = "add_fractions_unlike";
    expect(algebra1.nodes.some((n) => n.id === stop)).toBe(true);
    const busy = html(<PathTrail view={algebra1} busy={stop} onOpen={vi.fn()} />);
    expect(busy.match(/<button[^>]*disabled=""/g)?.length).toBe(algebra1.total);
    expect(busy.match(/aria-busy="true"/g)?.length).toBe(1);
    expect(busy).toMatch(new RegExp(`<button[^>]*data-node="${stop}"[^>]*aria-busy="true"`));
  });
});

describe("the count, the stars' key and Pick your grade", () => {
  it("the count is a progress bar a screen reader reads as the words", () => {
    const out = html(<PathCount view={grade3} text={grade3.homeCount} />);
    expect(out).toMatch(/role="progressbar"[^>]*aria-valuemax="4"[^>]*aria-valuenow="1"[^>]*aria-valuetext="1 of 4 done"/);
    expect(out).toContain("width:25%");
  });

  it("the stars' key names each level", () => {
    const out = html(<StarsKey />);
    for (const word of ["Practicing", "Almost there", "Mastered"]) expect(out).toContain(word);
    expect(out).toMatch(/<ul[^>]*aria-label="What the stars mean"/);
  });

  it("Pick your grade links to the account page's grade section", () => {
    const out = html(<PickGrade place="home" />);
    expect(out).toContain(PATH_COPY.pickTitle);
    expect(out).toMatch(/<a[^>]*href="\/account#grade"/);
    expect(out).toContain(PATH_COPY.pickAction);
  });

  it("a kid's grade is their grown-up's to pick: who to ask, and no link to the account page", () => {
    for (const place of ["home", "progress"] as const) {
      const out = html(<PickGrade place={place} kid />);
      expect(out).toContain(PATH_COPY.kidPickTitle);
      expect(out).toContain(PATH_COPY.kidPickHint);
      expect(out).not.toContain(PATH_COPY.pickAction);
      expect(out).not.toContain("/account");
      expect(out).not.toContain("<a ");
    }
  });
});
