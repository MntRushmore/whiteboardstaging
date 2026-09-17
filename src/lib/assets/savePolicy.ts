/**
 * Decide what the autosave loop should do with a serialized snapshot of a
 * given size. Pure; the byte budgets come from the shared contract so the
 * admin migration script and the client agree.
 *
 *   bytes <= soft                              -> save (ok)
 *   soft < bytes <= hard, no inline assets     -> save (warn: nothing left to offload)
 *   soft < bytes <= hard, inline, not running  -> offload-then-save (warn)
 *   soft < bytes <= hard, inline, running      -> save (warn: offload already in flight)
 *   bytes > hard, inline, not running          -> offload-then-save (error: must shrink first)
 *   bytes > hard otherwise                     -> refuse (error, user-facing message)
 */
import { SNAPSHOT_LIMITS } from "../../../scripts/lib/snapshotAssets.mjs";

export type SaveAction = "save" | "offload-then-save" | "refuse";
export type SaveLevel = "ok" | "warn" | "error";

export interface SaveDecisionInput {
  /** UTF-8 byte length of JSON.stringify(snapshot). */
  bytes: number;
  /** Number of asset records whose src is still a data: URL. */
  inlineAssets: number;
  /** True while offloadEditorAssets is already running for this board (default false). */
  offloadInFlight?: boolean;
}

export interface SaveDecision {
  action: SaveAction;
  /** Diagnostic text; for `refuse` this is the user-facing message. */
  reason: string;
  level: SaveLevel;
}

export const SNAPSHOT_TOO_LARGE_MESSAGE = "This board is too large to save. Remove some images.";

const kb = (n: number) => `${Math.round(n / 1024)} KB`;

export function decideSave(input: SaveDecisionInput): SaveDecision {
  const bytes = Number.isFinite(input.bytes) && input.bytes > 0 ? input.bytes : 0;
  const inlineAssets = Number.isFinite(input.inlineAssets) && input.inlineAssets > 0 ? Math.floor(input.inlineAssets) : 0;
  const offloadInFlight = input.offloadInFlight === true;
  const { softBytes, hardBytes } = SNAPSHOT_LIMITS;

  if (bytes <= softBytes) {
    return { action: "save", level: "ok", reason: `Snapshot ${kb(bytes)} is within the ${kb(softBytes)} soft limit.` };
  }

  const canOffload = inlineAssets > 0 && !offloadInFlight;

  if (bytes > hardBytes) {
    if (canOffload) {
      return {
        action: "offload-then-save",
        level: "error",
        reason: `Snapshot ${kb(bytes)} exceeds the ${kb(hardBytes)} hard limit; offloading ${inlineAssets} inline image(s) before saving.`,
      };
    }
    return { action: "refuse", level: "error", reason: SNAPSHOT_TOO_LARGE_MESSAGE };
  }

  if (canOffload) {
    return {
      action: "offload-then-save",
      level: "warn",
      reason: `Snapshot ${kb(bytes)} exceeds the ${kb(softBytes)} soft limit; offloading ${inlineAssets} inline image(s).`,
    };
  }
  if (inlineAssets > 0) {
    return {
      action: "save",
      level: "warn",
      reason: `Snapshot ${kb(bytes)} exceeds the soft limit; an asset offload is already in flight.`,
    };
  }
  return {
    action: "save",
    level: "warn",
    reason: `Snapshot ${kb(bytes)} exceeds the soft limit and has no inline images left to offload.`,
  };
}
