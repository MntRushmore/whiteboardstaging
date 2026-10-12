/**
 * Ask's prompt (docs/ASK-V2.md, part "brain"). CONTRACT STUB: the brain part writes the real one
 * (a tutor's voice, any school subject in the panel, maths only on the board, Socratic, the
 * student's grade, the board block's action formats from `prompts/chat.ts`) and tunes it on
 * `npm run eval:ask`.
 */
import { ASK_BOARD_CLOSE, ASK_BOARD_OPEN, ASK_LIMITS, type AskRequestParsed } from "@/lib/live/ask/contracts";
import type { ChatMessage } from "@/lib/server/openrouter";
import type { AskLearnerContext } from "@/lib/server/ask/store";

export interface AskPromptContext {
  learner: AskLearnerContext;
}

/** The messages for one ask: system prompt, the turns so far, then this request (with the screen's picture when sent). */
export function buildAskMessages(req: AskRequestParsed, _ctx: AskPromptContext): ChatMessage[] {
  const system = [
    "You are a friendly tutor for a school student, on their whiteboard.",
    `Answer in short paragraphs; write maths as $...$. To write on the board, end with ${ASK_BOARD_OPEN}{"actions":[...]}${ASK_BOARD_CLOSE}.`,
  ].join("\n");
  return [
    { role: "system", content: system },
    ...req.history.map((t) => ({ role: t.role === "user" ? ("user" as const) : ("assistant" as const), content: t.text })),
    { role: "user", content: req.message },
  ];
}

/** The reply as the panel keeps it: trimmed, capped at ASK_LIMITS.reply on a sentence end when it can be. */
export function cleanAskReply(text: string): string {
  const t = text.trim();
  if (t.length <= ASK_LIMITS.reply) return t;
  const cut = t.slice(0, ASK_LIMITS.reply);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > ASK_LIMITS.reply / 2 ? cut.slice(0, end + 1) : cut;
}
