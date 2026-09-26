import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TLShapeId } from "tldraw";
import type { LiveController, LiveLineState } from "../contracts";
import { liveStore, resetLiveStore } from "../liveStore";
import {
  ANALYZE_WORKSPACE,
  LIVE_VOICE_TOOLS,
  VOICE_SESSION_INSTRUCTIONS,
  handleLiveVoiceTool,
  isLiveVoiceTool,
  runVoiceTool,
  voiceSessionTools,
} from "../voiceTools";

function seedLine(id: string, latex: string, row: number, verdict: "ok" | "mismatch" | "unknown", solved = false): LiveLineState {
  return {
    line: { id, strokeIds: [], bounds: { x: 100, y: 200 + row * 60, w: 150, h: 40 }, column: 0, row, hash: "" },
    latex,
    confidence: 0.98,
    provider: "mathpix",
    analysis: { kind: "equation", math: latex, resultLatex: row === 2 ? "x=4" : "", verdict, note: verdict === "mismatch" ? "right side" : "", solved },
    mathShapeId: `shape:m${row}` as TLShapeId,
    graphShapeId: null,
    hintsShown: 0,
    rewritesWithWarn: 0,
    edited: false,
    updatedAt: row,
  };
}

/** A controller whose transcript reads liveStore (like LiveLoop) and whose writes are spies. */
function controllerOverStore(): { controller: LiveController; placeMath: ReturnType<typeof vi.fn>; plotFunction: ReturnType<typeof vi.fn> } {
  const placeMath = vi.fn(() => "shape:new" as TLShapeId);
  const plotFunction = vi.fn((args: { expr: string }) => (args.expr.includes("??") ? null : ("shape:g" as TLShapeId)));
  const controller: LiveController = {
    getTranscript: () => {
      const lines = Object.values(liveStore.lines.get())
        .sort((a, b) => a.line.row - b.line.row)
        .map((s) => ({
          id: s.line.id,
          latex: s.latex,
          verdict: s.analysis?.solved ? ("solved" as const) : s.analysis?.verdict === "ok" ? ("ok" as const) : s.analysis?.verdict === "mismatch" ? ("warn" as const) : ("unknown" as const),
          resultLatex: s.analysis?.resultLatex ?? "",
          note: s.analysis?.note ?? "",
          column: s.line.column,
        }));
      return { lines, summary: `${lines.length} lines` };
    },
    placeMath,
    plotFunction,
    requestCheck: () => {},
    requestSolve: () => {},
    requestHelp: () => {},
    escalate: () => {},
    dismissHint: () => {},
    clearMarks: () => {},
    retypeLine: () => {},
  };
  return { controller, placeMath, plotFunction };
}

