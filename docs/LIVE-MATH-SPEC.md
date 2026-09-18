# Live Math — final build spec (realtime math & STEM engine for Agathon Classroom)

Repo: `/Users/rushilchopra/whiteboardstaging/whiteboardstaging` (Next 16.2.4, React 19.2, tldraw 4.2.0, supabase-js 2.84). Base = Proposal 3 (highest score), with grafts from P1 (mergeRemoteChanges isolation, transitive-closure clustering, per-line abort, token cache, Upstash-shaped limiter, check/solve model split, warmup GET, shape cap) and P2 (shape utils registered on both `<Tldraw>` mounts, `meta.live` capture exclusion, `expected` re-verification, findFreeSlot, no-live-call regression test, `curl -N` streaming check). Every open question is resolved in §2.3. Verified against `node_modules/tldraw/dist-cjs/index.d.ts`, `@tldraw/{editor,store,tlschema,validate}` `.d.ts` and the compiled draw tool.

## 1. Product summary and student-visible timeline

Live is an always-on layer (default ON, switch next to the Off/Feedback/Suggest/Solve tabs) that turns each handwritten line into a native, editable KaTeX `math` shape ("echo") about 1.2 s after pen-up, runs an offline mathjs engine on the main thread for instant results, step-equivalence checks, units, constants, chemistry balancing and graphing (`graph` shape), and escalates to a streaming LLM (SSE, JSON Lines, first annotation ≤ 2 s after the check starts) only when the mode ladder allows it. The four tabs stay the "how much help" dial for both engines; the legacy image-overlay pipeline is kept for non-math ink and on-demand "Draw help". All `/api/*` routes require a Supabase bearer token and are rate limited per user. Recognition = Mathpix `v3/strokes` (keys already provisioned) with a `google/gemini-3.1-flash-lite` vision fallback. The tone is a quiet lab partner: gray echo, amber dot (never a red X), WHERE before WHAT, one hint per line, one "Solved" celebration.

| t (after pen-up) | What the student sees |
|---|---|
| 0 ms | Nothing. Pen-up flips `draw.props.isComplete` true; the line is marked dirty, legacy idle timer (4 s while Live is on) restarts. |
| 0–600 ms | Quiet gate (450 ms if the line already had an echo). More ink in the same line restarts it. No status text. |
| ≈600 ms | Cluster + normalize strokes (<5 ms), content-hash cache lookup, `POST /api/live/recognize` (Mathpix p50 ≈450 ms). "Reading…" appears only if this exceeds 600 ms (≈1.2 s). |
| ≈1.0–1.3 s (p50 1.15 s) | Echo fades in 24 px right of the ink at 60 % opacity. Engine runs (<10 ms): result chip (calculator rule), green check / amber dot vs. the previous line (Feedback+), "Solved" chip on the final line, graph card for `y = f(x)`. Labels, incomplete lines and low-confidence reads show nothing. |
| ≈1.2 s | If the ladder permits (Suggest + mismatch, or a tap), `POST /api/live/check` starts; `meta` arrives ≈150 ms later; pill "Checking…". |
| ≈2.0–3.2 s | First `annotation` (target ≤ 2 s after the check started): hint card below the echo (Suggest) or location-only note behind the amber dot (Feedback). |
| ≈3 s | Check `done`; pill fades 1.5 s after idle. Solve: "Show steps" streams typeset step shapes, first ≈1.5–2 s after tap. Vision fallback: echo at ≈2.0 s ("Reading (slower)"). Unreadable ink: faint "Couldn't read this — tap to type it" chip at ≈3.6 s. |

## 2. Architecture

```
BROWSER (board page, inside <Tldraw shapeUtils={liveShapeUtils} tools={liveTools}>)
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ editor.store.listen(src:'user')                                                        │
│  pen-up (draw isComplete false→true) / eraser / moved ink                              │
│        │                                                                               │
│        ▼ 600 ms quiet gate per line                                                    │
│  strokeClusters.ts ─► InkLine[] (union-find, fraction-bar merge, columns)              │
│        │                                                                               │
│        ▼ strokePayload.ts (page pts → RDP → 180 px-normalized ints → sha-1 hash)       │
│  recognizeClient.ts ──── cache hit? ──┐                                                │
│        │ POST /api/live/recognize     │                                                │
│        ▼                              ▼                                                │
│  engine/index.ts (mathjs, main thread, offline) analyzeLine() ──► LineAnalysis         │
│        │                                                                               │
│        ▼ policy.ts (mode × verdict × voice × idle → decision)                          │
│  placement.ts ─► liveWrite(mergeRemoteChanges) ─► math / graph shapes (meta.live)      │
│        │                                     └─► autosave (source:'all') → Supabase    │
│        ▼ (ladder permits)                                                              │
│  sseClient.ts ◄── POST /api/live/check | /api/live/solve (SSE) ──► hint cards / steps  │
│  liveStore (atoms) ─► LiveToggle · LiveStatusPill · LiveHintLayer · WorkLogSheet ·     │
│                        voice tools read_live_math / place_math / plot_function         │
└───────────────────────────────────────────────────────────────────────────────────────┘
SERVER (Node runtime route handlers; requireUser → rateLimited → zod → work)
  /api/live/recognize  GET capabilities+warmup · POST Mathpix v3/strokes ▸ vision fallback
  /api/live/check      SSE: meta → annotation* → done   (gemini-3.5-flash ▸ haiku-4.5)
  /api/live/solve      SSE: meta → step* → done         (claude-sonnet-5 ▸ gpt-5.4-mini)
  existing 7 routes    + requireUser + rateLimited preamble (behaviour otherwise unchanged)
  lib/server: auth.ts rateLimit.ts env.ts openrouter.ts mathpix.ts sse.ts prompts/*
```

### 2.1 Where computation runs
Browser: clustering, payload building, KaTeX, mathjs (evaluate/simplify/derivative/solve/units/constants/equivalence/chem/graph sampling), placement, policy. Mathpix (via our route): handwriting → LaTeX. OpenRouter (via our routes, streamed): why a step is wrong, Socratic hints, worked steps, word problems, anything the parser rejects. Persistence: unchanged whole-snapshot autosave (`getSnapshot`) — the new shapes are ordinary records.

### 2.2 Data flow (happy path, Suggest)
pen-up → 600 ms → cluster → payload (cache miss) → recognize (≈450 ms) → echo placed (`status:'pending'` → engine → `'ok'|'warn'|'none'`) → policy: mismatch in Suggest → check stream → `annotation` → hint card (ephemeral overlay; text persisted into the echo's `note`) → `done`. Every write goes through `liveWrite()` = `editor.store.mergeRemoteChanges(fn)`: source `'remote'` → not in the undo stack (HistoryManager drops non-`user` sources), invisible to the three existing `source:'user'` listeners (idle trigger `page.tsx:1356`, cancel-in-flight `:1379`, autosave `:1676` — the autosave listener moves to `source:'all'`).

### 2.3 Decisions (all open questions resolved)
1. Write isolation: `mergeRemoteChanges` for every live write + autosave listener `source:'all'`. `isUpdatingImageRef` is NOT touched by Live. `loadSnapshot` runs in `onMount` before the autosave effect subscribes, so no spurious save.
2. Quiet gate 600 ms (450 ms rewrite). Not 350 ms.
3. mathjs on the main thread via dynamic import, pre-warmed at mount. No Web Worker this build (the `getEngine(): Promise<LiveEngine>` seam allows one later).
4. Two custom shapes: `math`, `graph`. No `callout` shape; annotations are the echo badge + ephemeral hint cards.
5. Model output = JSON Lines, validated per line with zod on the server, forwarded as typed SSE events. The `ai` SDK stays unused (do not remove or upgrade this session).
6. Routes: `GET+POST /api/live/recognize`, `POST /api/live/check`, `POST /api/live/solve`. No `/api/live/compute` (engine is client-side; voice reads `liveStore`).
7. Models: check `google/gemini-3.5-flash` (fallback `anthropic/claude-haiku-4.5`), solve `anthropic/claude-sonnet-5` (fallback `openai/gpt-5.4-mini`), vision `google/gemini-3.1-flash-lite`; the broken `gpt` image id becomes `openai/gpt-5.4-image-2` (matches the UI label).
8. Shape utils registered unconditionally on BOTH `<Tldraw>` mounts (board `page.tsx:1857`, train `page.tsx:470`). Kill switch `NEXT_PUBLIC_LIVE_MATH=0` hides the pipeline/UI only.
9. Live switch persisted in `localStorage` `agathon.live.v1` (`src/lib/live/liveSettings.ts`), default ON, independent of the tabs; Off tab + Live ON = echo/typeset/calculator only.
10. Hint cards render as an absolutely positioned overlay child of `BoardContent` (like every existing overlay) using `editor.pageToScreen`, not `components.InFrontOfTheCanvas`.
11. Model bboxes are never used for placement; annotations anchor by `lineId`. `Annotation` has no bbox field.
12. Legacy image pipeline: kept; debounce 4000 ms while Live is on; skipped when the last ink burst is `pending`/`handled` by Live; forced by the "Draw help" button and by voice `draw_on_canvas`. Shapes with `meta.live` are excluded from its capture (next to `meta.isProtected`).
13. Voice: `read_live_math`, `place_math`, `plot_function` added (client-only). LLM nudges pause while voice is active; echoes/badges continue. Voice is untestable this session (invalid OpenAI key); code paths are unit-tested with a seeded store.
14. Rate limiting: in-memory sliding window on `globalThis`, Upstash-shaped interface. Auth: `supabase.auth.getUser(token)` with a bounded token-hash cache. Tested only against the local Supabase stack (`npx supabase start`; `.env.local` already points at it — the cloud project is NXDOMAIN).
15. Storage offload: design final (§8.5), implemented as the first follow-up PR, not in this build.
16. Toolbar: `MathShapeTool` (`m`) added via `components.Toolbar = LiveToolbar` + a `tools` override merged with the existing `hugeIconsOverrides`.
17. WorkLogSheet is in scope but is the first thing cut if WP-E runs late (then "Hide AI shapes" moves into the LiveStatusPill menu).

## 3. Work packages

Six packages: WP-0 runs first (orchestrator, ~20 min, committed before spawning); WP-A…WP-E run in parallel on disjoint files and compile independently against WP-0. Cross-package imports are limited to `src/lib/live/contracts.ts`, `liveWrite.ts`, `liveStore.ts`, `api-client.ts`, and the two stub modules (`engine/index.ts`, `useLiveMath.ts`) whose exports are frozen by WP-0 and whose bodies are replaced by their owners.

### WP-0 — Scaffold (owner: Orchestrator; before spawn)
Files: `package.json` (already has katex/mathjs/zod/@types/katex/vitest — add scripts `"test": "vitest run"`, `"test:watch": "vitest"`, `"typecheck": "tsc --noEmit"`), `package-lock.json`, `vitest.config.ts`, `src/app/globals.css` (add `@import "katex/dist/katex.min.css";` after the tldraw import), `.env.example` (add `MATHPIX_APP_ID`, `MATHPIX_APP_KEY`, `NEXT_PUBLIC_LIVE_MATH`, `LIVE_MODEL_CHECK`, `LIVE_MODEL_SOLVE`, `LIVE_MODEL_VISION`), `src/lib/api-client.ts` (already exists, untracked — commit as is), `src/lib/live/contracts.ts`, `src/lib/live/liveWrite.ts`, `src/lib/live/liveStore.ts`, `src/lib/live/engine/index.ts` (stub), `src/lib/live/useLiveMath.ts` (stub). Then `npm install`, `npx tsc --noEmit`, `npm test` (0 files is OK: `passWithNoTests: true`), commit `chore(live): scaffold contracts, stubs, vitest`.

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  esbuild: { jsx: "automatic" },
  test: { environment: "node", include: ["src/**/__tests__/**/*.test.ts", "src/**/__tests__/**/*.test.tsx"], passWithNoTests: true },
});
```

`src/lib/live/contracts.ts` (verbatim, the ONE shared file):
```ts
/**
 * Single source of truth shared by client, server, shapes, engine and tests.
 * Runtime dependency: zod only. tldraw imports are type-only (erased) so this is server-safe.
 */
