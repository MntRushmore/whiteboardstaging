/** tldraw VecModel, [x, y], or {X,Y}. Empty / NaN is a miss. */
export function readStrokePoint(value: unknown): { x: number; y: number } | null {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const rec = value as { x?: unknown; y?: unknown; X?: unknown; Y?: unknown };
  const x = Number(rec.x ?? rec.X);
  const y = Number(rec.y ?? rec.Y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}
