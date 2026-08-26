import {
  CLUSTER_GAP_PX,
  CROP_PADDING_PX,
  WRITE_LINE_X_GAP_PX,
  WRITE_LINE_Y_PAD_PX,
  type ClusterBounds,
} from "./types";

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

/** If listen seeds vanished, take the newest ink on the page as the last cluster. */
export function expandClusterOrLatest<Id extends string>(
  items: { id: Id; bounds: ClusterBounds }[],
  seedIds: Id[],
  gap = CLUSTER_GAP_PX,
): Id[] {
  const clustered = expandCluster(items, seedIds, gap);
  if (clustered.length > 0) return clustered;
  const newest = items.at(-1);
  if (!newest) return [];
  return expandCluster(items, [newest.id], gap);
}

/** Horizontal write line — not a leftover stroke on another baseline. */
export function boxesOnWriteLine(a: ClusterBounds, b: ClusterBounds): boolean {
  const vSeparated =
    a.y + a.h + WRITE_LINE_Y_PAD_PX < b.y || b.y + b.h + WRITE_LINE_Y_PAD_PX < a.y;
  if (vSeparated) return false;
  const hGap = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
  return hGap <= WRITE_LINE_X_GAP_PX;
}

export function expandWriteLine<Id extends string>(
  items: { id: Id; bounds: ClusterBounds }[],
  seedIds: Id[],
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
        if (boxesOnWriteLine(item.bounds, other.bounds)) {
          included.add(item.id);
          grew = true;
          break;
        }
      }
    }
  }
  return [...included];
}

/** Newest stroke first. Each group is one horizontal line of ink. */
export function partitionWriteLines<Id extends string>(
  items: { id: Id; bounds: ClusterBounds }[],
): Id[][] {
  const used = new Set<Id>();
  const lines: Id[][] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const seed = items[i];
    if (!seed || used.has(seed.id)) continue;
    const ids = expandWriteLine(items, [seed.id]);
    for (const id of ids) used.add(id);
    lines.push(ids);
  }
  return lines;
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
