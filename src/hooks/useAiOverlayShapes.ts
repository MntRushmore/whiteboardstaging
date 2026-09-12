"use client";

import { useMemo } from "react";
import {
  computed,
  getIndexBetween,
  useValue,
  type Editor,
  type IndexKey,
  type JsonObject,
  type TLPageId,
  type TLParentId,
  type TLShape,
  type TLShapeId,
} from "tldraw";
import { isLiveMeta } from "@/lib/live/contracts";

/**
 * Bookkeeping for the legacy image pipeline's overlays ("AI overlays": the generated
 * annotation images). Every overlay is stamped with `meta.aiOverlay` so the Accept/Reject
 * and "Clear feedback" controls can be rebuilt from the store after a reload instead of
 * living only in React state.
 */

export type AiOverlayMode = "feedback" | "suggest" | "answer";

/** meta key every legacy AI overlay image carries */
export const AI_OVERLAY_META_KEY = "aiOverlay";

/** intersected with JsonObject so it is assignable to tldraw's `meta` (index signature) */
export type AiOverlayMeta = JsonObject & {
  aiOverlay: true;
  mode: AiOverlayMode;
  /** set when the student accepted a suggest/answer overlay (it stays on the canvas) */
  accepted?: boolean;
};

export function aiOverlayMeta(mode: AiOverlayMode): AiOverlayMeta {
  return { aiOverlay: true, mode };
}

export function isAiOverlayShape(shape: Pick<TLShape, "meta">): boolean {
  return shape.meta?.[AI_OVERLAY_META_KEY] === true;
}

export interface AiOverlayIds {
  /** full-opacity feedback overlays; removed together by "Clear feedback" */
  feedback: TLShapeId[];
  /** suggest/answer overlays still waiting for Accept/Reject (oldest first) */
  pending: TLShapeId[];
}

const EMPTY_IDS: AiOverlayIds = { feedback: [], pending: [] };

/** pure: split overlay images into "Clear feedback" targets and Accept/Reject candidates */
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

function sameIds(a: TLShapeId[], b: TLShapeId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function sameOverlayIds(a: AiOverlayIds, b: AiOverlayIds): boolean {
  return sameIds(a.feedback, b.feedback) && sameIds(a.pending, b.pending);
}

export function collectAiOverlays(editor: Editor): AiOverlayIds {
  const shapes: TLShape[] = [];
  for (const id of editor.getCurrentPageShapeIds()) {
    const shape = editor.getShape(id);
    if (shape) shapes.push(shape);
  }
  return partitionAiOverlays(shapes);
}

/**
 * Overlay ids derived reactively from the store, so they survive reload and undo. The
 * result keeps its identity while the id lists are unchanged (safe as a hook dependency).
 */
export function useAiOverlayShapes(editor: Editor): AiOverlayIds {
  const $ids = useMemo(
    () => computed("aiOverlays", () => collectAiOverlays(editor), { isEqual: sameOverlayIds }),
    [editor],
  );
  return useValue($ids);
}

/** the subset of Editor that overlayIndexBelowLive needs (keeps it testable headless) */
export interface ZOrderReader {
  getCurrentPageId(): TLPageId;
  getSortedChildIdsForParent(parent: TLParentId): readonly TLShapeId[];
  getShape(id: TLShapeId): TLShape | undefined;
}

/**
 * Index for a new overlay so it renders just BELOW every Live shape (echoes, graphs, AI
 * steps) on the current page. Returns undefined when the page has no Live shapes (the
 * overlay then takes the default top index).
 */
export function overlayIndexBelowLive(editor: ZOrderReader): IndexKey | undefined {
  const siblings: TLShape[] = [];
  for (const id of editor.getSortedChildIdsForParent(editor.getCurrentPageId())) {
    const shape = editor.getShape(id);
    if (shape) siblings.push(shape);
  }
  const lowestLive = siblings.findIndex((shape) => isLiveMeta(shape.meta));
  if (lowestLive < 0) return undefined;
  const below = lowestLive > 0 ? siblings[lowestLive - 1].index : undefined;
  return getIndexBetween(below, siblings[lowestLive].index);
}
