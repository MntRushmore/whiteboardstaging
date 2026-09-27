/**
 * Reading one JSON object out of a model reply, the way the Live routes do: fences and prose
 * around it dropped (`extractJsonObject`), and LaTeX written with single backslashes inside the
 * strings repaired before `JSON.parse` (`repairJsonEscapes`, the JSONL path's repair — without
 * it `"\frac"` parses as a form feed followed by `rac`).
 */
import { extractJsonObject } from "@/lib/server/openrouter";
import { repairJsonEscapes } from "@/lib/server/sse";

export function parseModelJson(content: string): unknown {
  const text = extractJsonObject(content ?? "");
  if (!text.startsWith("{")) return null;
  try {
    return JSON.parse(repairJsonEscapes(text));
  } catch {
    return null;
  }
}
