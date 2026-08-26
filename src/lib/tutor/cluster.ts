import { Box, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { downsamplePoints, richTextToPlain } from "./normalize";
import { expandCluster, padBounds, unionBounds } from "./geometry";
import {
  CROP_MAX_EDGE,
  TUTOR_LAYER_META,
  type ClusterBounds,
  type StrokeSample,
} from "./types";

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
  const rec = value as { typeName?: string; type?: string };
  if (rec.typeName !== "shape") return null;
  return value as TLShape;
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

  const clusteredIds = expandCluster(items, uniqueSeeds);
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

  const strokes = clustered.flatMap((shape) => extractStrokes(editor, shape, bounds));

  return { shapeIds: clusteredIds, bounds, nearbyText, strokes };
}

function extractStrokes(
  editor: Editor,
  shape: TLShape,
  bounds: ClusterBounds,
): StrokeSample[] {
  if (shape.type !== "draw" && shape.type !== "highlight") return [];
  const props = shape.props as {
    segments?: { points?: { x: number; y: number }[] }[];
  };
  const transform = editor.getShapePageTransform(shape);
  const samples: StrokeSample[] = [];
  for (const segment of props.segments ?? []) {
    const points = (segment.points ?? [])
      .map((p) => {
        const page = transform.applyToPoint(p);
        return {
          x: bounds.w <= 0 ? 0 : (page.x - bounds.x) / bounds.w,
          y: bounds.h <= 0 ? 0 : (page.y - bounds.y) / bounds.h,
        };
      })
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (points.length >= 2) {
      samples.push({ points: downsamplePoints(points) });
    }
  }
  return samples;
}

export function collectAllStudentText(editor: Editor): string {
  return collectStudentInk(editor)
    .map(shapePlainText)
    .filter(Boolean)
    .join("\n");
}

export async function cropCluster(
  editor: Editor,
  shapeIds: TLShapeId[],
  bounds: ClusterBounds,
): Promise<string | null> {
  const padded = padBounds(bounds);
  const box = new Box(padded.x, padded.y, padded.w, padded.h);
  const longest = Math.max(padded.w, padded.h, 1);
  const scale = Math.min(2, CROP_MAX_EDGE / longest);

  const { blob } = await editor.toImage(shapeIds, {
    format: "png",
    bounds: box,
    background: true,
    scale,
    padding: 0,
  });
  if (!blob) return null;

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read crop"));
    reader.readAsDataURL(blob);
  });
}