import { z } from "zod";
import type { TLBaseShape, TLShapeId } from "tldraw";

// 1. Modes, verdicts, kinds -------------------------------------------------
export const HELP_MODES = ["off", "feedback", "suggest", "answer"] as const;
export type HelpMode = (typeof HELP_MODES)[number];
export const HelpModeSchema = z.enum(HELP_MODES);

/** What an echo can display. Deliberately no 'error' / 'wrong'. */
export const LIVE_VERDICTS = ["none", "pending", "ok", "warn", "unknown", "solved"] as const;
export type LiveVerdict = (typeof LIVE_VERDICTS)[number];

export const LINE_KINDS = [
  "expression", "equation", "assignment", "function", "inequality",
  "chem", "point", "label", "incomplete", "text", "unknown",
] as const;
export type LineKind = (typeof LINE_KINDS)[number];

/** Engine verdict of a line relative to the previous line in its column. */
export const ENGINE_VERDICTS = ["ok", "mismatch", "unknown", "none"] as const;
export type EngineVerdict = (typeof ENGINE_VERDICTS)[number];

// 2. Custom shapes (TS types; the tldraw T validators live in src/shapes/*) --
export const MATH_SOURCES = ["echo", "ai", "student"] as const;
export type MathSource = (typeof MATH_SOURCES)[number];
export const MATH_TONES = ["muted", "normal", "accent"] as const;
export type MathTone = (typeof MATH_TONES)[number];
export const MATH_SIZES = ["s", "m", "l"] as const;
export type MathSize = (typeof MATH_SIZES)[number];

export interface MathShapeProps {
  w: number;
  h: number;
  latex: string;
  source: MathSource;
  status: LiveVerdict;
  resultLatex: string;
  note: string;
  /** ids of the draw shapes this echo was recognized from ([] when typed) */
  anchorIds: string[];
  lineId: string;
  size: MathSize;
  tone: MathTone;
}
export type MathShape = TLBaseShape<"math", MathShapeProps>;
export const MATH_SHAPE_DEFAULTS: MathShapeProps = {
  w: 160, h: 44, latex: "", source: "student", status: "none", resultLatex: "",
  note: "", anchorIds: [], lineId: "", size: "m", tone: "normal",
};

export interface GraphFn { id: string; expr: string; latex: string; color: string }
export interface GraphPoint { x: number; y: number; label: string }
export interface GraphShapeProps {
  w: number; h: number;
  fns: GraphFn[];
  points: GraphPoint[];
  xMin: number; xMax: number; yMin: number; yMax: number;
  autoY: boolean;
  grid: boolean;
  title: string;
  lineId: string;
}
export type GraphShape = TLBaseShape<"graph", GraphShapeProps>;
export const GRAPH_SHAPE_DEFAULTS: GraphShapeProps = {
  w: 240, h: 200, fns: [], points: [], xMin: -10, xMax: 10, yMin: -10, yMax: 10,
  autoY: true, grid: true, title: "", lineId: "",
};
export const GRAPH_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#7c3aed", "#ea580c", "#0891b2"] as const;

/** meta of every shape the Live layer creates (type alias → assignable to JsonObject). */
export type LiveShapeMeta = {
  live: true;
  source: "echo" | "ai";
  lineId: string;
  createdAt: number;
  hintLevel?: number;
  edited?: boolean;
};
export function isLiveMeta(meta: unknown): meta is LiveShapeMeta {
  return typeof meta === "object" && meta !== null && (meta as { live?: unknown }).live === true;
}

// 3. Ink geometry (client only, tldraw page coordinates) ---------------------
export interface Rect { x: number; y: number; w: number; h: number }
export interface InkStroke {
  id: TLShapeId;
  bounds: Rect;
  /** one polyline per draw segment, page coords */
  segments: Array<Array<{ x: number; y: number }>>;
}
export interface InkLine {
  /** stable across bursts: reused when >= 50 % of strokeIds overlap a previous line */
  id: string;
  strokeIds: TLShapeId[];
  bounds: Rect;
  column: number;
  row: number;
  /** sha-1 of the normalized stroke payload (recognition cache key) */
  hash: string;
}
export interface StrokePayload { x: number[][]; y: number[][]; w: number; h: number }

// 4. Local engine -----------------------------------------------------------
export interface LineAnalysis {
  kind: LineKind;
  /** mathjs source, '' when unparseable */
  math: string;
  /** '' when nothing should be shown (calculator rule) */
  resultLatex: string;
  verdict: EngineVerdict;
  note: string;
  variable?: string;
  solutions?: string[];
  plot?: { expr: string; latex: string };
  chem?: { balanced: boolean; balancedLatex: string };
  units?: { ok: boolean };
  solved?: boolean;
  error?: string;
}
export interface AnalyzeContext { previous?: LineAnalysis; original?: LineAnalysis; mode: HelpMode }
export interface LiveEngine {
  analyzeLine(latex: string, ctx: AnalyzeContext): LineAnalysis;
  /** compiled y=f(x) sampler for graph shapes; null when the expression does not parse */
  compileExpr(expr: string): ((x: number) => number) | null;
  /** local solve of a single-variable equation; null when unsupported (LLM path) */
  solveLatex(latex: string): { latex: string; steps: string[] } | null;
  /** verifies an LLM `expected` claim (mathjs expr) against the student's line */
  verifyExpected(expected: string, latex: string): "equal" | "unequal" | "unknown";
  balance(equation: string): { coeffs: number[]; latex: string } | null;
  /** calculator input: '3.2*4.5', '5 km/h to m/s', 'd/dx x^3', 'balance Fe+O2->Fe2O3' */
  calculate(input: string): { latex: string } | null;
}

// 5. API contracts (zod is the source of truth) ------------------------------
export const RectSchema = z.object({
  x: z.number(), y: z.number(), w: z.number().nonnegative(), h: z.number().nonnegative(),
});
const Coords = z.array(z.array(z.number()).min(1).max(2000)).min(1).max(80);
export const RecognizeRequestSchema = z.object({
  boardId: z.string().min(1).max(64),
  lineId: z.string().min(1).max(64),
  strokes: z.object({ x: Coords, y: Coords }).refine(
    (s) => s.x.length === s.y.length && s.x.every((xs, i) => xs.length === s.y[i].length),
    { message: "x/y stroke arrays must align" },
  ),
  bounds: z.object({ w: z.number().positive(), h: z.number().positive() }),
  /** data:image/jpeg;base64 crop, only when the recognizer is 'vision' (<= 200 KB raw) */
  crop: z.string().startsWith("data:image/").max(280_000).optional(),
  hint: z.enum(["math", "chem", "physics"]).optional(),
});
export type RecognizeRequest = z.infer<typeof RecognizeRequestSchema>;
export const RecognizeResponseSchema = z.object({
  latex: z.string(),
  text: z.string(),
  kind: z.enum(["math", "chem", "text", "unknown"]),
  confidence: z.number().min(0).max(1),
  provider: z.enum(["mathpix", "vision"]),
  ms: z.number(),
});
export type RecognizeResponse = z.infer<typeof RecognizeResponseSchema>;
export const CapabilitiesResponseSchema = z.object({
  recognizer: z.enum(["mathpix", "vision"]),
  liveEnabled: z.boolean(),
  models: z.object({ check: z.string(), solve: z.string(), vision: z.string() }),
});
export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponseSchema>;

