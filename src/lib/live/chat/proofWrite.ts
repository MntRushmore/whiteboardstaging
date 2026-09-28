import type { JsonObject } from "tldraw";
import type { HandPlan } from "../handwriting";
import { PROOF_ROWS_META } from "../proof/place";
import { encodeFigureRead, PROOF_FIGURE_META, PROOF_TABLE_META } from "../proof/tutorFigure";
import type { ChatActionOutcome, WriteProofAction } from "./contracts";
import type { ChatHost } from "./desk";
import { checkProofProposal } from "./proof";
import { layoutProof } from "./proofLayout";

/**
 * The board chat's hand for a two-column proof (`write_proof`), loaded the first time one is
 * written (a dynamic import from `ChatDesk`: the board's first load does not carry it).
 *
 * The proof is checked again here with the route's own check (`checkProofProposal`: the planner
 * proves it with the figure's geometry) — nothing unproved is written — then laid out
 * (`layoutProof`) on this screen when it is empty, else on a new one, and written in four blocks, as
 * a teacher would: the figure, `Given:` / `Prove:`, the table's rules, then the header and (a
 * worked proof) every row. The strokes carry what the proof desk needs to know the proof again
 * (`proof/tutorFigure.ts`): the figure's read, the table's rules, the rows.
 */

/** What the desk lends the proof writer: its host and its helpers. */
export interface ProofWriterDesk {
  host: ChatHost;
  screenEmpty(): boolean;
  /** adds a screen and waits for the loop to take it in; false at the cap */
  newScreen(): Promise<boolean>;
  waitForHand(): Promise<void>;
  writeBlock(plan: HandPlan, extraMeta: JsonObject): Promise<void>;
  /** still on the screen the reply started on */
  onScreen(): boolean;
}

export const PROOF_NOTES = {
  unchecked: "I couldn't check that proof, so I didn't write it.",
  handOff: "The tutor's handwriting is switched off, so I can't write a proof.",
  noScreen: "This board already has the most screens it can hold.",
  noRoom: "The proof didn't fit on the board.",
  moved: "I stopped because you moved to another screen.",
} as const;

export async function writeProof(desk: ProofWriterDesk, action: WriteProofAction): Promise<ChatActionOutcome> {
  const { host } = desk;
  const fail = (note: string): ChatActionOutcome => ({ type: "write_proof", ok: false, note });
  if (!host.handwriting()) return fail(PROOF_NOTES.handOff);
  const verdict = checkProofProposal(action);
  if (!verdict.ok) {
    host.metric?.("live.chat.proof.dropped", { problems: verdict.problems.length });
    return fail(PROOF_NOTES.unchecked);
  }
  const proof = verdict.proof;
  await desk.waitForHand();
  // a screen with anything on it keeps its work: the proof goes on a fresh one
  if (!desk.screenEmpty() && !(await desk.newScreen())) return fail(PROOF_NOTES.noScreen);
  const seed = host.seed(`chat:proof:${proof.given.join(";")}|${proof.prove}`);
  const layout = layoutProof({
    screen: host.screen(),
    given: proof.given,
    prove: proof.prove,
    rows: proof.worked ? proof.rows.map((r) => ({ statement: r.statement, reasonLatex: r.reasonLatex })) : null,
    figure: (box) => {
      try {
        return host.planFigure(action.figure, { seed, box })?.plan ?? null;
      } catch {
        return null;
      }
    },
    seed,
  });
  if (!layout) return fail(PROOF_NOTES.noRoom);
  const rows = proof.worked ? proof.rows.map((r) => ({ s: r.statement, r: r.reasonLatex })) : [];
  const blocks: Array<[HandPlan, JsonObject]> = [
    [layout.figure, { chatBlock: "figure", [PROOF_FIGURE_META]: encodeFigureRead(proof.figure) }],
    [layout.statements, { chatBlock: "proof", [PROOF_ROWS_META]: JSON.stringify({ given: proof.given, prove: proof.prove }) }],
    [layout.table, { chatBlock: "proof", [PROOF_TABLE_META]: "rules" }],
    [layout.body, { chatBlock: "proof", [PROOF_ROWS_META]: JSON.stringify(rows) }],
  ];
  for (const [plan, meta] of blocks) {
    if (!desk.onScreen()) return fail(PROOF_NOTES.moved);
    await desk.writeBlock(plan, meta);
  }
  host.metric?.("live.chat.proof", { worked: proof.worked, rows: proof.rows.length, size: layout.size });
  return { type: "write_proof", ok: true };
}
