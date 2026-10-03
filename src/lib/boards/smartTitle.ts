/**
 * Smart board names: "Solving trig equations" instead of "2 sin x = 1".
 *
 * The board page sends the maths on the board (the chat's problems, then the student's lines, as
 * LaTeX in reading order) to POST /api/live/title, a small fast model names what the board is
 * about in a few plain words, and the page writes that name over a title the namer may replace
 * (`replaceableTitles`): the default, its own earlier names this session, and the first-line
 * names the old namer and the welcome wrote. A name the student typed is never replaced. Free to
 * the student: a fraction of a cent, so no ink, a rate limit instead.
 *
 * Pure: no React, no network. Shared by the route and the page; tested in
 * `__tests__/smartTitle.test.ts`.
 */
import { z } from "zod";
import { boardTitleFromLatex, DEFAULT_BOARD_TITLE, type TitleLine } from "@/lib/boards/boardTitle";

export const TITLE_PATH = "/api/live/title";

/** Longest smart name: a board card shows about 40 characters. */
export const MAX_SMART_TITLE_LENGTH = 40;
/** Lines sent to the namer: what a board is about is in its first lines. */
export const MAX_TITLE_LINES = 12;
const MAX_LINE_LENGTH = 400;

export const TitleRequestSchema = z.object({
  boardId: z.string().min(1).max(64),
  /** the board's maths in reading order (`titleContent`), LaTeX */
  lines: z.array(z.string().min(1).max(MAX_LINE_LENGTH)).min(1).max(MAX_TITLE_LINES),
});
export type TitleRequest = z.input<typeof TitleRequestSchema>;

export const TitleResponseSchema = z.object({
  /** null when the model found nothing to name: the page keeps its first-line name */
  title: z.string().min(1).max(MAX_SMART_TITLE_LENGTH).nullable(),
  model: z.string().optional(),
  ms: z.number().optional(),
});
export type TitleResponse = z.infer<typeof TitleResponseSchema>;

/**
 * What the namer reads: each of the chat's problems on the screen (its lines), then the student's
 * lines in reading order (column, then row), LaTeX trimmed, duplicates dropped, cut to
 * `MAX_TITLE_LINES`. A problem comes first because it says what the board is for.
 */
export function titleContent(lines: readonly TitleLine[], problems: readonly (readonly string[])[] = []): string[] {
  const ordered = lines
    .filter((l) => l.latex && l.latex.trim())
    .slice()
    .sort((a, b) => a.column - b.column || a.row - b.row)
    .map((l) => l.latex);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const latex of [...problems.flat(), ...ordered]) {
    const line = latex.trim().slice(0, MAX_LINE_LENGTH);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= MAX_TITLE_LINES) break;
  }
  return out;
}

/**
 * Titles the namer may write over, besides the one it wrote itself this session: the default, and
 * any line's first-line name (`boardTitleFromLatex`) — what the old namer wrote and what the welcome
 * names a new student's first board. A student who typed exactly a line of their own maths as the
 * name would see it upgraded; a name in their own words never is.
 */
export function replaceableTitles(content: readonly string[], own: readonly string[] = []): string[] {
  const titles = new Set<string>([DEFAULT_BOARD_TITLE, ...own.filter(Boolean)]);
  for (const latex of content) {
    const t = boardTitleFromLatex(latex);
    if (t) titles.add(t);
  }
  return [...titles];
}

/**
 * The model's name as a board title: plain words, first letter capitalised, no quotes, no trailing
 * full stop. Null when it is not a usable name — LaTeX or maths symbols in it, too short, too long,
 * or no letters — so the board keeps its first-line name rather than show something odd.
 */
export function cleanSmartTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let t = raw
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .replace(/^["'“”‘’`*_]+|["'“”‘’`*_]+$/g, "")
    .replace(/[.!。]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/[\\$^_{}=<>]/.test(t)) return null;
  if (t.length < 3 || t.length > MAX_SMART_TITLE_LENGTH) return null;
  if (!/\p{L}{2,}/u.test(t)) return null;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

// ---------------------------------------------------------------------------
// When to name: one board session (`useBoardAutoTitle`)
// ---------------------------------------------------------------------------

/** Smart names asked for in one board session, at most: the first lines settle what a board is about. */
export const MAX_SMART_ASKS = 3;
/** Quiet time after the maths changes before a smart name is asked for. */
export const SMART_TITLE_DELAY_MS = 3_000;

export interface NamerState {
  /** names this session wrote, oldest first: the last is what we believe is stored */
  own: string[];
  /** the stored title was none we may replace (the student named the board): stop for good */
  stopped: boolean;
  /** a smart name landed: the first-line name no longer applies */
  smart: boolean;
  /** smart names asked for so far */
  asked: number;
  /** the content (`titleContent`, joined) the last smart name was asked for */
  askedFor: string | null;
  /** the screen the first smart name was asked on: another screen does not rename the board */
  page: string | null;
}

export const INITIAL_NAMER: NamerState = { own: [], stopped: false, smart: false, asked: 0, askedFor: null, page: null };

/** Ask for a smart name for this content on this screen? */
export function shouldAskSmart(state: NamerState, content: string, page: string | null): boolean {
  if (state.stopped || !content || state.asked >= MAX_SMART_ASKS) return false;
  if (state.page !== null && page !== state.page) return false;
  return content !== state.askedFor;
}

/** The ask is on its way: count it, and pin the screen. */
export function askedSmart(state: NamerState, content: string, page: string | null): NamerState {
  return { ...state, asked: state.asked + 1, askedFor: content, page: state.page ?? page };
}

/** The first-line name to write (the instant name, and the fallback when no smart name comes), or null. */
export function planFirstLine(state: NamerState, title: string | null | undefined): string | null {
  if (state.stopped || state.smart || !title) return null;
  return state.own.at(-1) === title ? null : title;
}

/** Write this smart name? Not when it is what we already wrote. */
export function planSmart(state: NamerState, title: string | null | undefined): string | null {
  if (state.stopped || !title) return null;
  return state.own.at(-1) === title ? null : title;
}

/** After `UPDATE … WHERE title IN (replaceable)`: `matched` = it changed the row. */
export function afterNameWrite(state: NamerState, title: string, matched: boolean, smart: boolean): NamerState {
  if (!matched) return { ...state, stopped: true };
  return { ...state, own: [...state.own, title], smart: state.smart || smart };
}
