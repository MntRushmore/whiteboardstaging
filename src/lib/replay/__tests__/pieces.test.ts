import { describe, expect, it } from "vitest";
import type { TLRecord } from "tldraw";
import { diffRecords } from "../diff";
import { formatClock, formatRealTime, formatSize } from "../format";
import { KID_REPLAY_COPY, replaySummary, summaryLine, summaryParts, workMinutes } from "../summary";
import { syntheticBoard } from "../synthetic";
import { pageThumbnailSvg, svgDataUrl } from "../thumbnail";
import { buildTimeline, recordsOf } from "../timeline";

const T0 = Date.UTC(2026, 9, 6, 20, 0);
const rec = (r: Record<string, unknown>) => r as unknown as TLRecord;

describe("summary", () => {
  it("adds up the student's strokes, the ticks and rings, the screens, the time worked", () => {
    const tl = buildTimeline(recordsOf(syntheticBoard({ strokes: 120, perPage: 60 })));
    const s = replaySummary(tl, { fixed: 2 });
    expect(s.strokes).toBe(120);
    expect(s.ticks + s.rings).toBe(tl.marks.length);
    expect(s.ticks).toBeGreaterThan(s.rings);
    expect(s.screens).toBe(2);
    expect(s.fixed).toBe(2);
    expect(s.activeMs).toBeGreaterThan(60_000);
  });

  it("a pause counts two minutes at most; too few times is unknown", () => {
    const page = rec({ id: "page:a", typeName: "page", index: "a1", name: "", meta: {} });
    const stroke = (id: string, index: string, t?: number) =>
      rec({ id, typeName: "shape", type: "draw", parentId: "page:a", index, meta: t ? { t } : {}, props: { segments: [{ type: "free", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] } });
    const s = replaySummary(buildTimeline([page, stroke("shape:1", "a1", T0), stroke("shape:2", "a2", T0 + 60_000), stroke("shape:3", "a3", T0 + 3_600_000)]));
    expect(s.activeMs).toBe(60_000 + 120_000);
    expect(workMinutes(s)).toBe(3);
    const once = replaySummary(buildTimeline([page, stroke("shape:1", "a1", T0)]));
    expect(once.activeMs).toBeNull();
    expect(workMinutes(once)).toBeNull();
    expect(once.fixed).toBeNull();
  });

  it("says it the way the student's card does, leaving out what is zero or unknown", () => {
    const s = { strokes: 128, ticks: 7, rings: 1, screens: 3, fixed: 2, activeMs: 14 * 60_000 };
    expect(summaryLine(s)).toBe("You wrote 128 strokes · 7 ✓ · fixed 2 mistakes · 14 minutes of work");
    expect(summaryLine({ ...s, ticks: 0, fixed: null, activeMs: null, strokes: 1 })).toBe("You wrote 1 stroke");
    expect(summaryParts({ ...s, fixed: 1, activeMs: 30_000 }).map((p) => p.key)).toEqual(["strokes", "ticks", "fixed", "minutes"]);
    expect(summaryLine({ ...s, fixed: 1, activeMs: 30_000 })).toContain("fixed 1 mistake · 1 minute of work");
    expect(KID_REPLAY_COPY.doneTitle(s)).toBe("Look at you go!");
    expect(KID_REPLAY_COPY.doneTitle({ ...s, ticks: 0 })).toBe("Look at all that work!");
  });
});

describe("format", () => {
  it("the replay's clock", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(7_400)).toBe("0:07");
    expect(formatClock(86_000)).toBe("1:26");
    expect(formatClock(725_000)).toBe("12:05");
    expect(formatClock(3_729_000)).toBe("1:02:09");
    expect(formatClock(-5)).toBe("0:00");
  });

  it("the real time on screen: day and time, lower-case am/pm", () => {
    expect(formatRealTime(Date.UTC(2026, 9, 6, 20, 12), "America/New_York")).toBe("Tue 4:12 pm");
    expect(formatRealTime(Date.UTC(2026, 9, 7, 13, 5), "America/New_York")).toBe("Wed 9:05 am");
  });

  it("sizes", () => {
    expect(formatSize(840)).toBe("840 KB");
    expect(formatSize(1229)).toBe("1.2 MB");
    expect(formatSize(20_480)).toBe("20 MB");
  });
});

describe("pageThumbnailSvg", () => {
  const records = recordsOf(syntheticBoard({ strokes: 30 }));

  it("draws a screen's strokes as paths, and its other shapes as boxes, in the screen's frame", () => {
    const svg = pageThumbnailSvg(records, "page:page", { x: 0, y: 0, w: 1600, h: 900 }, 160);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="160" height="90" viewBox="0 0 1600 900">/);
    expect(svg.match(/<path /g)?.length).toBeGreaterThanOrEqual(30);
    expect(svg).toContain('stroke="#1d1d1d"');
    expect(svg).toContain('stroke="#099268"'); // the tutor's green tick
    expect(svg).toContain('fill="#eef2ff"'); // a typeset echo, as a box
    expect(svgDataUrl(svg)).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  });

  it("an empty screen is a white card; a long stroke is thinned", () => {
    expect(pageThumbnailSvg([], "page:x", { x: 0, y: 0, w: 1600, h: 900 })).not.toContain("<path");
    const long = rec({
      id: "shape:long",
      typeName: "shape",
      type: "draw",
      parentId: "page:x",
      index: "a1",
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
      props: { size: "m", color: "blue", scale: 1, segments: [{ type: "free", points: Array.from({ length: 500 }, (_, i) => ({ x: i, y: i })) }] },
    });
    const svg = pageThumbnailSvg([long], "page:x", { x: 0, y: 0, w: 1600, h: 900 });
    const commands = svg.match(/[ML]\d/g)?.length ?? 0;
    expect(commands).toBeLessThanOrEqual(60);
    expect(svg).toContain("L499 499");
  });
});

describe("diffRecords", () => {
  const page = rec({ id: "page:a", typeName: "page", index: "a1", name: "Page", meta: {} });
  const group = rec({ id: "shape:g", typeName: "shape", type: "group", parentId: "page:a" });
  const child = rec({ id: "shape:c", typeName: "shape", type: "draw", parentId: "shape:g", x: 1 });
  const lone = rec({ id: "shape:l", typeName: "shape", type: "draw", parentId: "page:a", x: 1 });
  const camera = rec({ id: "camera:x", typeName: "camera" });

  it("puts what is new or changed (pages first, parents before children), removes what is gone (shapes before pages)", () => {
    const prev = new Map<string, TLRecord>([
      [lone.id, lone],
      [page.id, page],
    ]);
    const next = [child, group, { ...lone } as TLRecord, page, camera];
    const d = diffRecords(prev, next);
    expect(d.put.map((r) => r.id)).toEqual(["shape:g", "shape:c"]);
    expect(d.remove).toEqual([]);

    const moved = { ...lone, x: 5 } as TLRecord;
    const page2 = rec({ id: "page:b", typeName: "page", index: "a2", name: "Two", meta: {} });
    const d2 = diffRecords(new Map([[lone.id, lone], [page.id, page], [group.id, group]]), [moved, page2]);
    expect(d2.put.map((r) => r.id)).toEqual(["page:b", "shape:l"]);
    expect(d2.remove).toEqual(["shape:g", "page:a"]);
  });
});
