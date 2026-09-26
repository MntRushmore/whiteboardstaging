import type { JsonObject, TLShape, TLShapeId } from "tldraw";

/**
 * Leftovers of the retired image pipeline on boards saved before it was removed.
 *
 * The app used to paint help as a full-canvas PNG ("AI overlays", stamped `meta.aiOverlay`):
 * feedback overlays stayed locked until "Clear feedback", suggest/answer overlays waited for
 * Accept/Reject. Nothing creates them any more and those controls are gone, so on load the
 * board tidies them up once: an undecided proposal is dropped (see below) and every overlay
 * that stays is unlocked, so the student can select and delete it like any other image.
 */

export type AiOverlayMode = "feedback" | "suggest" | "answer";

/** meta key every legacy AI overlay image carries */
const AI_OVERLAY_META_KEY = "aiOverlay";

/** intersected with JsonObject so it is assignable to tldraw's `meta` (index signature) */
export type AiOverlayMeta = JsonObject & {
  aiOverlay: true;
  mode: AiOverlayMode;
  /** set when the student accepted a suggest/answer overlay (it stays on the canvas) */
  accepted?: boolean;
};

/** The stamp the pipeline put on its overlays (kept to describe old boards, e.g. in tests). */
export function aiOverlayMeta(mode: AiOverlayMode): AiOverlayMeta {
  return { aiOverlay: true, mode };
}

export function isAiOverlayShape(shape: Pick<TLShape, "meta">): boolean {
  return shape.meta?.[AI_OVERLAY_META_KEY] === true;
}

export interface AiOverlayIds {
  /** full-opacity feedback overlays */
  feedback: TLShapeId[];
  /** suggest/answer overlays that were never accepted (oldest first) */
  pending: TLShapeId[];
}

const EMPTY_IDS: AiOverlayIds = { feedback: [], pending: [] };

/** pure: split overlay images into feedback overlays and undecided proposals */
export function partitionAiOverlays(shapes: Iterable<TLShape>): AiOverlayIds {
  const overlays: TLShape[] = [];
  for (const shape of shapes) {
    if (shape.type === "image" && isAiOverlayShape(shape)) overlays.push(shape);
  }
  if (overlays.length === 0) return EMPTY_IDS;
  // z-order == creation order for overlays, so "last" is the most recent one
  overlays.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
  const feedback: TLShapeId[] = [];
  const pending: TLShapeId[] = [];
  for (const shape of overlays) {
    const meta = shape.meta as Partial<AiOverlayMeta>;
    if (meta.mode === "feedback") feedback.push(shape.id);
    else if (meta.accepted !== true) pending.push(shape.id);
  }
  return { feedback, pending };
}

/** The slice of Editor the overlay readers need (keeps them drivable headless in tests). */
export interface OverlayReader {
  getCurrentPageShapeIds(): Iterable<TLShapeId>;
  getShape(id: TLShapeId): TLShape | undefined;
}

function overlayShapes(editor: OverlayReader): TLShape[] {
  const shapes: TLShape[] = [];
  for (const id of editor.getCurrentPageShapeIds()) {
    const shape = editor.getShape(id);
    if (shape && shape.type === "image" && isAiOverlayShape(shape)) shapes.push(shape);
  }
  return shapes;
}

/** OverlayReader plus the two writes `dropPendingAiOverlays` performs. */
export interface OverlayWriter extends OverlayReader {
  updateShapes(partials: Array<{ id: TLShapeId; type: "image"; isLocked?: boolean }>): unknown;
  deleteShapes(ids: TLShapeId[]): unknown;
}

/**
 * Call once, right after a board snapshot is loaded. Removes every overlay still waiting for
 * Accept/Reject and unlocks the overlays that stay. Returns the ids it removed.
 *
 * A suggest/answer overlay is a proposal about the moment it was made, not part of the
 * document: an undecided one reopens full-canvas over work the student has moved on from,
 * so it is dropped (the old Reject). Accepted and feedback overlays are the student's to
 * keep — but with Accept/Reject and "Clear feedback" gone, a LOCKED one could never be
 * removed again, so each is unlocked and becomes an ordinary image on the board.
 */
export function dropPendingAiOverlays(editor: OverlayWriter): TLShapeId[] {
  const shapes = overlayShapes(editor);
  if (shapes.length === 0) return [];
  const { pending } = partitionAiOverlays(shapes);
  // Locked shapes are neither deletable nor selectable: unlock first.
  const locked = shapes.filter((s) => s.isLocked).map((s) => s.id);
  if (locked.length > 0) editor.updateShapes(locked.map((id) => ({ id, type: "image" as const, isLocked: false })));
  if (pending.length > 0) editor.deleteShapes(pending);
  return pending;
}
