"use client";

import type { LiveController, MathTone } from "./contracts";

/**
 * Voice tools over the Live layer (spec §2.3 #13). Pure client: they read the
 * transcript from liveStore via the controller and write typeset shapes; no
 * network. The board's Realtime session registers `voiceSessionTools()` and runs
 * these through `handleLiveVoiceTool`: the voice tutor reads and writes maths, it
 * never paints an image onto the canvas.
 */

/** Shape of a Realtime API function tool definition (session.update -> tools[]). */
export type RealtimeToolDef = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export const READ_LIVE_MATH = "read_live_math";
export const PLACE_MATH = "place_math";
export const PLOT_FUNCTION = "plot_function";

/** Tools the voice tutor can call to read/write the Live layer without an image round-trip. */
export const LIVE_VOICE_TOOLS: RealtimeToolDef[] = [
  {
    type: "function",
    name: READ_LIVE_MATH,
    description:
      "Read the student's handwritten math exactly as recognized: one entry per line with LaTeX, the local verdict (ok, warn, solved, unknown), any computed result and a short note. Instant and exact; call this before analyzing the workspace when the student is doing math.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: PLACE_MATH,
    description:
      "Write a typeset math step on the board, below the student's work (or below a specific line). Use instead of drawing. Do not reveal the final answer unless the help mode allows it.",
    parameters: {
      type: "object",
      properties: {
        latex: { type: "string", description: "KaTeX-renderable LaTeX of the step" },
        nearLineId: { type: "string", description: "id of the transcript line to place it under (optional)" },
        tone: { type: "string", enum: ["muted", "normal", "accent"], description: "visual tone; default accent" },
      },
      required: ["latex"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: PLOT_FUNCTION,
    description:
      "Plot y = f(x) as an interactive graph card next to the student's work. `expr` is a mathjs expression in x, e.g. 'x^2 - 4' or 'sin(x)'.",
    parameters: {
      type: "object",
      properties: {
        expr: { type: "string", description: "expression in x (mathjs syntax)" },
        xMin: { type: "number" },
        xMax: { type: "number" },
        nearLineId: { type: "string" },
      },
      required: ["expr"],
      additionalProperties: false,
    },
  },
];

/** Vision read of the whole canvas (POST /api/voice/analyze-workspace): text back, nothing drawn. */
export const ANALYZE_WORKSPACE = "analyze_workspace";

const ANALYZE_WORKSPACE_TOOL: RealtimeToolDef = {
  type: "function",
  name: ANALYZE_WORKSPACE,
  description:
    "Look at the whole whiteboard (including drawings and diagrams) to understand what the student is working on. Returns a short text description; it draws nothing.",
  parameters: {
    type: "object",
    properties: {
      focus: {
        type: "string",
        description: "Optional focus for the analysis, e.g. 'find mistakes in the algebra' or 'summarize progress'.",
      },
    },
    required: [],
  },
};

/** Every tool the Realtime session registers: one read of the canvas plus the Live tools. */
export function voiceSessionTools(): RealtimeToolDef[] {
  return [ANALYZE_WORKSPACE_TOOL, ...LIVE_VOICE_TOOLS];
}

/** `session.update` instructions for the voice tutor. */
export const VOICE_SESSION_INSTRUCTIONS =
  "You are a realtime voice tutor for a handwritten whiteboard. Speak clearly and briefly. " +
  `Call ${READ_LIVE_MATH} to read the student's maths exactly as recognized, and ${ANALYZE_WORKSPACE} ` +
  `for anything that is not maths (a diagram, a sketch). To show something, write it with ${PLACE_MATH} ` +
  `(one typeset step at a time) or graph it with ${PLOT_FUNCTION}; you never draw pictures. ` +
  "Prefer gentle hints before full solutions.";

export function isLiveVoiceTool(name: string): boolean {
  return LIVE_VOICE_TOOLS.some((t) => t.name === name);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function tone(v: unknown): MathTone | undefined {
  return v === "muted" || v === "normal" || v === "accent" ? v : undefined;
}

/**
 * Executes a live voice tool and returns the JSON string to send back as
 * `function_call_output.output`. Never throws; errors are returned as { error }.
 */
export async function handleLiveVoiceTool(
  name: string,
  args: Record<string, unknown>,
  controller: LiveController,
): Promise<string> {
  try {
    switch (name) {
      case READ_LIVE_MATH: {
        const t = controller.getTranscript();
        return JSON.stringify({
          summary: t.summary,
          lines: t.lines.map((l) => ({
            id: l.id,
            latex: l.latex,
            verdict: l.verdict,
            result: l.resultLatex || undefined,
            note: l.note || undefined,
            column: l.column,
          })),
        });
      }
      case PLACE_MATH: {
        const latex = str(args.latex);
        if (!latex) return JSON.stringify({ error: "latex is required" });
        const id = controller.placeMath({ latex, nearLineId: str(args.nearLineId), tone: tone(args.tone) });
        return JSON.stringify(id ? { ok: true, shapeId: id } : { error: "Could not place the math (board full or invalid)" });
      }
      case PLOT_FUNCTION: {
        const expr = str(args.expr);
        if (!expr) return JSON.stringify({ error: "expr is required" });
        const id = controller.plotFunction({
          expr,
          xMin: num(args.xMin),
          xMax: num(args.xMax),
          nearLineId: str(args.nearLineId),
        });
        return JSON.stringify(id ? { ok: true, shapeId: id } : { error: "Could not plot that expression" });
      }
      default:
        return JSON.stringify({ error: `Unknown live tool: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : "Live tool failed" });
  }
}

export interface VoiceToolDeps {
  controller: LiveController;
  /** POST /api/voice/analyze-workspace with a viewport capture; resolves to the analysis text */
  analyzeWorkspace: (focus: string | null) => Promise<string>;
}

/**
 * Runs one Realtime function call and returns the `function_call_output.output` string.
 * Live tools never touch the network; `analyze_workspace` is the one paid call (a read).
 * Unknown names — `draw_on_canvas` from an older session included — are answered with an
 * error rather than run: nothing here can paint on the board.
 */
export async function runVoiceTool(name: string, args: Record<string, unknown>, deps: VoiceToolDeps): Promise<string> {
  if (isLiveVoiceTool(name)) return handleLiveVoiceTool(name, args, deps.controller);
  if (name === ANALYZE_WORKSPACE) {
    const analysis = await deps.analyzeWorkspace(str(args.focus) ?? null);
    return JSON.stringify({ analysis });
  }
  return JSON.stringify({ error: `Unknown tool: ${name}` });
}
