/**
 * CHECK BEFORE SHOW (v1.0 reliability, 2026-11-19). The painter (Nano Banana 2 Lite) miscounts and
 * misshades: the 11-13 demo drew 38 as 2 rods and "= 85" with 6, and fraction bars shaded wrong 4 of 4
 * times. Before a picture goes to the kid, one cheap vision call looks at WHAT THE KID WILL SEE (the
 * board with the additions in tutor blue, ./kidView.ts — so a pale fill the iPad would show as nothing
 * fails here too) and holds it to the tutor's `checks` (./prompts.ts): each count, shading, label and
 * number. A failed check sends the painter back once with the specific corrections (./run.ts); a
 * second failure shows no picture (Solve writes its answer in the tutor's hand instead).
 *
 * Fails OPEN: a verifier that errors or runs out of time does not stop the picture (the run logs it as
 * `verify.error`), so the check can only ever remove wrong pictures, never the feature.
 */
import { openrouterChat, type OpenRouterChatResponse } from "@/lib/server/openrouter";
import { kidViewJpeg, kidViewRgb } from "./kidView";
import type { Rgb } from "./overlay";

/** The checker: fast and cheap, vision, on the zero-data-retention endpoints like every board call. */
export const VERIFY_MODEL = "google/gemini-3.1-flash-lite";
/** The check's own wait, ms (it usually answers in 1–2 s). */
export const VERIFY_TIMEOUT_MS = 6000;

export type VerifyMode = "feedback" | "suggest" | "answer";

export type VerifyItem = { check: string; seen: string; ok: boolean };
export type VerifyResult = {
  /** true: show it. A failed or timed-out check is `ok` with `error` set (fails open). */
  ok: boolean;
  /** what was wrong, one line each, said so the painter can fix it */
  problems: string[];
  items: VerifyItem[];
  ms: number;
  costUsd: number;
  error?: string;
};

/** The checks the server adds on its own: Suggest and Feedback never show the final answer. */
export function serverChecks(mode: VerifyMode, answer: string | undefined): string[] {
  if (mode === "answer" || !answer) return [];
  return [`the blue additions do NOT give away the final answer (${answer}); hints, arrows and the set-up are fine`];
}

export function verifyPrompt(instructions: string, checks: string[]): string {
  return [
    "This is a child's whiteboard. Their own writing is black. The tutor's NEW additions are BLUE (an older blue picture the child already kept may be there too).",
    `The tutor was asked to add: ${instructions}`,
    "Check what is ACTUALLY drawn in blue, not what was asked. For every item below: look at the blue drawing, COUNT one by one (rods, squares, dots, slices, equal parts, shaded parts, hops, boxes) and read every blue number, then say what you saw and whether the item holds.",
    "A part counts as shaded only when it is clearly filled or hatched in blue; a faint or empty part is not shaded.",
    ...checks.map((c, i) => `${i + 1}. ${c}`),
    `${checks.length + 1}. every blue number and sum is mathematically right, and nothing in blue is garbled, cut off or written over the child's writing`,
    'Reply with only JSON: {"items": [{"check": "1", "seen": "what you counted or read", "ok": true or false}, ...], "ok": true only when every item holds}',
  ].join("\n");
}

/** The checker's reply. Unreadable → null (the caller fails open). */
export function parseVerifyReply(text: string, checks: string[]): { ok: boolean; items: VerifyItem[]; problems: string[] } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const d = parsed as { items?: unknown; ok?: unknown };
  if (!Array.isArray(d.items) || typeof d.ok !== "boolean") return null;
  const items: VerifyItem[] = d.items
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x, i) => {
      const n = Number(String(x.check ?? i + 1).match(/\d+/)?.[0] ?? i + 1);
      const check = checks[n - 1] ?? (n === checks.length + 1 ? "the blue numbers and sums are right and legible" : String(x.check ?? ""));
      return { check, seen: typeof x.seen === "string" ? x.seen.slice(0, 200) : "", ok: x.ok === true };
    });
  const bad = items.filter((x) => !x.ok);
  // "ok" must agree with the items: a failed item fails the picture whatever the summary says
  const ok = d.ok === true && bad.length === 0;
  return { ok, items, problems: bad.map((x) => `${x.check} (you drew: ${x.seen || "something else"})`) };
}

/** What the second painting is told: what the first got wrong, and what it must show. */
export function correctionNote(problems: string[], checks: string[]): string {
  return [
    "Your last picture was WRONG. Paint it again from the original board and fix exactly this:",
    ...problems.slice(0, 6).map((p) => `- ${p}`),
    "The picture must show exactly:",
    ...checks.map((c) => `- ${c}`),
    "Count every rod, square, dot, slice and part as you draw it. Shade with close dark diagonal lines, never a pale fill.",
  ].join("\n");
}

function textOf(data: OpenRouterChatResponse): string {
  const raw = data.choices?.[0]?.message?.content;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map((p: { text?: unknown }) => (typeof p?.text === "string" ? p.text : "")).join("");
  return "";
}

export type VerifyInput = {
  board: Rgb;
  /** the overlay, W×H×4 straight alpha (what the done event carries) */
  overlayRgba: Uint8Array;
  instructions: string;
  checks: string[];
  mode: VerifyMode;
  signal: AbortSignal;
  requestId?: string;
  model?: string;
  /** for tests */
  chat?: typeof openrouterChat;
};

export async function verifyPicture(input: VerifyInput): Promise<VerifyResult> {
  const t0 = Date.now();
  const chat = input.chat ?? openrouterChat;
  const done = (r: Omit<VerifyResult, "ms">): VerifyResult => ({ ...r, ms: Date.now() - t0 });
  try {
    const view = await kidViewJpeg(kidViewRgb(input.board, input.overlayRgba), 1280);
    const data = await chat(
      {
        model: input.model ?? VERIFY_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: view } },
              { type: "text", text: verifyPrompt(input.instructions, input.checks) },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 800,
        reasoning: { effort: "minimal" },
        provider: { sort: "latency" },
        usage: { include: true },
      },
      { signal: AbortSignal.any([input.signal, AbortSignal.timeout(VERIFY_TIMEOUT_MS)]), requestId: input.requestId, title: "Agathon Board Draw - check" },
    );
    const cost = (data.usage as { cost?: unknown } | undefined)?.cost;
    const costUsd = typeof cost === "number" && Number.isFinite(cost) ? cost : 0;
    const read = parseVerifyReply(textOf(data), input.checks);
    if (!read) return done({ ok: true, problems: [], items: [], costUsd, error: "unreadable" });
    return done({ ok: read.ok, problems: read.problems, items: read.items, costUsd });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return done({ ok: true, problems: [], items: [], costUsd: 0, error: name === "TimeoutError" ? "timeout" : name === "AbortError" ? "aborted" : "upstream" });
  }
}
