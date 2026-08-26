import { Box, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { downsamplePoints, richTextToPlain } from "./normalize";
import { expandClusterOrLatest, unionBounds } from "./geometry";
import { readStrokePoint } from "./strokes";
import { TUTOR_LAYER_META, type ClusterBounds, type StrokeSample } from "./types";

export { readStrokePoint } from "./strokes";

export function isTutorShape(shape: TLShape | undefined | null): boolean {
  if (!shape) return false;
  return (shape.meta as Record<string, unknown> | undefined)?.[TUTOR_LAYER_META] === true;
}

export function isProtectedShape(shape: TLShape | undefined | null): boolean {
  if (!shape) return false;
  return Boolean((shape.meta as Record<string, unknown> | undefined)?.isProtected);
}

export function isStudentInkShape(shape: TLShape | undefined | null): boolean {
  if (!shape || isTutorShape(shape) || isProtectedShape(shape)) return false;
  return (
    shape.type === "draw" ||
    shape.type === "highlight" ||
    shape.type === "text" ||
    shape.type === "note"
  );
}

export function isTriggerShape(shape: TLShape | undefined | null): boolean {
  if (!isStudentInkShape(shape)) return false;
  return (
    shape!.type === "draw" ||
    shape!.type === "highlight" ||
    shape!.type === "text" ||
    shape!.type === "note"
  );
}

export function shapePlainText(shape: TLShape): string {
  const props = shape.props as Record<string, unknown>;
  if (typeof props.text === "string" && props.text.trim()) return props.text.trim();
  return richTextToPlain(props.richText).trim();
}

function shapeRecord(value: unknown): TLShape | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as { typeName?: string; type?: string; id?: string };
  if (rec.typeName === "shape") return value as TLShape;
  // Some store diffs omit typeName. A draw/highlight/text id is still ink.
  if (typeof rec.id === "string" && rec.id.startsWith("shape:") && typeof rec.type === "string") {
    return value as TLShape;
  }
  return null;
}

export function strokeSamplesFromSegments(
  segments: unknown,
  applyPoint: (point: { x: number; y: number }) => { x: number; y: number } = (point) => point,
): StrokeSample[] {
  if (!Array.isArray(segments)) return [];
  const samples: StrokeSample[] = [];
  for (const segment of segments) {
    const rawPoints = (segment as { points?: unknown } | null)?.points;
    if (!Array.isArray(rawPoints)) continue;
    const points = rawPoints
      .map((point) => {
        const parsed = readStrokePoint(point);
        if (!parsed) return null;
        try {
          const page = applyPoint(parsed);
          if (!Number.isFinite(page.x) || !Number.isFinite(page.y)) return null;
          return { x: page.x, y: page.y };
        } catch {
          return parsed;
        }
      })
      .filter((point): point is { x: number; y: number } => Boolean(point));
    if (points.length === 1 && points[0]) {
      // A tap / i-dot / equals tick is still a stroke. Duplicate so Mathpix sees it.
      points.push({ x: points[0].x + 0.5, y: points[0].y });
    }
    if (points.length >= 2) {
      samples.push({ points: downsamplePoints(points) });
    }
  }
  return samples;
}

/** Newest student draw/highlight on this page — last stroke cluster seed. */
export function lastStudentClusterSeeds(editor: Editor): TLShapeId[] {
  const ink = collectStudentInk(editor).filter(
    (shape) => shape.type === "draw" || shape.type === "highlight",
  );
  if (ink.length === 0) return [];
  return [ink[ink.length - 1]!.id];
}

export function studentInkIdsFromDiff(changes: {
  added: Record<string, unknown>;
  updated: Record<string, [unknown, unknown]>;
  removed: Record<string, unknown>;
}): { addedOrUpdated: TLShapeId[]; onlyRemovals: boolean } {
  const addedOrUpdated: TLShapeId[] = [];

  for (const rec of Object.values(changes.added)) {
    const shape = shapeRecord(rec);
    if (shape && isTriggerShape(shape)) addedOrUpdated.push(shape.id);
  }
  for (const pair of Object.values(changes.updated)) {
    const shape = shapeRecord(pair?.[1]);
    if (shape && isTriggerShape(shape)) addedOrUpdated.push(shape.id);
  }

  const removedInk = Object.values(changes.removed).some((rec) => {
    const shape = shapeRecord(rec);
    return Boolean(shape && isStudentInkShape(shape));
  });

  return {
    addedOrUpdated,
    onlyRemovals: addedOrUpdated.length === 0 && removedInk,
  };
}

export function allChangesAreTutorLayer(changes: {
  added: Record<string, unknown>;
  updated: Record<string, [unknown, unknown]>;
  removed: Record<string, unknown>;
}): boolean {
  const records: unknown[] = [
    ...Object.values(changes.added),
    ...Object.values(changes.updated).map((pair) => pair?.[1]),
    ...Object.values(changes.removed),
  ];
  const shapes = records.map(shapeRecord).filter((s): s is TLShape => Boolean(s));
  if (shapes.length === 0) return false;
  return shapes.every(isTutorShape);
}

export function collectStudentInk(editor: Editor): TLShape[] {
  return editor.getCurrentPageShapes().filter(isStudentInkShape);
}

export function clusterFromSeeds(editor: Editor, seedIds: TLShapeId[]): {
  shapeIds: TLShapeId[];
  bounds: ClusterBounds;
  nearbyText: string;
  strokes: StrokeSample[];
} | null {
  const uniqueSeeds = [...new Set(seedIds)];
  if (uniqueSeeds.length === 0) return null;

  const ink = collectStudentInk(editor);
  const items = ink
    .map((shape) => {
      const box = editor.getShapePageBounds(shape);
      if (!box) return null;
      return {
        id: shape.id,
        bounds: { x: box.x, y: box.y, w: box.w, h: box.h },
      };
    })
    .filter((item): item is { id: TLShapeId; bounds: ClusterBounds } => Boolean(item));

  // Stale listen ids (remount / missing bounds) still tutor the last ink on the page.
  const clusteredIds = expandClusterOrLatest(items, uniqueSeeds);
  if (clusteredIds.length === 0) return null;

  const clustered = clusteredIds
    .map((id) => editor.getShape(id))
    .filter((s): s is TLShape => Boolean(s));

  const bounds = unionBounds(
    clustered
      .map((shape) => editor.getShapePageBounds(shape))
      .filter((b): b is Box => Boolean(b))
      .map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })),
  );
  if (!bounds) return null;

  const nearbyText = clustered
    .map(shapePlainText)
    .filter(Boolean)
    .join("\n");

  const strokes = clustered.flatMap((shape) => extractStrokes(editor, shape));

  return { shapeIds: clusteredIds, bounds, nearbyText, strokes };
}

function extractStrokes(editor: Editor, shape: TLShape): StrokeSample[] {
  if (shape.type !== "draw" && shape.type !== "highlight") return [];
  const props = shape.props as { segments?: unknown };
  const transform = editor.getShapePageTransform(shape);
  return strokeSamplesFromSegments(props.segments, (point) => {
    const page = transform?.applyToPoint?.(point);
    if (page && Number.isFinite(page.x) && Number.isFinite(page.y)) {
      return { x: page.x, y: page.y };
    }
    return point;
  });
}

export function collectAllStudentText(editor: Editor): string {
  return collectStudentInk(editor)
    .map(shapePlainText)
    .filter(Boolean)
    .join("\n");
}
