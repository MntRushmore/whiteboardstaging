import { beforeAll, describe, expect, it, vi } from "vitest";
import type { LiveEngine } from "../../contracts";
import { getEngine } from "../../engine";
import { ChatDesk, HELP_BOARD_NOTES, type ChatHost, type HelpBoardResult } from "../desk";

/**
 * `help_board` at the desk: after the hand's writing under way, the board's own Help me / Solve it
 * (`ChatHost.helpBoard`) is asked; a line still being read is waited for; every outcome is honest
 * and measured (`live.chat.helpBoard`). The loop's side is `liveLoop.chatHelpBoard.test.ts`.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

function fakeHost(answers: HelpBoardResult[], opts: { busyFor?: number; withHelp?: boolean } = {}) {
  const asked: Array<{ depth: string; handBusy: boolean }> = [];
  const metrics: Array<{ name: string; data: Record<string, unknown> }> = [];
  let busy = opts.busyFor ?? 0;
  const host: ChatHost = {
    engine: async () => engine,
    shapes: () => [],
    screen: () => ({ x: 0, y: 0, w: 1600, h: 900 }),
    pageId: () => "page",
    studentLines: () => [],
    handwriting: () => true,
    handBusy: () => busy > 0,
    write: async () => undefined,
    typeset: () => ({ x: 0, y: 0, w: 10, h: 10 }),
    addScreen: () => false,
    screenReady: () => true,
    clearTutor: () => undefined,
    problemsChanged: () => undefined,
    helpProblem: () => "missing",
    planFigure: () => null,
    seed: () => 1,
    delay: async () => {
      if (busy > 0) busy--;
    },
    metric: (name, data) => metrics.push({ name, data }),
  };
  if (opts.withHelp !== false) {
    host.helpBoard = vi.fn((depth: "step" | "solve") => {
      asked.push({ depth, handBusy: busy > 0 });
      return answers.length > 1 ? answers.shift()! : answers[0];
    });
  }
  return { host, asked, metrics };
}

describe("ChatDesk — help_board", () => {
  it("waits for the hand's writing under way, then asks the board's Help me; written is ok, measured", async () => {
    const { host, asked, metrics } = fakeHost(["writing"], { busyFor: 3 });
    const report = await new ChatDesk(host).run([{ type: "help_board", depth: "step" }]);
    expect(report.outcomes).toEqual([{ type: "help_board", ok: true }]);
    expect(asked).toEqual([{ depth: "step", handBusy: false }]);
    expect(metrics).toEqual([{ name: "live.chat.helpBoard", data: { depth: "step", outcome: "writing" } }]);
  });

  it("a line still being read: asked again until the read lands", async () => {
    const { host, asked, metrics } = fakeHost(["reading", "reading", "writing"]);
    const report = await new ChatDesk(host).run([{ type: "help_board", depth: "solve" }]);
    expect(report.outcomes).toEqual([{ type: "help_board", ok: true }]);
    expect(asked).toHaveLength(3);
    expect(metrics[0].data).toEqual({ depth: "solve", outcome: "writing" });
  });

  it("a read that never lands: busy, said plainly", async () => {
    const { host } = fakeHost(["reading"]);
    const report = await new ChatDesk(host).run([{ type: "help_board", depth: "step" }]);
    expect(report.outcomes).toEqual([{ type: "help_board", ok: false, note: HELP_BOARD_NOTES.busy, why: "busy" }]);
  });

  it("every outcome that writes nothing has its own honest note — none of them a failure report ('couldn't')", async () => {
    for (const outcome of ["nothing", "busy", "unread", "done", "off"] as const) {
      const { host } = fakeHost([outcome]);
      const report = await new ChatDesk(host).run([{ type: "help_board", depth: "step" }]);
      expect(report.outcomes).toEqual([{ type: "help_board", ok: false, note: HELP_BOARD_NOTES[outcome], why: outcome }]);
      expect(HELP_BOARD_NOTES[outcome]).not.toMatch(/couldn't/i);
    }
    expect(HELP_BOARD_NOTES.nothing).toBe("There's nothing of yours to help with on this screen yet.");
  });

  it("a board with no Help to lend (an older host): nothing of theirs to help with", async () => {
    const { host } = fakeHost([], { withHelp: false });
    const report = await new ChatDesk(host).run([{ type: "help_board", depth: "solve" }]);
    expect(report.outcomes).toEqual([{ type: "help_board", ok: false, note: HELP_BOARD_NOTES.nothing, why: "nothing" }]);
  });
});
