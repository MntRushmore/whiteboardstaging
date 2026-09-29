import type { JsonObject } from "tldraw";
import type { Rect } from "../contracts";
import type { HandPlan } from "../handwriting";
import type { ChatActionOutcome, TeachAction } from "./contracts";
import type { ChatHost } from "./desk";
import { checkTeach } from "./teach";
import { freeAreas, layoutClearOf, layoutTeach, TEACH_LAYOUT, teachArea, type TeachLayout, type TeachLayoutInput } from "./teachLayout";

/**
 * The board chat's hand for a worked solution (`teach`), loaded the first time one is written (a
 * dynamic import from `ChatDesk`: the board's first load does not carry it, nor the words planner,
 * nor the check).
 *
 * The maths is checked again here with the route's own check (`checkTeach`: every chain equal,
 * every value consistent, the answer the working's) — nothing unchecked is written — then laid out
 * (`layoutTeach`) on this screen when it is empty or has clear room beside what is there, else on a
 * new one, and written as a teacher writes it: the figure, then each step (its sentence, then its
 * maths) with a short pause between them, then the answer in its box. A solution too long for one
 * screen even at the smallest hand carries on on the next.
 *
 * The strokes carry `chatBlock: "teach"` (the figure's `chatBlock: "figure"`), the live meta of all
 * the tutor's ink (`source: "ai"`: never read as the student's, never marked). A sentence's lines
 * carry no LaTeX, so the board's picture of the screen (`ChatDesk.picture`) lists the tutor's maths
 * lines — what a follow-up ("how did we find that?") refers to — and not its words.
 */

/** What the desk lends the teach writer: its host and its helpers. */
export interface TeachWriterDesk {
  host: ChatHost;
  screenEmpty(): boolean;
  /** adds a screen and waits for the loop to take it in; false at the cap */
  newScreen(): Promise<boolean>;
  waitForHand(): Promise<void>;
  writeBlock(plan: HandPlan, extraMeta: JsonObject): Promise<void>;
  /** still on the screen the reply started on */
  onScreen(): boolean;
  /** what is on this screen and must stay clear: its ink, and each problem's whole cell */
  obstacles(): Rect[];
}

export const TEACH_NOTES = {
  unchecked: "I couldn't check that working, so I didn't write it.",
  handOff: "The tutor's handwriting is switched off, so I can't write a worked solution.",
  noScreen: "This board already has the most screens it can hold.",
  noRoom: "The working didn't fit on the board.",
  moved: "I stopped because you moved to another screen.",
  noFigure: "I couldn't draw the figure, so I wrote the working without it.",
} as const;

/** meta `chatBlock` of a worked solution's writing */
export const TEACH_BLOCK = "teach";

/**
 * The solution on this screen, beside what is there, when it all fits clear of it in a hand no
 * smaller than `besideMinSize`; else null (a new screen). A screen that already holds a worked
 * solution gets no second one beside it: one solution, one screen.
 */
function layoutHere(desk: TeachWriterDesk, input: Omit<TeachLayoutInput, "area">): TeachLayout | null {
  const area = teachArea(desk.host.screen());
  if (desk.screenEmpty()) return layoutTeach({ ...input, area });
  const shapes = desk.host.shapes();
  if (shapes.some((s) => (s.meta as Record<string, unknown> | null)?.chatBlock === TEACH_BLOCK)) return null;
  const taken = desk.obstacles();
  for (const room of freeAreas(area, taken)) {
    const layout = layoutTeach({ ...input, area: room });
    if (layout && layout.rest === input.steps.length && (!input.answer || layout.answer) && layout.size >= TEACH_LAYOUT.besideMinSize && layoutClearOf(layout, taken)) return layout;
  }
  return null;
}

export async function writeTeach(desk: TeachWriterDesk, action: TeachAction): Promise<ChatActionOutcome> {
  const { host } = desk;
  const fail = (note: string): ChatActionOutcome => ({ type: "teach", ok: false, note });
  if (!host.handwriting()) return fail(TEACH_NOTES.handOff);
  const verdict = checkTeach(await host.engine(), action);
  if (!verdict.ok) {
    host.metric?.("live.chat.teach.dropped", { problems: verdict.problems.length });
    return fail(TEACH_NOTES.unchecked);
  }
  await desk.waitForHand();
  const steps = action.steps.map((s) => ({ say: s.say, math: s.math ?? [] }));
  const seed = host.seed(`chat:teach:${JSON.stringify(steps).slice(0, 400)}|${action.answer ?? ""}`);
  const spec = action.figure;
  const figure = spec
    ? (box: { w: number; h: number }) => {
        try {
          return host.planFigure(spec, { seed, box })?.plan ?? null;
        } catch {
          return null;
        }
      }
    : undefined;
  const input = { steps, answer: action.answer, figure, seed };
  let layout = layoutHere(desk, input);
  if (!layout) {
    if (!(await desk.newScreen())) return fail(TEACH_NOTES.noScreen);
    layout = layoutTeach({ ...input, area: teachArea(host.screen()) });
  }
  if (!layout) return fail(TEACH_NOTES.noRoom);
  const noFigure = Boolean(spec) && !layout.figure;
  let done = 0;
  let screens = 1;
  for (;;) {
    const blocks: Array<[HandPlan, JsonObject]> = [];
    if (layout.figure) blocks.push([layout.figure, { chatBlock: "figure" }]);
    for (const s of layout.steps) blocks.push([s, { chatBlock: TEACH_BLOCK }]);
    if (layout.answer) blocks.push([layout.answer, { chatBlock: TEACH_BLOCK }]);
    for (let k = 0; k < blocks.length; k++) {
      if (!desk.onScreen()) return fail(TEACH_NOTES.moved);
      // a moment between steps, as a teacher looks back at the board before the next line
      if (k > 0) await host.delay(TEACH_LAYOUT.stepPauseMs);
      if (!desk.onScreen()) return fail(TEACH_NOTES.moved);
      await desk.writeBlock(blocks[k][0], blocks[k][1]);
    }
    done += layout.rest;
    if (done >= steps.length) break;
    // the rest of a long solution on the next screen
    if (!(await desk.newScreen())) return fail(TEACH_NOTES.noScreen);
    screens++;
    const next = layoutTeach({ steps: steps.slice(done), answer: action.answer, seed: seed + done, area: teachArea(host.screen()) });
    if (!next) return fail(TEACH_NOTES.noRoom);
    layout = next;
  }
  host.metric?.("live.chat.teach", { steps: steps.length, screens, size: layout.size, figure: Boolean(spec) && !noFigure, checked: verdict.checked });
  return { type: "teach", ok: true, ...(noFigure ? { note: TEACH_NOTES.noFigure } : {}) };
}
