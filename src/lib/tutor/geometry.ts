import { CLUSTER_GAP_PX, CROP_PADDING_PX, type ClusterBounds } from "./types";

export function boxesNear(a: ClusterBounds, b: ClusterBounds, gap: number): boolean {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const separated =
    ax2 + gap < b.x || bx2 + gap < a.x || ay2 + gap < b.y || by2 + gap < a.y;
  return !separated;
}

export function expandCluster<Id extends string>(
  items: { id: Id; bounds: ClusterBounds }[],
  seedIds: Id[],
  gap = CLUSTER_GAP_PX,
): Id[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seeds = seedIds.filter((id) => byId.has(id));
  if (seeds.length === 0) return [];

  const included = new Set<Id>(seeds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items) {
      if (included.has(item.id)) continue;
      for (const id of included) {
        const other = byId.get(id);
        if (!other) continue;
        if (boxesNear(item.bounds, other.bounds, gap)) {
          included.add(item.id);
          grew = true;
          break;
        }
      }
    }
  }
  return [...included];
}

export function unionBounds(boxes: ClusterBounds[]): ClusterBounds | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, w: Math.max(8, maxX - minX), h: Math.max(8, maxY - minY) };
}

export function padBounds(bounds: ClusterBounds, padding = CROP_PADDING_PX): ClusterBounds {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    w: bounds.w + padding * 2,
    h: bounds.h + padding * 2,
  };
}