describe("voice tools", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    resetLiveStore();
    vi.stubGlobal("fetch", fetchSpy);
    liveStore.lines.set({
      ln_a: seedLine("ln_a", "2x+3=11", 0, "unknown"),
      ln_b: seedLine("ln_b", "2x=8", 1, "ok"),
      ln_c: seedLine("ln_c", "x=5", 2, "mismatch"),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchSpy.mockReset();
  });

  it("declares the three tools with the Realtime function shape", () => {
    expect(LIVE_VOICE_TOOLS.map((t) => t.name)).toEqual(["read_live_math", "place_math", "plot_function"]);
    for (const t of LIVE_VOICE_TOOLS) {
      expect(t.type).toBe("function");
      expect(t.parameters).toHaveProperty("type", "object");
    }
    expect(isLiveVoiceTool("read_live_math")).toBe(true);
    expect(isLiveVoiceTool("draw_on_canvas")).toBe(false);
  });

  it("read_live_math returns the seeded lines with no network", async () => {
    const { controller } = controllerOverStore();
    const out = JSON.parse(await handleLiveVoiceTool("read_live_math", {}, controller)) as {
      lines: Array<{ id: string; latex: string; verdict: string; result?: string; note?: string }>;
      summary: string;
    };
    expect(out.lines.map((l) => l.latex)).toEqual(["2x+3=11", "2x=8", "x=5"]);
    expect(out.lines.map((l) => l.verdict)).toEqual(["unknown", "ok", "warn"]);
    expect(out.lines[2].note).toBe("right side");
    expect(out.lines[2].result).toBe("x=4");
    expect(out.lines[0].result).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("place_math validates args and forwards to the controller", async () => {
    const { controller, placeMath } = controllerOverStore();
    const bad = JSON.parse(await handleLiveVoiceTool("place_math", {}, controller)) as { error?: string };
    expect(bad.error).toMatch(/latex/);
    expect(placeMath).not.toHaveBeenCalled();
    const ok = JSON.parse(await handleLiveVoiceTool("place_math", { latex: "x = 4", nearLineId: "ln_c", tone: "accent" }, controller)) as { ok?: boolean; shapeId?: string };
    expect(ok).toEqual({ ok: true, shapeId: "shape:new" });
    expect(placeMath).toHaveBeenCalledWith({ latex: "x = 4", nearLineId: "ln_c", tone: "accent" });
    // Unknown tone is dropped rather than forwarded.
    await handleLiveVoiceTool("place_math", { latex: "y", tone: "loud" }, controller);
    expect(placeMath).toHaveBeenLastCalledWith({ latex: "y", nearLineId: undefined, tone: undefined });
  });

  it("plot_function forwards numeric ranges and reports failures", async () => {
    const { controller, plotFunction } = controllerOverStore();
    const ok = JSON.parse(await handleLiveVoiceTool("plot_function", { expr: "x^2-4", xMin: -5, xMax: "7", nearLineId: "ln_a" }, controller)) as { ok?: boolean };
    expect(ok.ok).toBe(true);
    expect(plotFunction).toHaveBeenCalledWith({ expr: "x^2-4", xMin: -5, xMax: undefined, nearLineId: "ln_a" });
    const fail = JSON.parse(await handleLiveVoiceTool("plot_function", { expr: "??" }, controller)) as { error?: string };
    expect(fail.error).toBeTruthy();
    const missing = JSON.parse(await handleLiveVoiceTool("plot_function", {}, controller)) as { error?: string };
    expect(missing.error).toMatch(/expr/);
  });

  it("never throws: unknown tools and throwing controllers become { error }", async () => {
    const { controller } = controllerOverStore();
    expect(JSON.parse(await handleLiveVoiceTool("nope", {}, controller))).toEqual({ error: "Unknown live tool: nope" });
    const boom: LiveController = { ...controller, getTranscript: () => { throw new Error("kaboom"); } };
    expect(JSON.parse(await handleLiveVoiceTool("read_live_math", {}, boom))).toEqual({ error: "kaboom" });
  });

  // ------------------------------------------------------------------ the Realtime session
  describe("the Realtime session (draw_on_canvas replaced by the Live tools)", () => {
    it("registers analyze_workspace plus the three Live tools, and nothing that paints", () => {
      const names = voiceSessionTools().map((t) => t.name);
      expect(names).toEqual([ANALYZE_WORKSPACE, "read_live_math", "place_math", "plot_function"]);
      expect(names).not.toContain("draw_on_canvas");
      const text = JSON.stringify(voiceSessionTools()) + VOICE_SESSION_INSTRUCTIONS;
      expect(text).not.toMatch(/gemini|image model|nano banana/i);
      expect(VOICE_SESSION_INSTRUCTIONS).toMatch(/read_live_math/);
      expect(VOICE_SESSION_INSTRUCTIONS).toMatch(/never draw pictures/);
    });

    it("routes Live tools to the controller with no network", async () => {
      const { controller, placeMath } = controllerOverStore();
      const analyzeWorkspace = vi.fn(async () => "unused");
      const out = JSON.parse(await runVoiceTool("place_math", { latex: "x = 4", nearLineId: "ln_c" }, { controller, analyzeWorkspace })) as { ok?: boolean };
      expect(out.ok).toBe(true);
      expect(placeMath).toHaveBeenCalledWith({ latex: "x = 4", nearLineId: "ln_c", tone: undefined });
      const read = JSON.parse(await runVoiceTool("read_live_math", {}, { controller, analyzeWorkspace })) as { lines: unknown[] };
      expect(read.lines).toHaveLength(3);
      expect(analyzeWorkspace).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("analyze_workspace calls the read with the focus and returns its text", async () => {
      const { controller } = controllerOverStore();
      const analyzeWorkspace = vi.fn(async (focus: string | null) => `saw ${focus ?? "everything"}`);
      expect(JSON.parse(await runVoiceTool(ANALYZE_WORKSPACE, { focus: "the algebra" }, { controller, analyzeWorkspace }))).toEqual({ analysis: "saw the algebra" });
      expect(JSON.parse(await runVoiceTool(ANALYZE_WORKSPACE, {}, { controller, analyzeWorkspace }))).toEqual({ analysis: "saw everything" });
      expect(analyzeWorkspace).toHaveBeenNthCalledWith(1, "the algebra");
      expect(analyzeWorkspace).toHaveBeenNthCalledWith(2, null);
    });

    it("answers draw_on_canvas (an older session's tool) with an error and runs nothing", async () => {
      const { controller, placeMath, plotFunction } = controllerOverStore();
      const analyzeWorkspace = vi.fn(async () => "x");
      const out = JSON.parse(await runVoiceTool("draw_on_canvas", { mode: "answer" }, { controller, analyzeWorkspace })) as { error?: string };
      expect(out.error).toMatch(/Unknown tool: draw_on_canvas/);
      expect(placeMath).not.toHaveBeenCalled();
      expect(plotFunction).not.toHaveBeenCalled();
      expect(analyzeWorkspace).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

  });
});
