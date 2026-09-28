import type { WriteProofAction } from "@/lib/live/chat/contracts";
import { checkProofProposal, type ProofCheckOptions } from "@/lib/live/chat/proof";

/**
 * The chat route's gate for a `write_proof` (POST /api/live/chat): the proof goes to the board only
 * when the engine's planner proves it with the figure's own geometry (`checkProofProposal`). One
 * that fails gets ONE repair round-trip with the engine's problems, when the request still has its
 * repair; still unproved, it is dropped (the route notes it and, when nothing else is left, refunds).
 *
 * What goes to the board is the checked proof in the reader's own forms (never the model's
 * phrasing: `AB ≅ CB` comes back `\overline{AB} \cong \overline{CB}`); the board checks it again
 * with the same function before its hand writes a stroke.
 */

export type ProofRepair = (problems: readonly string[]) => Promise<Pick<WriteProofAction, "figure" | "given" | "prove"> | null>;

export type ChatProofOutcome = { ok: true; action: WriteProofAction; repaired: boolean } | { ok: false; reason: string; repaired: boolean };

export const PROOF_NOT_WRITTEN = "I couldn't check that proof, so I didn't write it.";

export async function gateChatProof(action: WriteProofAction, repair: ProofRepair | null, opts: ProofCheckOptions = {}): Promise<ChatProofOutcome> {
  let current: WriteProofAction = action;
  let verdict = checkProofProposal(current, opts);
  let repaired = false;
  if (!verdict.ok && repair) {
    repaired = true;
    const fixed = await repair(verdict.problems).catch(() => null);
    if (fixed) {
      current = { ...action, figure: fixed.figure, given: fixed.given, prove: fixed.prove };
      verdict = checkProofProposal(current, opts);
    }
  }
  if (!verdict.ok) return { ok: false, reason: verdict.problems.slice(0, 2).join("; ").slice(0, 160), repaired };
  const proof = verdict.proof;
  return { ok: true, action: { type: "write_proof", figure: current.figure, given: proof.given, prove: proof.prove, worked: current.worked }, repaired };
}
