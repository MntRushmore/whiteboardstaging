import type { TeachAction } from "@/lib/live/chat/contracts";
import { figureProblems } from "@/lib/live/chat/figure";
import { checkTeach, type TeachVerdict } from "@/lib/live/chat/teach";
import type { LiveEngine } from "@/lib/live/contracts";

/**
 * The chat route's gate for a `teach` (POST /api/live/chat): a worked solution goes to the board
 * only when the engine has checked every line of its maths (`checkTeach`: each chain equal, each
 * value consistent with the rest, the answer the working's) and the figure drawer draws its figure
 * true to what it says (`checkFigure`). One that fails gets ONE repair round-trip with every problem
 * found (the maths' and the figure's), when the request still has its repair.
 *
 *  - maths still failing: the teach is dropped (the route notes it and, when nothing else is left,
 *    refunds) — the board never gets unchecked maths;
 *  - maths holding but the figure still wrong: the solution goes on without its figure, with a note
 *    ("The figure couldn't be drawn.") — the working is what was asked for.
 *
 * The board checks the maths again with the same function before its hand writes a stroke.
 */

export type TeachRepair = (problems: readonly string[]) => Promise<Omit<TeachAction, "type"> | null>;

export type ChatTeachOutcome =
  | { ok: true; action: TeachAction; repaired: boolean; figureDropped: boolean; checked: number; answerValue: string | null }
  | { ok: false; reason: string; problems: string[]; repaired: boolean };

export const TEACH_NOT_WRITTEN = "I couldn't check that working, so I didn't write it.";

interface Judged {
  maths: TeachVerdict;
  figure: string[];
}

function judge(engine: LiveEngine, action: TeachAction): Judged {
  return { maths: checkTeach(engine, action), figure: action.figure ? figureProblems(action.figure) : [] };
}

/** Everything the engine and the drawer found, as the repair is told it. */
export function teachProblems(j: Judged): string[] {
  return [...(j.maths.ok ? [] : j.maths.problems), ...j.figure.map((p) => `The figure: ${p}`)];
}

export async function gateChatTeach(action: TeachAction, engine: LiveEngine, repair: TeachRepair | null): Promise<ChatTeachOutcome> {
  let current = action;
  let judged = judge(engine, action);
  let repaired = false;
  if ((!judged.maths.ok || judged.figure.length > 0) && repair) {
    repaired = true;
    const fixed = await repair(teachProblems(judged)).catch(() => null);
    if (fixed) {
      const next: TeachAction = { ...fixed, type: "teach" };
      const again = judge(engine, next);
      // the repair is taken when its maths holds — or when the first's did not either
      if (again.maths.ok || !judged.maths.ok) {
        current = next;
        judged = again;
      }
    }
  }
  if (!judged.maths.ok) return { ok: false, reason: judged.maths.problems.slice(0, 2).join("; ").slice(0, 160), problems: judged.maths.problems, repaired };
  const figureDropped = judged.figure.length > 0;
  const { figure: _dropped, ...rest } = current;
  void _dropped;
  return {
    ok: true,
    action: figureDropped ? rest : current,
    repaired,
    figureDropped,
    checked: judged.maths.checked,
    answerValue: judged.maths.answerValue,
  };
}
