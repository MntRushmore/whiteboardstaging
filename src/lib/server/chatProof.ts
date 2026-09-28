import type { WriteProofAction } from "@/lib/live/chat/contracts";
import { checkProofProposal, type ProofCheckOptions, type ProofProposalVerdict } from "@/lib/live/chat/proof";

/**
 * The chat route's gate for a `write_proof` (POST /api/live/chat): the proof goes to the board only
 * when the engine's planner proves it with the figure's own geometry (`checkProofProposal`). One
 * that fails gets ONE repair round-trip with the engine's problems, when the request still has its
 * repair; still unproved, it is dropped (the route notes it and, when nothing else is left, refunds).
 *
 * `minRows` (a hard proof asked for) is a preference, not a reason to drop: a proof that is proved
 * but short earns the repair ("make it genuinely demanding"); if what comes back is still short, or
 * no better, the longest proof the engine proved goes on — a shorter proof beats none.
 *
 * What goes to the board is the checked proof in the reader's own forms (never the model's
 * phrasing: `AB ≅ CB` comes back `\overline{AB} \cong \overline{CB}`); the board checks it again
 * with the same function before its hand writes a stroke.
 */

export type ProofRepair = (problems: readonly string[]) => Promise<Pick<WriteProofAction, "figure" | "given" | "prove"> | null>;

export type ChatProofOutcome = { ok: true; action: WriteProofAction; rows: number; repaired: boolean } | { ok: false; reason: string; problems: string[]; repaired: boolean };

export const PROOF_NOT_WRITTEN = "I couldn't check that proof, so I didn't write it.";

export async function gateChatProof(action: WriteProofAction, repair: ProofRepair | null, opts: ProofCheckOptions = {}): Promise<ChatProofOutcome> {
  const accept = (a: WriteProofAction, v: Extract<ProofProposalVerdict, { ok: true }>, repaired: boolean): ChatProofOutcome => ({
    ok: true,
    action: { type: "write_proof", figure: a.figure, given: v.proof.given, prove: v.proof.prove, worked: a.worked },
    rows: v.proof.rows.length,
    repaired,
  });
  const candidates: WriteProofAction[] = [action];
  let verdict = checkProofProposal(action, opts);
  if (verdict.ok) return accept(action, verdict, false);
  let repaired = false;
  if (repair) {
    repaired = true;
    const fixed = await repair(verdict.problems).catch(() => null);
    if (fixed) {
      const next: WriteProofAction = { ...action, figure: fixed.figure, given: fixed.given, prove: fixed.prove };
      candidates.unshift(next);
      verdict = checkProofProposal(next, opts);
      if (verdict.ok) return accept(next, verdict, true);
    }
  }
  // short of the rows asked for, still proved: the longest one
  if (opts.minRows) {
    let best: { a: WriteProofAction; v: Extract<ProofProposalVerdict, { ok: true }> } | null = null;
    for (const a of candidates) {
      const v = checkProofProposal(a, { ...opts, minRows: undefined });
      if (v.ok && (!best || v.proof.rows.length > best.v.proof.rows.length)) best = { a, v };
    }
    if (best) return accept(best.a, best.v, repaired);
  }
  return { ok: false, reason: verdict.problems.slice(0, 2).join("; ").slice(0, 160), problems: verdict.problems, repaired };
}