export const CheckLineSchema = z.object({
  id: z.string().min(1).max(64),
  latex: z.string().max(2000),
  /** [x0,y0,x1,y1] normalized 0..1 inside `region`; reading order only, never placement */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  local: z.object({
    kind: z.enum(LINE_KINDS),
    verdict: z.enum(ENGINE_VERDICTS),
    resultLatex: z.string().max(500).optional(),
    note: z.string().max(200).optional(),
  }),
});
export type CheckLine = z.infer<typeof CheckLineSchema>;
export const SUBJECTS = ["algebra", "geometry", "calculus", "physics", "chemistry", "other"] as const;
export const CheckRequestSchema = z.object({
  boardId: z.string().min(1).max(64),
  mode: z.enum(["feedback", "suggest"]),
  subject: z.enum(SUBJECTS).optional(),
  region: RectSchema,
  lines: z.array(CheckLineSchema).min(1).max(40),
  focusLineId: z.string().max(64).optional(),
  userAsked: z.boolean().default(false),
});
export type CheckRequest = z.infer<typeof CheckRequestSchema>;
export const ANNOTATION_KINDS = [
  "arithmetic", "sign", "algebra", "units", "concept", "notation", "incomplete", "praise",
] as const;
export const AnnotationSchema = z.object({
  lineId: z.string().max(64).nullable(),
  verdict: z.enum(["ok", "warn", "info"]),
  kind: z.enum(ANNOTATION_KINDS),
  /** <= 18 words, second person, names WHERE; never the corrected value below Solve */
  message: z.string().min(1).max(200),
  question: z.string().max(200).optional(),
  latex: z.string().max(500).optional(),
  /** mathjs expression the line's right side should equal; verified locally before display */
  expected: z.string().max(200).optional(),
  confidence: z.number().min(0).max(1).default(0.8),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const SolveRequestSchema = z.object({
  boardId: z.string().min(1).max(64),
  region: RectSchema,
  lines: z.array(CheckLineSchema).min(1).max(40),
  fromLineId: z.string().max(64).optional(),
  goal: z.string().max(200).optional(),
});
export type SolveRequest = z.infer<typeof SolveRequestSchema>;
export const SolveStepSchema = z.object({
  index: z.number().int().min(1).max(8),
  latex: z.string().min(1).max(500),
  explanation: z.string().max(200),
  final: z.boolean(),
});
export type SolveStep = z.infer<typeof SolveStepSchema>;

export const SseMetaSchema = z.object({ requestId: z.string(), model: z.string() });
export const SseDoneSchema = z.object({ count: z.number(), ms: z.number() });
export const SseErrorSchema = z.object({ error: z.string(), message: z.string() });
export type LiveSseEvent =
  | { event: "meta"; data: z.infer<typeof SseMetaSchema> }
  | { event: "annotation"; data: Annotation }
  | { event: "step"; data: SolveStep }
  | { event: "done"; data: z.infer<typeof SseDoneSchema> }
  | { event: "error"; data: z.infer<typeof SseErrorSchema> };

/** Body of every non-2xx response from /api/* */
export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  retryAfterSec: z.number().optional(),
  issues: z.unknown().optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

// 6. Server configuration (model ids verified on OpenRouter 2026-09-11) ------
export const LIVE_MODELS = {
  check: "google/gemini-3.5-flash",
  checkFallback: "anthropic/claude-haiku-4.5",
  solve: "anthropic/claude-sonnet-5",
  solveFallback: "openai/gpt-5.4-mini",
  vision: "google/gemini-3.1-flash-lite",
} as const;

export const RATE_LIMITS = {
  "live.recognize": { perMinute: 120, perDay: 3000 },
  "live.check": { perMinute: 30, perDay: 600 },
  "live.solve": { perMinute: 10, perDay: 200 },
  "generate-solution": { perMinute: 10, perDay: 300 },
  "generate-worksheet": { perMinute: 5, perDay: 100 },
  "check-help-needed": { perMinute: 30, perDay: 500 },
  ocr: { perMinute: 30, perDay: 500 },
  credits: { perMinute: 30, perDay: 2000 },
  "voice.token": { perMinute: 10, perDay: 100 },
  "voice.analyze": { perMinute: 30, perDay: 500 },
} as const;
export type RateLimitRoute = keyof typeof RATE_LIMITS;

// 7. Timing and limits ------------------------------------------------------
export const LIVE_TIMING = {
  quietMs: 600,             // pen-up -> recognize; resets on new ink in the same line
  rewriteQuietMs: 450,      // when the line already has an echo
  unknownIdleMs: 5000,      // Feedback: LLM check for 'unknown' only after this idle
  unreadableChipMs: 3000,   // low confidence: "Couldn't read this" chip only after this
  legacyIdleMs: 4000,       // legacy image pipeline debounce while Live is on (2000 when off)
  recognizeTimeoutMs: 6000,
  checkWatchdogMs: 4000,    // no model bytes -> fallback model
  pillFadeMs: 1500,
  readingLabelDelayMs: 600, // show "Reading…" only when recognition exceeds this
} as const;
export const LIVE_LIMITS = {
  minConfidence: 0.6,
  maxLiveShapesPerBoard: 60,
  maxLinesPerCheck: 40,
  maxStrokesPerLine: 80,
  maxPointsPerStroke: 2000,
  maxCropBytes: 200_000,
  maxHintsPerLine: 1,
  maxSolveSteps: 8,
  normalizedLineHeight: 180,
  rdpEpsilon: 0.75,
  cacheEntries: 500,
} as const;
export const LIVE_KILL_SWITCH = process.env.NEXT_PUBLIC_LIVE_MATH === "0";

// 8. Client live state and controller ---------------------------------------
export type LiveStatus = "idle" | "reading" | "checking" | "offline" | "paused" | "error";
export type RecognizerKind = "mathpix" | "vision" | "unknown";
export interface LiveLineState {
  line: InkLine;
  latex: string;
  confidence: number;
  provider: "mathpix" | "vision" | "typed" | "none";
  analysis: LineAnalysis | null;
  mathShapeId: TLShapeId | null;
  graphShapeId: TLShapeId | null;
  hintsShown: number;
  rewritesWithWarn: number;
  edited: boolean;
  updatedAt: number;
}
export interface OpenHint {
  id: string; lineId: string; message: string; question: string; level: number; createdAt: number;
}
export type BurstState = "pending" | "handled" | "unhandled";
export interface LiveBurst { at: number; state: BurstState }
export interface LiveTranscriptLine {
  id: string; latex: string; verdict: LiveVerdict; resultLatex: string; note: string; column: number;
}
export interface LiveTranscript { lines: LiveTranscriptLine[]; summary: string }
export interface LiveController {
  getTranscript(): LiveTranscript;
  placeMath(args: { latex: string; nearLineId?: string; tone?: MathTone }): TLShapeId | null;
  plotFunction(args: { expr: string; xMin?: number; xMax?: number; nearLineId?: string }): TLShapeId | null;
  requestCheck(lineId?: string): void;
  requestSolve(lineId?: string): void;
  escalate(lineId: string): void;
  dismissHint(hintId: string): void;
  clearMarks(): void;
  retypeLine(lineId: string, latex: string): void;
}
export interface UseLiveMathOptions { boardId: string; mode: HelpMode; enabled: boolean; voiceActive: boolean }
```

`src/lib/live/liveWrite.ts` (verbatim, final):
```ts
import type { Editor } from "tldraw";
/**
 * Every programmatic write of the Live layer. mergeRemoteChanges tags the change source
 * 'remote': not in the undo stack, invisible to the legacy source:'user' listeners.
 * The store throws if this is called inside an atomic op or a store listener, so callers
 * that run inside a listener use scheduleLiveWrite.
 */
export function liveWrite(editor: Editor, fn: () => void): void {
  editor.store.mergeRemoteChanges(fn);
}
export function scheduleLiveWrite(editor: Editor, fn: () => void): void {
  queueMicrotask(() => {
    try { liveWrite(editor, fn); } catch (e) { console.warn("[live] write failed", e); }
  });
}
```

`src/lib/live/liveStore.ts` (verbatim, final):
```ts
"use client";
import { atom } from "tldraw";
import type { LiveBurst, LiveLineState, LiveStatus, OpenHint, RecognizerKind } from "./contracts";

export const liveStore = {
  status: atom<LiveStatus>("live.status", "idle"),
  recognizer: atom<RecognizerKind>("live.recognizer", "unknown"),
  lines: atom<Record<string, LiveLineState>>("live.lines", {}),
  openHints: atom<OpenHint[]>("live.openHints", []),
  lastBurst: atom<LiveBurst | null>("live.lastBurst", null),
  liveShapeCount: atom<number>("live.shapeCount", 0),
};
export function setLine(id: string, patch: Partial<LiveLineState>): void {
  const all = liveStore.lines.get();
  const prev = all[id];
  if (!prev && !patch.line) return;
  liveStore.lines.set({ ...all, [id]: { ...(prev as LiveLineState), ...patch, updatedAt: Date.now() } });
}
export function removeLine(id: string): void {
  const { [id]: _gone, ...rest } = liveStore.lines.get();
  liveStore.lines.set(rest);
  liveStore.openHints.set(liveStore.openHints.get().filter((h) => h.lineId !== id));
}
export function markBurst(state: LiveBurst["state"]): void {
  liveStore.lastBurst.set({ at: Date.now(), state });
}
/** true when the legacy image pipeline should stay silent for the current idle window */
export function legacyShouldSkip(idleMs: number): boolean {
  const b = liveStore.lastBurst.get();
  return !!b && Date.now() - b.at <= idleMs + 1000 && b.state !== "unhandled";
}
export function resetLiveStore(): void {
  liveStore.status.set("idle"); liveStore.lines.set({}); liveStore.openHints.set([]);
  liveStore.lastBurst.set(null); liveStore.liveShapeCount.set(0);
}
```

`src/lib/live/engine/index.ts` (stub; WP-B replaces the body, keeps the exports):
```ts
import type { LiveEngine } from "../contracts";
const stub: LiveEngine = {
  analyzeLine: () => ({ kind: "unknown", math: "", resultLatex: "", verdict: "unknown", note: "" }),
  compileExpr: () => null, solveLatex: () => null, verifyExpected: () => "unknown",
  balance: () => null, calculate: () => null,
};
let enginePromise: Promise<LiveEngine> | null = null;
/** Lazily loads mathjs (WP-B). Safe to call at mount to pre-warm. */
export function getEngine(): Promise<LiveEngine> {
  if (!enginePromise) enginePromise = Promise.resolve(stub);
  return enginePromise;
}
```

`src/lib/live/useLiveMath.ts` (stub; WP-D replaces the body, keeps the export):
```ts
"use client";
import type { Editor } from "tldraw";
import type { LiveController, UseLiveMathOptions } from "./contracts";
const noop: LiveController = {
  getTranscript: () => ({ lines: [], summary: "Live is not ready." }),
  placeMath: () => null, plotFunction: () => null, requestCheck: () => {}, requestSolve: () => {},
  escalate: () => {}, dismissHint: () => {}, clearMarks: () => {}, retypeLine: () => {},
};
export function useLiveMath(_editor: Editor, _opts: UseLiveMathOptions): LiveController { return noop; }
```

### WP-A — Shapes (owner: Ada)
Create: `src/shapes/index.ts`, `src/shapes/math/MathShapeUtil.tsx`, `src/shapes/math/MathEditor.tsx`, `src/shapes/math/MathShapeTool.ts`, `src/shapes/math/katex.ts`, `src/shapes/graph/GraphShapeUtil.tsx`, `src/shapes/graph/plot.ts`, `src/shapes/LiveToolbar.tsx`, `src/shapes/__tests__/plot.test.ts`, `src/shapes/__tests__/snapshotRoundTrip.test.ts`, `src/shapes/__tests__/fixtures/legacy-board-snapshot.json`.
`index.ts` exports `liveShapeUtils = [MathShapeUtil, GraphShapeUtil] as const`, `liveTools = [MathShapeTool] as const`, `liveUiOverrides: TLUiOverrides` (adds tool item `{ id:'math', label:'Math', kbd:'m', icon:<Sigma/> , onSelect: () => editor.setCurrentTool('math') }`), `LiveToolbar` (`<DefaultToolbar><DefaultToolbarContent/><TldrawUiMenuItem {...useTools().math} isSelected={useIsToolSelected(useTools().math)} /></DefaultToolbar>`), `LIVE_SHAPE_TYPES = ['math','graph']`. Details in §4.
Acceptance: `npx tsc --noEmit` clean; `npm test` passes `plot.test.ts` (asymptote break for `1/x`, `tan(x)`; autoY from 5–95 percentile; `niceTicks(-3.2, 7.9)` → step 1/2/5·10ⁿ) and `snapshotRoundTrip.test.ts` (headless `createTLStore({ shapeUtils: [...defaultShapeUtils, ...liveShapeUtils], bindingUtils: defaultBindingUtils })`: create math+graph records → `getSnapshot` → `loadSnapshot` into a fresh store → deep-equal; a snapshot produced by a store WITHOUT live utils (generated in-test with `defaultShapeUtils`) and the recorded JSON fixture both load without throwing and keep their shape count); both utils declare `static migrations`; math shape never touches `document` at module scope (the test imports it under `environment: node`).
Isolation test: a throwaway page is not needed — run the two vitest files plus `node -e "import('tsx')..."` is not required; instead mount the utils in the existing app only through WP-E. Ada records the legacy fixture from the current build: `git stash`-free method — open any board on `main` before WP-E lands, draw a stroke and a text shape, run `copy(JSON.stringify(getSnapshot(editor.store)))` in devtools (expose via `window.__agathonEditor` — WP-E adds it; until then use the React devtools hook) and save the JSON.

### WP-B — Local STEM engine (owner: Blaise)
Replace body of `src/lib/live/engine/index.ts`; create `src/lib/live/engine/math.ts`, `latex.ts`, `classify.ts`, `equivalence.ts`, `units.ts`, `constants.ts`, `chem.ts`, `graph.ts`, `format.ts`, `__tests__/latex.test.ts`, `__tests__/classify.test.ts`, `__tests__/equivalence.test.ts`, `__tests__/units.test.ts`, `__tests__/chem.test.ts`, `__tests__/engine.test.ts`. Pure TypeScript, no DOM, no React, no tldraw imports; `getEngine()` does `await import("mathjs")` once (`create(all)` with registered constants) and resolves the real `LiveEngine`. Details in §6.4 and §7.
Acceptance: ≥ 40 LaTeX→value cases, classify table, equivalence chains (correct chain ok; sign slip mismatch; division slip mismatch; two unknowns unknown; final line → `solved`), units (`3.2 kg \cdot 9.8 m/s^2` → `31.36\,\mathrm{N}`; `5 mi/h` → `2.235 m/s`; `m + cm` mismatch → warn), chem (`Fe + O2 -> Fe2O3` → [4,3,2]; `C3H8 + O2 -> CO2 + H2O` → [1,5,3,4]; balanced input passes; impossible → null), `verifyExpected('11-3','2x=8')` → equal, `calculate('5 km/h to m/s')`. `analyzeLine` < 10 ms on a warm instance (test asserts < 50 ms). Any parse failure → `kind:'unknown'`, `verdict:'unknown'`, never throws.
Isolation: `npm test -- src/lib/live/engine`.

### WP-C — Server: auth, limits, env, providers, routes (owner: Curie)
Create: `src/lib/server/auth.ts`, `rateLimit.ts`, `env.ts`, `openrouter.ts`, `mathpix.ts`, `sse.ts`, `prompts/check.ts`, `prompts/solve.ts`, `prompts/recognizeVision.ts`, `src/app/api/live/recognize/route.ts`, `src/app/api/live/check/route.ts`, `src/app/api/live/solve/route.ts`, `src/lib/server/__tests__/rateLimit.test.ts`, `src/lib/server/__tests__/sse.test.ts`, `src/lib/server/__tests__/auth.test.ts`, `scripts/live-smoke.mjs`. Modify (preamble + model-id fix only): `src/app/api/generate-solution/route.ts`, `generate-worksheet/route.ts`, `check-help-needed/route.ts`, `ocr/route.ts`, `credits/route.ts`, `voice/token/route.ts`, `voice/analyze-workspace/route.ts`. Details in §5 and §8.
Acceptance: every route returns 401 `{error:'unauthorized'}` without a bearer; 400 `{error:'bad_request', issues}` on zod failure; 429 with `Retry-After` after the burst; `curl -N` against `next dev` shows `event: meta` within 1 s and incremental frames; `sse.test.ts` proves `jsonlToEvents` handles split chunks, code fences and one invalid line; `rateLimit.test.ts` covers window roll-over and per-day cap; `auth.test.ts` mocks `getUser` and proves the cache honours `exp`. `scripts/live-smoke.mjs` runs green against `next dev` + local Supabase.
Isolation: `node scripts/live-smoke.mjs` (env `BASE_URL`, `SMOKE_EMAIL`, `SMOKE_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) — needs no client code.

### WP-D — Client live loop (owner: Dirac)
Replace body of `src/lib/live/useLiveMath.ts`; create `src/lib/live/strokeClusters.ts`, `strokePayload.ts`, `recognizeClient.ts`, `sseClient.ts`, `policy.ts`, `placement.ts`, `liveSettings.ts`, `voiceTools.ts`, `__tests__/strokeClusters.test.ts`, `__tests__/strokePayload.test.ts`, `__tests__/policy.test.ts`, `__tests__/placement.test.ts`, `__tests__/voiceTools.test.ts`, `__fixtures__/strokes-2x+3=11.json`, `__fixtures__/strokes-two-lines.json`, `__fixtures__/strokes-fraction.json` (recorded draw shapes: `copy(JSON.stringify(editor.getCurrentPageShapes().filter(s => s.type === 'draw')))`). Details in §6.
Acceptance: clustering fixtures produce 1 / 2 / 1 lines respectively (fraction numerator, bar and denominator merge); payload normalization yields integer coords with height 180 ± 1 and RDP reduces points ≥ 40 % on the fixture; `policy.test.ts` is a table over mode × verdict × voiceActive × idle (see §6.5); `placement.test.ts` checks right-of-line, below-fallback and free-slot scanning with synthetic bounds; `voiceTools.test.ts` seeds `liveStore` and asserts `read_live_math` returns lines with no network. `useLiveMath` never calls `editor.store.mergeRemoteChanges` synchronously inside a listener (all writes go through `scheduleLiveWrite`).
Isolation: `npm test -- src/lib/live`; the hook is exercised in the browser only after WP-E.

### WP-E — Live UI + board integration + voice (owner: Euler)
Create: `src/components/live/LiveToggle.tsx`, `LiveStatusPill.tsx`, `LiveHintLayer.tsx`, `WorkLogSheet.tsx`, `LiveErrorBoundary.tsx`, `copy.ts`. Modify: `src/app/board/[id]/page.tsx`, `src/app/train/page.tsx`, `src/components/CreditsBanner.tsx`, `src/components/WorksheetGenerator.tsx`. Euler is the only agent touching `page.tsx`; codes against the WP-0 stubs (the app runs with echo-less Live until B/D land).
page.tsx edits, by line of the current file: (1) `<Tldraw shapeUtils={liveShapeUtils} tools={liveTools} overrides={boardOverrides} components={{ MenuPanel:null, NavigationPanel:null, HelperButtons:null, Toolbar: LiveToolbar }}>` at 1857, where `boardOverrides.tools = (e, t, h) => liveUiOverrides.tools!(e, hugeIconsOverrides.tools!(e, t, h), h)`; in `onMount` (1865) after `loadSnapshot`, `if (process.env.NODE_ENV !== 'production') (window as any).__agathonEditor = editor`. (2) In `BoardContent`: `const { settings: live, update: updateLive } = useLiveSettings(); const liveEnabled = live.enabled && !LIVE_KILL_SWITCH; const controller = useLiveMath(editor, { boardId: id, mode: assistanceMode, enabled: liveEnabled, voiceActive: isVoiceSessionActive });`. (3) 1351–1356: `handleAutoGeneration = () => { if (liveEnabled && legacyShouldSkip(LIVE_TIMING.legacyIdleMs)) return; void generateSolution({ source: 'auto' }) }` and `useDebounceActivity(handleAutoGeneration, liveEnabled ? LIVE_TIMING.legacyIdleMs : 2000, editor, isUpdatingImageRef, isProcessingRef)`. (4) 1078: `if ((shape?.meta as any)?.isProtected || isLiveMeta(shape?.meta)) protectedIds.add(sid)` (and `hasProtectedShapes` must count only `isProtected`, not live). (5) 1676: autosave listener `{ source: 'all', scope: 'document' }`. (6) 364, 663, 1178: `fetch(` → `authedFetch(` from `@/lib/api-client`; same in `CreditsBanner.tsx:22` and `WorksheetGenerator.tsx:52`; on `ApiError` 401 → `router.replace('/login')`, 429 → `toast('Slowing down a bit…')`. (7) `VoiceAgentControls` gains prop `liveController: LiveController`; at 566 push `...LIVE_VOICE_TOOLS`; in `handleFunctionCall` (341) add `else if (isLiveVoiceTool(name)) { const output = await handleLiveVoiceTool(name, args, liveController); dc.send(function_call_output(callId, output)); dc.send(response.create) }`; instructions string (607) gains: "When the student is doing math, call read_live_math first; it is instant and exact. Use analyze_workspace only for diagrams or when read_live_math returns no lines. Use place_math to write a typeset step and plot_function to graph instead of draw_on_canvas." (8) JSX: `<LiveToggle checked={live.enabled} onCheckedChange={(v) => updateLive({ enabled: v })} />` after `<ModeInfoDialog/>` (1725); `ModeInfoDialog` (134) gets a fourth "Live" paragraph; `<LiveErrorBoundary><LiveStatusPill onDrawHelp={() => void generateSolution({ force: true, source: 'auto' })} onClearMarks={controller.clearMarks} /><LiveHintLayer editor={editor} controller={controller} /></LiveErrorBoundary>` rendered when `!isVoiceSessionActive`; `<WorkLogSheet controller={controller} editor={editor} />` button next to `<BugReportButton/>` (1778). (9) `train/page.tsx:470`: `shapeUtils={liveShapeUtils}` only.
Acceptance: `npm run build` and `npx tsc --noEmit` clean; `npx eslint src/components/live src/shapes src/lib/live src/lib/server` zero errors (the 26 pre-existing errors elsewhere are not touched); board loads an old snapshot; Live off → exactly today's behaviour; toggle persists across reloads; all client `/api` calls carry the bearer.
Isolation: with only WP-0 + WP-E merged, the page renders, the toggle/pill/sheet mount, no console errors; `read_live_math` returns the stub transcript.

## 4. Custom tldraw shapes

Both utils: `static type`, `static props` (tldraw `T` validators — all fields required so a record is never partially valid), `static migrations = createShapePropsMigrationSequence({ sequence: [] })` from day one with ids reserved via `createShapePropsMigrationIds('math', {})` / `('graph', {})` — the first real prop change adds `{ id: ids.AddFoo, up(props) { props.foo = default }, down(props) { delete props.foo } }` to `sequence` and bumps nothing else. `getGeometry` → `new Rectangle2d({ width: w, height: h, isFilled: true })`. `indicator` → `<rect width={w} height={h} rx={6} />`.

Legacy snapshots: they contain no `math`/`graph` records and no schema entries for them; tldraw treats unknown-to-the-snapshot sequences as non-retroactive, so `loadSnapshot` succeeds unchanged (proved by `snapshotRoundTrip.test.ts`). Boards saved WITH live shapes require the utils to be registered wherever a store is created — hence registration on both mounts, never behind the kill switch; deploy in one release.

### 4.1 `math`
```ts
static props: RecordProps<MathShape> = {
  w: T.number, h: T.number, latex: T.string,
  source: T.literalEnum(...MATH_SOURCES),         // 'echo' | 'ai' | 'student'
  status: T.literalEnum(...LIVE_VERDICTS),        // 'none'|'pending'|'ok'|'warn'|'unknown'|'solved'
  resultLatex: T.string, note: T.string,
  anchorIds: T.arrayOf(T.string), lineId: T.string,
  size: T.literalEnum(...MATH_SIZES), tone: T.literalEnum(...MATH_TONES),
};
getDefaultProps() { return { ...MATH_SHAPE_DEFAULTS } }
canEdit() { return true }  canResize() { return false }  hideRotateHandle() { return true }  isAspectRatioLocked() { return true }
getText(shape) { return shape.props.latex }
```
Rendering: `component()` returns `<HTMLContainer className="live-math" data-status={status} data-source={source} data-tone={tone}>` with (a) badge span (ok: green check `#16a34a`; warn: amber dot `#d97706`; solved: "Solved" chip; pending/none/unknown: nothing; unknown+empty latex renders the faint copy "Couldn't read this — tap to type it"), (b) `dangerouslySetInnerHTML={{ __html: renderLatex(latex) }}` where `katex.ts` wraps `katex.renderToString(latex, { throwOnError: false, displayMode: false, strict: 'ignore', output: 'html' })`, (c) `resultLatex` in a muted span (`= 31.36\,\mathrm{N}`), (d) tone: muted = 60 % opacity gray, normal = black, accent = blue-500 tint with a 9 px "AI" corner mark; sizes s/m/l = 18/24/32 px font. A `ResizeObserver` (in a `useLayoutEffect`) measures the container; when `|dw| > 2 || |dh| > 2` it calls `scheduleLiveWrite(editor, () => editor.updateShape({ id, type: 'math', props: { w, h } }))`, guarded by a last-written-size ref so it cannot loop. Editing: when `useIsEditing(shape.id)` is true, `MathEditor` renders a textarea with the raw LaTeX and a live KaTeX preview (`onPointerDown={stopEventPropagation}`), committing on blur/Enter with a user-sourced `editor.updateShape({ props: { latex } })` and `meta: { ...meta, edited: true }` — WP-D's listener re-analyzes (no recognition). `toSvg()` returns `<text font-family="ui-monospace" font-size="14">{latex}</text>` (exports/thumbnails never drop the shape; KaTeX foreignObject export is stretch). Tool: `class MathShapeTool extends BaseBoxShapeTool { static override id = 'math'; static override initial = 'idle'; override shapeType = 'math' }` — click/drag places a `source:'student'` math shape and enters editing.

### 4.2 `graph`
```ts
static props: RecordProps<GraphShape> = {
  w: T.number, h: T.number,
  fns: T.arrayOf(T.object({ id: T.string, expr: T.string, latex: T.string, color: T.string })),
  points: T.arrayOf(T.object({ x: T.number, y: T.number, label: T.string })),
  xMin: T.number, xMax: T.number, yMin: T.number, yMax: T.number,
  autoY: T.boolean, grid: T.boolean, title: T.string, lineId: T.string,
};
getDefaultProps() { return { ...GRAPH_SHAPE_DEFAULTS } }
canResize() { return true }  isAspectRatioLocked() { return false }  onResize(shape, info) { return resizeBox(shape, info) }  // min 160×120 enforced in onResize
```
Rendering: `component()` = `<HTMLContainer>` with a 22 px header (KaTeX title, `−`/`+` buttons that halve/double the x-range, close `×` → `scheduleLiveWrite(deleteShape)`) and an `<svg viewBox="0 0 w h-22">` produced by `plot.ts` (pure): `buildPlot({ fns: [{ sampler: (x)=>number, color, id }], points, xMin, xMax, yMin, yMax, autoY, grid, w, h, samples: 240 }) → { paths: [{ d, color }], ticks: { x: number[], y: number[] }, axes: { x0: number|null, y0: number|null }, yRange }`; samplers come from `getEngine().compileExpr(fn.expr)` (memoized per expr; the shape renders axes only until the engine resolves). Path breaks where `|Δy| > 8 × yRange` or y is non-finite (asymptotes); `autoY` picks a padded 5th–95th percentile range of finite samples; `niceTicks`. `toSvg()` returns the same SVG (exact exports). Points are dots with labels; up to 6 fns with `GRAPH_COLORS`.

## 5. API routes

Common: `export const runtime = 'nodejs'; export const dynamic = 'force-dynamic'; export const maxDuration = 30;` (`solve`: 60). Handler preamble (verbatim):
```ts
const auth = await requireUser(req); if (auth instanceof NextResponse) return auth;
const limited = rateLimited(auth.user.id, 'live.check'); if (limited) return limited;
const parsed = CheckRequestSchema.safeParse(await req.json().catch(() => null));
if (!parsed.success) return NextResponse.json({ error: 'bad_request', issues: parsed.error.issues }, { status: 400 });
```
Errors: 401 `{error:'unauthorized'}`; 429 `{error:'rate_limited', retryAfterSec}` + `Retry-After`; 400 `{error:'bad_request', issues}`; 402 `{error:'credits_exhausted', message}` (existing shape, produced by `openrouter.ts`); 500 `{error:'server_misconfigured', missing:[…]}` from `env.ts`; 502 `{error:'recognizer_failed'}`. Every response carries `X-Request-Id`.

`auth.ts`: `requireUser(req: Request): Promise<{ user: { id: string; email?: string }; token: string } | NextResponse>` — reads `Authorization: Bearer`, verifies with a module-level `createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).auth.getUser(token)`, caches `sha256(token) → { user, expiresAt: min(jwt.exp·1000, now+5 min) }` in a bounded Map (500 entries, insertion-order eviction). Client side: `authedFetch` in `src/lib/api-client.ts` (exists).
`rateLimit.ts`: `rateLimited(userId, route: RateLimitRoute): NextResponse | null` and `checkLimit(key, cfg): { ok, remaining, retryAfterSec }` — sliding window of timestamps + a `dayKey` counter per `${route}:${userId}` on `globalThis.__agathonRateLimit` (per instance, documented; same signature as an `@upstash/ratelimit` wrapper for a later swap); map bounded to 10 000 keys.
`env.ts`: `getEnv()` parses `process.env` once with zod (`OPENROUTER_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` required; `MATHPIX_APP_ID/KEY`, `OPENAI_API_KEY`, `MISTRAL_API_KEY`, `NEXT_PUBLIC_SITE_URL`, `LIVE_MODEL_CHECK/SOLVE/VISION` optional, defaults from `LIVE_MODELS`); throws `ServerMisconfigured(missing)`; routes catch it → 500.
`sse.ts`: `sseResponse(req, run: (emit, signal) => Promise<void>)` → `new Response(ReadableStream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } })`; `emit(event, data)` writes `event: <name>\ndata: <json>\n\n`; `: ping\n\n` every 15 s; `req.signal` abort → abort upstream + close. `jsonlToEvents(chunks: AsyncIterable<string>, schema, onItem): Promise<{ count, invalid }>` buffers deltas, strips ``` fences, splits on `\n`, `JSON.parse` + `schema.safeParse` per line, logs and drops invalid lines.
`openrouter.ts`: `streamChatText({ model, messages, signal, temperature, reasoningEffort, maxTokens }): AsyncGenerator<string>` over `POST https://openrouter.ai/api/v1/chat/completions` with `stream: true`, headers `HTTP-Referer`/`X-Title`, body extras `reasoning: { effort }`, `provider: { sort: 'latency' }`; parses `data:` frames, ignores `:` comments and `[DONE]`; `streamWithFallback(primary, fallback, opts)` aborts and retries on the fallback when no content arrives within `LIVE_TIMING.checkWatchdogMs`; `chatJson({ model, messages, schema })` for the vision transcription (`response_format: { type: 'json_object' }`); 402 / "insufficient credits" → `OpenRouterError('credits_exhausted')`.
`mathpix.ts`: `isMathpixConfigured()`, `recognizeStrokes(payload: StrokePayload, signal)` → `POST https://api.mathpix.com/v3/strokes`, headers `app_id`, `app_key`, body `{ strokes: { strokes: { x, y } }, formats: ['latex_styled', 'text'] }`, 4 s timeout, reads `latex_styled`, `text`, `confidence`; returns null on error/timeout.

### 5.1 `GET /api/live/recognize` — capabilities + warmup (called once at board mount)
→ 200 `CapabilitiesResponse` `{ recognizer: 'mathpix'|'vision', liveEnabled: true, models: { check, solve, vision } }`.

### 5.2 `POST /api/live/recognize` (limit `live.recognize`)
Request `RecognizeRequestSchema`; response `RecognizeResponseSchema`. Mathpix first; when unconfigured or null → vision fallback with `crop` (if absent → 502 `recognizer_failed`; the client then marks the line unknown). `kind`: `chem` if latex contains `\rightarrow|->|\to` and `[A-Z][a-z]?(_\{?\d+\}?)?` element tokens; `text` if `\text{}` covers > 50 % of characters or there is no digit/operator/backslash; `unknown` if latex is empty; else `math`. Vision prompt (`prompts/recognizeVision.ts`): "Transcribe the handwriting exactly as written, even if mathematically wrong. Return JSON {"latex","text","confidence" (0..1),"isMath"}. Do not solve or correct. KaTeX-renderable LaTeX only." The server never stores strokes or crops; logs `{ requestId, provider, ms, confidence }`.

### 5.3 `POST /api/live/check` (SSE, limit `live.check`)
Request `CheckRequestSchema`. Stream: `meta {requestId, model}` → `annotation` × 0..3 (`AnnotationSchema`) → `done {count, ms}`; on failure `error {error, message}` then close. Model `LIVE_MODELS.check`, `temperature: 0`, `reasoning: { effort: 'minimal' }`, fallback `checkFallback` via watchdog. Server post-filters: in `feedback` mode `question`/`latex` are stripped; annotations whose `lineId` is not in the request are dropped; `praise` is dropped unless the last line's local verdict is `ok` or `solved`.
Prompt rules (`prompts/check.ts`, system): (1) Input is the student's lines as LaTeX in reading order with a local computer-algebra verdict per line; trust those verdicts for arithmetic/algebra equivalence — your job is the WHY and the nudge, never re-deriving. (2) Output JSON Lines only: one `Annotation` object per line, most important first, at most 3, no prose, no fences. (3) `message` ≤ 18 words, second person, names WHERE ("Look again at the right side of line 3"), never the corrected value below Solve; feedback mode: location only, no `question`; suggest mode: one Socratic `question` and a one-sentence hint, never the final answer. (4) Put a mathjs-evaluable `expected` for what the flagged line's right side should equal (e.g. `11-3`) instead of doing arithmetic in prose. (5) No exclamation marks, no "wrong", no emojis, never mention LaTeX/OCR/being an AI. (6) If a line looks misread emit `kind:'notation'`, `message:'I might have misread this line — tap to fix it'`, `confidence < 0.5`. (7) If everything is correct emit nothing, unless the chain is complete, then one `praise` ≤ 8 words. (8) `lineId` must be one of the given ids or null.

### 5.4 `POST /api/live/solve` (SSE, limit `live.solve`, `maxDuration = 60`)
Request `SolveRequestSchema`. Stream `meta` → `step` × ≤ 8 (`SolveStepSchema`) → `done`. Model `LIVE_MODELS.solve`, `temperature: 0.2`, `reasoning: { effort: 'low' }`, fallback `solveFallback`. Prompt rules (`prompts/solve.ts`): start from `fromLineId` (the last correct line) or the problem statement; keep the student's variable names; units on every physics line; `explanation` ≤ 20 words; last step `final: true` with `latex` wrapped in `\boxed{}`; chemistry: balanced equation first, then mole ratio; JSON Lines only.

### 5.5 Existing routes
Each gets the preamble (route keys: `generate-solution`, `generate-worksheet`, `check-help-needed`, `ocr`, `credits`, `voice.token`, `voice.analyze`); `MODEL_IDS.gpt = 'openai/gpt-5.4-image-2'` in `generate-solution` and `generate-worksheet`. Nothing else changes (ocr's upstream model is dead — out of scope).

## 6. Client engine

### 6.1 Event pipeline
`useLiveMath(editor, opts)` subscribes once: `editor.store.listen(onChange, { source: 'user', scope: 'document' })`. In each `HistoryEntry`:
- pen-up: `changes.updated[id] = [from, to]` with `to.typeName === 'shape' && to.type === 'draw' && from.props.isComplete === false && to.props.isComplete === true` (the draw tool's `complete()` does exactly this update; one shape per stroke unless shift extends the previous one — a new segment on a completed shape is treated as dirty too), or `changes.added` draw with `isComplete` (taps). → `markBurst('pending')`, mark the stroke dirty, arm the quiet timer (`quietMs`, or `rewriteQuietMs` if the line already has an echo). Ignore shapes with `meta.isProtected` or `isLiveMeta(meta)`.
- moved/erased ink: `updated` draw with changed `x/y/segments` → dirty (a moved line hits the payload cache; only its echo is re-placed); `removed` draw → re-cluster; when every anchor of a line is gone → delete its echo, graph and AI shapes, `removeLine`.
- math shape edited by the student (`updated` math with `props.latex` changed, source `'echo'`) → `retypeLine(lineId, latex)`: `provider:'typed'`, `edited:true`, re-analyze, no recognition.
On timer fire: `collectInk(editor)` → `clusterLines(ink)` (§6.2) → for each dirty line: `buildPayload(editor, line)` (§6.3) → hash → cache (`Map<hash, RecognizeResponse>`, 500 entries) → else `recognize()` with an `AbortController` per `lineId` (a new burst on the same line aborts the in-flight recognize and check; a 2-slot limiter queues the rest) → apply (§6.4) → policy (§6.5) → placement (§6.6) → maybe check stream. Offline (`!navigator.onLine` or fetch failure): status `offline`, queue ≤ 5 lines, replay on `window 'online'`.

### 6.2 Stroke grouping (`strokeClusters.ts`, pure)
Input `InkStroke[]` (page bounds via `editor.getShapePageBounds`, page points via `editor.getShapePageTransform(shape).applyToPoint(p)` per segment point — draw geometry uses raw segment points; `props.scale` affects stroke width only). Union-find with transitive closure: strokes `a`,`b` join when their vertical intervals overlap ≥ 40 % of the smaller height OR the horizontal gap < 1.2 × median stroke height while vertical centers differ < 0.6 × median height; a wide, flat stroke (w > 3h and h < 0.25 × median) is a fraction bar and joins everything whose x-range overlaps it ≥ 50 % within 1.5 × median height above or below. Lines are sorted top-to-bottom into columns by x-overlap ≥ 40 % (`column`, `row`). Line ids persist: a new cluster reuses the id of the previous line sharing ≥ 50 % of its stroke ids; otherwise `ln_<8 hex>`. `rebuildFromMathShapes(shapes)` seeds `liveStore.lines` from echoes' `anchorIds`/`lineId` on load, so reload never re-recognizes.

### 6.3 Payload (`strokePayload.ts`, pure)
`sx = clamp(180 / line.bounds.h, 0.5, 8)`; for each segment point `X = round((px − line.x)·sx)`, `Y = round((py − line.y)·sx)`; RDP with ε = 0.75 (normalized units); drop duplicate consecutive points; cap 80 strokes × 2000 points (over cap → skip recognition, `kind:'unknown'`); `w,h` = normalized size; `hash = sha1(JSON(x,y))` via `crypto.subtle`. Typical payload 1–6 KB. Vision crop (only when `liveStore.recognizer === 'vision'`): `editor.toImage(line.strokeIds, { format: 'jpeg', quality: 0.8, background: true, padding: 8, bounds: Box.From(line.bounds).expandBy(8), scale: min(1, 512 / line.bounds.w) })` → data URL ≤ 200 KB.

### 6.4 Recognition → local CAS → LLM check
Apply `RecognizeResponse` to the line: `latex`, `confidence`, `provider`; `analysis = engine.analyzeLine(latex, { previous, original, mode })` where `previous` is the analysis of the line above in the same column and `original` the column's first equation. Engine (`WP-B`): `latex.ts` (`\frac`, `\sqrt[n]`, `\cdot`/`\times`/`\div`, `^{}`, subscripts as identifiers, greek, trig/log, `^\circ`→`deg`, `\left(\right)`, `\text{kg}`/trailing unit tokens → mathjs units, `\pm` → two branches, `\le \ge \ne`; unsupported → `UnsupportedLatex`), `classify.ts` (kinds; `label` = problem numbers/single letters/bare small integers; `incomplete` = trailing `=`/operator or unbalanced brackets), `equivalence.ts` (single unknown: `g_k = lhs − rhs`; linear/quadratic via `rationalize` coefficients → exact roots; else numeric roots on [−50, 50] with bisection; `ok` iff every root of `g_{k−1}` satisfies `|g_k| < 1e-6` relative and vice versa; `unknown` for two unknowns or parse failure; `solved` when `x = c` satisfies `original`), `units.ts` (mathjs `unit`, `preferUnit` table N/J/W/Pa/C/V/Ω/T, 4 significant figures, incompatible-add → `units.ok=false`, note "These units don't add together"), `constants.ts` (g = 9.80665 m/s², c, h, ħ, k_B, N_A, e — charge when followed by a unit or in a physics line, else Euler — G, R, ε₀, μ₀), `chem.ts` (formula parser with parentheses/hydrates, 118-element molar masses, rational nullspace balancing → smallest positive integers ≤ 30), `graph.ts` (`plot` for `function` kind). Calculator rule (in `analyzeLine`): `resultLatex` only for bare expressions with units, constants, functions or ≥ 3 operations, never for lines ending in `=` (in `answer` mode the trailing-`=` result is returned in `resultLatex` and shown after `unknownIdleMs`).
LLM check: fires per §6.5; request = the column's lines (`CheckLine[]`, ≤ 40, bbox normalized to `region` = union of the column's line bounds + 24 px), `focusLineId`, `userAsked`. On `annotation`: drop if `lineId` unknown; drop `warn` when the local verdict for that line is `ok`; if `expected` present and `engine.verifyExpected(expected, line.latex) === 'equal'` drop it (the LLM contradicted the CAS); otherwise apply: `warn` → echo `status:'warn'`, `note = message`; Suggest → `OpenHint` card with `message`/`question` (max 1 per line, none while another card is open); `notation` → note "Not what you wrote? Tap to fix." Persist the shown text into the echo's `note` (work log). On `step`: place a solution math shape (§6.6).

### 6.5 Policy (`policy.ts`, pure, tested) — silence rules and the ladder
```ts
decide({ mode, voiceActive, analysis, confidence, idleMs, userAsked, hintsShownForLine,
         openHintCount, rewritesWithWarn, liveShapeCount }) → { echo, badge, showResult,
         runLlmCheck, allowHint, allowSteps, revealChemBalance, offerHintPrompt }
```
1. Never render while the pen is down or before the quiet gate. 2. `echo=false` for `label`/`incomplete` kinds and when `confidence < 0.6` (after `unreadableChipMs` idle the faint "Couldn't read this — tap to type it" chip is placed instead, once). 3. `badge`: off → `none`; feedback/suggest/answer → engine `ok`→`ok`, `mismatch`→`warn`, `unknown`/`none`→`none`, `solved`→`solved`. Never `warn` from `unknown`. 4. `showResult`: calculator rule in every mode; answer mode additionally reveals trailing-`=` results after `unknownIdleMs`. 5. `runLlmCheck`: off → never; feedback → `userAsked || (verdict === 'unknown' && idleMs >= unknownIdleMs && kind ∈ {equation, expression, inequality, assignment})`; suggest → feedback rules OR (`verdict === 'mismatch' && hintsShownForLine < 1`); answer → same as suggest; always `false` while `voiceActive`. 6. `allowHint`: suggest/answer only, `hintsShownForLine < maxHintsPerLine`, `openHintCount === 0`. 7. `allowSteps` (and Solve-it): answer only, explicit tap. 8. `revealChemBalance`: answer only (suggest says "Count the O atoms on each side"). 9. `offerHintPrompt`: `rewritesWithWarn >= 2` → the pill offers "Want a hint?" once instead of pushing a card. 10. `liveShapeCount >= 60` → echo only; pill shows "Clear marks". 11. `escalate(lineId)`: feedback → suggest → one solve step for THIS line only; the global mode never changes. 12. No red X, no "wrong", no exclamation marks, no sounds; the only celebration is "Solved".

### 6.6 Placement (`placement.ts`) — page coordinates
`line.bounds = Box.Common(strokeBounds)`. Echo: `x = bounds.maxX + 24`, `y = bounds.midY − h/2`, `h = {s:34, m:44, l:56}[size]`, `w0 = 8.5·latex.length + 32` (ResizeObserver corrects); if `x + w0 > viewport.maxX − 16` → below: `x = bounds.x`, `y = bounds.maxY + 12`. `findFreeSlot(candidate, avoid)`: `avoid` = page bounds of every shape except this line's strokes and its own live shapes; try `candidate` shifted right by `i·40` for `i = 0..5`, then rows below at `bounds.x, bounds.maxY + 12 + j·(h + 8)` for `j = 1..4`; else the original candidate. Graph: `x = echo.maxX + 16`, `y = bounds.y`; overflow → `x = bounds.x`, `y = max(bounds.maxY, echo.maxY) + 16`. Solution steps: `x = column.bounds.x`, `y = lastLine.bounds.maxY + 16 + (i − 1)·52`, tone accent, opacity 1 (they are labelled "AI"; no Keep/Dismiss — the student deletes like any shape). Unreadable chip: same slot as an echo. Hint card (screen space, `LiveHintLayer`): `p = editor.pageToScreen({ x: echo.x, y: echo.maxY + 8 })`, clamped inside the container, re-computed via `useValue('camera', () => editor.getCamera(), [editor])`; closes when its line changes or on "Got it"; "More help" → `controller.escalate(lineId)`. All shape writes: `scheduleLiveWrite(editor, () => editor.createShapes([{ id: createShapeId(), type: 'math', x, y, props, meta: { live: true, source, lineId, createdAt } }]))`; upserts keyed by `lineId` (`liveStore.lines[lineId].mathShapeId`) so a rewrite updates in place; `liveShapeCount` = count of `isLiveMeta` shapes on the page, recomputed after each write.

### 6.7 Debounce / cancellation / silence summary
Quiet gate 600 / 450 ms per line; one recognize per line per burst (cache by content hash); per-line `AbortController` supersedes in-flight recognize+check; 2 concurrent recognitions max; check watchdog 4 s → fallback model; recognize timeout 6 s → `unknown`. Silent when: pen down; label/incomplete; confidence < 0.6; voice active (LLM only); mode off (LLM never); legacy pipeline owns the burst (`unhandled`); shape cap reached; a hint is already open for the column; the same hint text was already shown on that line.

## 7. STEM tools

| Capability | Where | Implementation |
|---|---|---|
| Evaluate, fractions, percents, roots, powers, trig (deg/rad), logs | Local | mathjs `evaluate` / `fraction`; `format.ts` → LaTeX via `node.toTex()` |
| Simplify, expand, factor ≤ cubic | Local | `simplify`, `rationalize`, roots via `polynomialRoot` |
| Solve single-variable equations (linear/quadratic/cubic exact, else numeric) | Local | `rationalize` coefficients → `polynomialRoot`; bisection scan fallback |
| Step equivalence between consecutive lines; final-answer "Solved" | Local | `equivalence.ts` (root comparison / substitution) |
| Derivatives (`\frac{d}{dx}`, `\frac{d^2}{dx^2}`, `\frac{dy}{dx}` / `f'(x)` against an earlier definition) | Local | `derivative`; unknown functions refused, never read as a constant factor |
| Definite integrals: exact for polynomials over rational limits, else Simpson (1000 panels, 4 s.f.) | Local | `\int_a^b ... dx`; indefinite, improper and singular ones are refused |
| Finite sums `\sum_{i=a}^{b}` (integer limits, ≤ 10 000 terms) | Local | `summation()` on the instance; infinite/symbolic limits and ambiguous summands refused |
| Units, conversions, unit-aware physics formulas, dimensional mismatch | Local | mathjs `unit`, `to`, `preferUnit` |
| Physical constants g, c, h, ħ, k_B, N_A, e, G, R, ε₀, μ₀ | Local | `constants.ts` registered on the mathjs instance |
| Graphs of y = f(x), points, multiple functions, asymptote breaks | Local | `graph` shape + `plot.ts` sampling via `compileExpr` |
| Chemistry: formula parsing, molar mass, equation balancing, balanced verdict | Local | `chem.ts` rational nullspace, 118-element table |
| Statistics on lists (mean/median/std), vector magnitude/dot | Local | mathjs |
| 2–3 variable linear systems | Local | `lusolve` (verdict `unknown` on failure) |
| Word problems → equations, proofs, concept/setup errors, limits, matrices, symbolic integrals, stoichiometry narratives, anything the parser rejects | LLM | `/api/live/check` (gemini-3.5-flash ▸ haiku-4.5) and `/api/live/solve` (claude-sonnet-5 ▸ gpt-5.4-mini) with local verdicts as ground truth; numeric claims (`expected`) re-verified locally |
| Handwriting → LaTeX | Mathpix ▸ vision LLM | `/api/live/recognize` |
Decision rule: if mathjs can produce a deterministic answer in < 100 ms it is local; the LLM explains, never overrides an `ok`.

## 8. Production hardening (in this build)
1. Auth on every `/api/*` route (`requireUser`), client calls through `authedFetch`; 401 → redirect to `/login`. Validated against the local Supabase stack (cloud project is gone).
2. Rate limits per user per route (`RATE_LIMITS`), 429 + `Retry-After`; client backs off with a toast. Per-instance; Upstash-shaped interface for a later swap.
3. Env validation (`env.ts`) with a single 500 `server_misconfigured` shape; `.env.example` updated.
4. Payload limits (zod) and timeouts (Mathpix 4 s, recognize 6 s, model watchdog 4 s, `maxDuration`), `X-Request-Id` on every response, pino logs `{requestId, route, userId, ms, provider}`; client timings `live.echo.total.ms`, `live.check.ttfa.ms` into the console ring buffer (bug reports).
5. Error boundaries: `LiveErrorBoundary` (React class component, logs + renders nothing) around the pill, hint layer and work log; tldraw's default `ShapeErrorFallback` isolates a failing shape; `katex` `throwOnError: false`; engine never throws.
6. Storage offload plan (final design; first follow-up PR): bucket `board-assets` and policies already exist in `supabase/migrations/20260911000000_init.sql` §B4. Add `src/lib/boardAssets.ts` implementing tldraw's `TLAssetStore` (`upload(asset, file, abortSignal)` → `supabase.storage.from('board-assets').upload('<uid>/<boardId>/<assetId>.<ext>', file)` returning `{ src: publicUrl }`; `resolve` returns `asset.props.src`), pass `assets={boardAssetStore}` to both `<Tldraw>` mounts, route AI-generated data URLs through the same upload before `createAssets`, register rows in `board_assets`, and add a one-time migration that rewrites base64 `src` values in existing snapshots on load. Result: `whiteboards.data` shrinks from MBs to KBs; PostgREST timeouts disappear.
7. Deploy skew: shape utils registered unconditionally; kill switch only hides UI/pipeline; single release.

## 9. Dependencies (exact npm names)
Already added to `package.json` (uncommitted; WP-0 commits): `katex@^0.18.7` (synchronous LaTeX → HTML; ships its own types), `mathjs@^15.2.0` (CAS/units/constants/fractions; dynamic-imported, ~600 KB min, never on first paint), `zod@^3.25.76` (shared request/stream schemas; was transitive via `ai`), dev `vitest@^5.0.0` (test runner; none existed), dev `@types/katex@^0.16.8` (redundant with katex 0.18's bundled types; harmless, remove in cleanup). Nothing else is added: no `jsdom` (tests run in Node; the shape modules avoid `document` at module scope), no `function-plot`/`d3` (hand-rolled SVG exports exactly through `toSvg`), no `@upstash/ratelimit` (in-memory now), no `ai` v5 upgrade (v4.3 stays installed and unused), no `nerdamer`.

## 10. Verification plan

### 10.1 Unit (vitest, `npm test`)
- `src/lib/live/engine/__tests__/*`: LaTeX table (≥ 40), classify table, equivalence chains, units, constants, chem balancing (Fe/O₂; C₃H₈; Al + HCl; KMnO₄ + HCl), `verifyExpected`, `calculate`, `solveLatex('2x+3=11')` → `x = 4`.
- `src/lib/live/__tests__/strokeClusters.test.ts` (fixtures: single line, two lines, fraction with superscript; two-column work → two columns), `strokePayload.test.ts` (normalization to height 180, RDP reduction, hash stability under translation), `policy.test.ts` (table mode × verdict × voice × idle × userAsked → decision; asserts no LLM in off mode and none while voice is active), `placement.test.ts` (right/below/free-slot, page-coordinate math with synthetic bounds), `voiceTools.test.ts`.
- `src/shapes/__tests__/plot.test.ts`, `snapshotRoundTrip.test.ts` (round trip; legacy snapshot generated with `defaultShapeUtils` loads; recorded fixture loads).
- `src/lib/server/__tests__/rateLimit.test.ts`, `sse.test.ts` (chunk splitting, fences, invalid line dropped), `auth.test.ts` (cache honours `exp`, 401 shape).
- Regression: `src/lib/live/__tests__/noLoop.test.ts` — with `useLiveMath`'s listener attached to a headless store, creating a `math` shape via `liveWrite` (source `'remote'`) triggers no recognize call (mocked `authedFetch` asserts zero calls); creating a completed `draw` shape via a user-sourced put triggers exactly one after the quiet gate (fake timers).
- Gates: `npx tsc --noEmit`, `npm run build`, `npx eslint src/components/live src/shapes src/lib/live src/lib/server` = 0 errors.

### 10.2 Scripted route tests (`node scripts/live-smoke.mjs`, against `next dev` + local Supabase, then the Vercel preview)
Signs in with `SMOKE_EMAIL`/`SMOKE_PASSWORD` (password grant via supabase-js); asserts: every route (3 new + 7 existing) → 401 without a token; `GET /api/live/recognize` → valid `CapabilitiesResponse`; `POST /api/live/recognize` with `src/lib/live/__fixtures__/strokes-2x+3=11.json` → `latex` contains `2x` (Mathpix) or non-empty (vision), `confidence > 0.8` (Mathpix), `ms < 1500`; bad body → 400 with `issues`; `POST /api/live/check` with three algebra lines (`localVerdict` mismatch on line 3) → events in order `meta`→`annotation`→`done`, `meta` < 1000 ms, first `annotation` < 2000 ms from request start, every payload validates against `AnnotationSchema`, `curl -N` prints frames incrementally; `POST /api/live/solve` → ends with a `final: true` boxed step; 130 rapid recognize calls → ≥ 1 × 429 with `Retry-After`; with `MATHPIX_APP_ID=` unset the capabilities report `vision` and recognize still returns latex from the crop.

### 10.3 Manual browser checklist (`next dev`, logged-in test user; gstack `/browse` where possible)
1. Open a board saved before this change → loads, no console errors, thumbnail still saves.
2. Live pill "Live" visible; `GET /api/live/recognize` fired once.
3. Handwrite `2x + 3 = 11`, `2x = 8`, `x = 4` → each echo within ≤ 1.5 s (p50 ≤ 1.2 s over 20 lines, read `live.echo.total.ms` from the log buffer); lines 2–3 green checks; "Solved" on line 3. Ctrl+Z removes ink, not echoes.
4. Erase line 3, write `x = 5` → amber dot (Feedback), no card. Switch to Suggest, tap the dot → hint card < 2 s after the check starts; "More help" escalates once; card closes when the line is rewritten.
5. Solve tab → "Show steps" → step shapes stream in below the work; "Solve it" on `2x+3=11` returns locally.
6. `y = x^2 - 4` → graph card, resizable, draggable, `−`/`+` range, `×` closes; `(2, 0)` written nearby adds a point.
7. `3.2 kg \cdot 9.8 m/s^2` → `= 31.36\,\mathrm{N}` with the network tab offline; `Fe + O_2 \rightarrow Fe_2O_3` → echo; amber dot in Feedback ("not balanced yet" behind the dot); balanced equation shown only in Solve.
8. Double-click an echo, fix the LaTeX → verdicts recompute; `meta.edited` true; a later stroke elsewhere does not overwrite it.
9. Reload → same count and positions (± 1 px) of math/graph shapes; Work log lists lines, verdicts, hints; "Hide AI shapes" toggles; "Copy work log" copies text.
10. Draw a labelled triangle → Live silent; after 4 s idle the legacy image overlay runs in Feedback/Suggest/Solve exactly as before; "Draw help" forces it; with Live off the 2 s trigger is back.
11. Press `m`, click the canvas → typed math shape; toolbar shows the Math tool.
12. Unauthenticated `curl` to any route → 401; sign out in another tab → next live call shows the "Please sign in again" toast and redirects.
13. 10-minute annoyance session: a page of mixed notes and algebra in Feedback → zero hint cards, zero image generations unless requested.
14. Mobile viewport 400 px: pill and toggle visible, hint card clamped inside the viewport.
15. Voice (when a valid `OPENAI_API_KEY` exists): "what did I write?" answers from `read_live_math` without an image round-trip; "plot it" creates a graph shape.
