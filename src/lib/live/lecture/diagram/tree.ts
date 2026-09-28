import type { Rect } from "../../contracts";
import type { DiagramSpec } from "../contracts";
import type { LectureSketch } from "../chart/sketch";
import { measureWords, type WordsLayout } from "../words";
import { DIAGRAM, boxNode, drawDiagram, fitAll, nodeSize, roomUnder, sizesAt, type Item } from "./layout";

/**
 * A tree as a teacher draws one, top down: the root in its box, a line down to each child in a row
 * under it, and under each child its own children. When there are too many leaves for a row of
 * boxes, each child's children are listed down the page under it instead — a line down from the
 * child with a short branch to each — the way an outline or a classification is written; when the
 * children are too many for a row, the tree lies on its side (root on the left).
 *
 * Inks: the root violet, its children orange, theirs green (in boxes) or the tutor's (listed).
 *
 * LIVE. Adding a leaf to a listed child adds its branch and its words, nothing else moves unless
 * the child's column must widen; adding a child re-lays the row. Parts: "node:root", "node:<i>",
 * "node:<i>.<j>" (each with ":text"), "link:<i>", "link:<i>.<j>", "trunk", "bar", "drop:<i>",
 * "rail:<i>", "branch:<i>.<j>", "leaf:<i>.<j>".
 */

export type TreeDiagram = Extract<DiagramSpec, { kind: "tree" }>;

export const TREE = {
  /** between two boxes of a row, and between the rows */
  gap: { x: 16, y: 40 },
  /** the widths tried for a node's words, widest first */
  textW: [150, 124, 104, 88, 72],
  rootW: 220,
  /** listed children: the rail's indent under its parent, the branch, the words' distance from it, between items */
  list: { indent: 16, branch: 18, words: 8, gap: 9, top: 12 },
  /** sideways: the widths of the root's and a child's words, between the columns, between leaves and groups */
  side: { rootW: 150, kidW: 140, gapX: 40, leafGap: 6, groupGap: 10 },
  ink: { root: "violet", child: "orange", grandchild: "green" },
} as const;

/** Leaves under a child (a child with no children is a leaf itself). */
function leafCount(c: TreeDiagram["children"][number]): number {
  return Math.max(1, c.children?.length ?? 0);
}

/** The layered tree: root, a row of children, a row of grandchildren, centred in the room. */
function layered(spec: TreeDiagram, k: number, textW: number, room: { w: number; h: number }): Item[] | null {
  const { node: size } = sizesAt(k);
  const G = TREE.gap;
  const root = fitAll([spec.root], size, TREE.rootW)?.[0];
  const kids = fitAll(
    spec.children.map((c) => c.text),
    size,
    textW,
  );
  if (!root || !kids) return null;
  const grand: WordsLayout[][] = [];
  for (const c of spec.children) {
    const g = fitAll(c.children ?? [], size, textW);
    if (!g) return null;
    grand.push(g);
  }
  const kidSize = kids.map(nodeSize);
  const grandSize = grand.map((g) => g.map(nodeSize));
  // each child's subtree is as wide as its box or its children's row, whichever is wider
  const subW = spec.children.map((_, i) => Math.max(kidSize[i].w, grandSize[i].reduce((a, s) => a + s.w, 0) + Math.max(0, grandSize[i].length - 1) * G.x));
  const total = subW.reduce((a, b) => a + b, 0) + (spec.children.length - 1) * G.x * 1.5;
  if (total > room.w) return null;
  const rootSize = nodeSize(root);
  const kidH = Math.max(...kidSize.map((s) => s.h));
  const grandH = Math.max(0, ...grandSize.flat().map((s) => s.h));
  const hasGrand = grandSize.some((g) => g.length > 0);
  const height = rootSize.h + G.y + kidH + (hasGrand ? G.y + grandH : 0);
  if (height > room.h) return null;

  const x0 = (room.w - total) / 2;
  const rootRect: Rect = { x: room.w / 2 - rootSize.w / 2, y: 0, w: rootSize.w, h: rootSize.h };
  const items: Item[] = [...boxNode(rootRect, root, "node:root", TREE.ink.root)];
  const kidY = rootSize.h + G.y;
  const grandY = kidY + kidH + G.y;
  let x = x0;
  const later: Item[] = [];
  spec.children.forEach((_, i) => {
    const s = kidSize[i];
    const r: Rect = { x: x + (subW[i] - s.w) / 2, y: kidY + (kidH - s.h) / 2, w: s.w, h: s.h };
    items.push({ t: "line", pts: [{ x: rootRect.x + rootRect.w / 2, y: rootRect.y + rootRect.h + 4 }, { x: r.x + r.w / 2, y: r.y - 4 }], part: `link:${i}` }, ...boxNode(r, kids[i], `node:${i}`, TREE.ink.child));
    const row = grandSize[i];
    const rowW = row.reduce((a, s2) => a + s2.w, 0) + Math.max(0, row.length - 1) * G.x;
    let gx = x + (subW[i] - rowW) / 2;
    row.forEach((s2, j) => {
      const gr: Rect = { x: gx, y: grandY + (grandH - s2.h) / 2, w: s2.w, h: s2.h };
      later.push({ t: "line", pts: [{ x: r.x + r.w / 2, y: r.y + r.h + 4 }, { x: gr.x + gr.w / 2, y: gr.y - 4 }], part: `link:${i}.${j}` }, ...boxNode(gr, grand[i][j], `node:${i}.${j}`, TREE.ink.grandchild));
      gx += s2.w + G.x;
    });
    x += subW[i] + G.x * 1.5;
  });
  // level by level: the children first, then theirs
  return [...items, ...later];
}

/** Children in a row of boxes, joined to the root by a bracket; each one's own children listed under it. */
function listed(spec: TreeDiagram, k: number, room: { w: number; h: number }): Item[] | null {
  const { node: size, small } = sizesAt(k);
  const G = TREE.gap;
  const L = TREE.list;
  const P = DIAGRAM.node.padX;
  const C = spec.children.length;
  const gaps = (C - 1) * G.x;
  const indent = L.indent + L.branch + L.words;
  // each column as wide as its writing wants; when that is too wide, as wide as its longest word
  // needs plus a share of what is left
  const widest = (t: string, sz: number, longestWord: boolean) => {
    const parts = longestWord ? t.split(/[\s]+|(?<=-)/) : [t];
    return Math.max(0, ...parts.map((p) => measureWords(p, sz)?.w ?? 0));
  };
  const natW = spec.children.map((c) => Math.max(widest(c.text, size, false) + 2 * P, ...(c.children ?? []).map((g) => widest(g, small, false) + indent)));
  const minW = spec.children.map((c) => Math.max(widest(c.text, size, true) + 2 * P, ...(c.children ?? []).map((g) => widest(g, small, true) + indent)));
  const spare = room.w - gaps - minW.reduce((a, b) => a + b, 0);
  if (spare < 0) return null;
  const want = natW.map((n, i) => n - minW[i]);
  const wantAll = want.reduce((a, b) => a + b, 0);
  const colW = wantAll <= spare ? natW : minW.map((m, i) => m + (spare * want[i]) / (wantAll || 1));

  const root = fitAll([spec.root], size, TREE.rootW)?.[0];
  if (!root) return null;
  const kids: WordsLayout[] = [];
  const lists: WordsLayout[][] = [];
  for (let i = 0; i < C; i++) {
    const kid = measureWords(spec.children[i].text, size, { maxWidth: colW[i] - 2 * P + 0.5, maxLines: DIAGRAM.node.maxLines, balance: true });
    if (!kid) return null;
    kids.push(kid);
    const out: WordsLayout[] = [];
    for (const t of spec.children[i].children ?? []) {
      const m = measureWords(t, small, { maxWidth: colW[i] - indent + 0.5, maxLines: 2, balance: true });
      if (!m) return null;
      out.push(m);
    }
    lists.push(out);
  }
  const rootSize = nodeSize(root);
  const kidSize = kids.map(nodeSize);
  const kidH = Math.max(...kidSize.map((s) => s.h));
  const listH = lists.map((l) => (l.length ? L.top + l.reduce((a, m) => a + m.h, 0) + (l.length - 1) * L.gap : 0));
  const height = rootSize.h + G.y + kidH + Math.max(...listH);
  if (height > room.h) return null;
  const total = colW.reduce((a, b) => a + b, 0) + gaps;
  const colX: number[] = [(room.w - total) / 2];
  for (let i = 1; i < C; i++) colX.push(colX[i - 1] + colW[i - 1] + G.x);
  const kidY = rootSize.h + G.y;
  const kidRects: Rect[] = kidSize.map((s, i) => ({ x: colX[i] + (colW[i] - s.w) / 2, y: kidY, w: s.w, h: kidH }));
  const centres = kidRects.map((r) => r.x + r.w / 2);
  // the root over the middle of its children
  const mid = (centres[0] + centres[C - 1]) / 2;
  const rootRect: Rect = { x: Math.max(0, Math.min(room.w - rootSize.w, mid - rootSize.w / 2)), y: 0, w: rootSize.w, h: rootSize.h };
  const items: Item[] = [...boxNode(rootRect, root, "node:root", TREE.ink.root)];
  // the bracket: down from the root, across over the children, down to each
  const barY = kidY - G.y / 2;
  const rootX = rootRect.x + rootRect.w / 2;
  if (C === 1) items.push({ t: "line", pts: [{ x: rootX, y: rootRect.y + rootRect.h + 4 }, { x: centres[0], y: kidY - 4 }], part: "link:0" });
  else {
    items.push({ t: "line", pts: [{ x: rootX, y: rootRect.y + rootRect.h + 4 }, { x: rootX, y: barY }], part: "trunk" });
    items.push({ t: "line", pts: [{ x: centres[0], y: barY }, { x: centres[C - 1], y: barY }], part: "bar" });
  }
  const later: Item[] = [];
  kidRects.forEach((r, i) => {
    if (C > 1) items.push({ t: "line", pts: [{ x: centres[i], y: barY }, { x: centres[i], y: r.y - 4 }], part: `drop:${i}` });
    items.push(...boxNode(r, kids[i], `node:${i}`, TREE.ink.child));
    const list = lists[i];
    if (!list.length) return;
    // the rail down from the child's box, a branch to each item
    const railX = Math.max(colX[i] + L.indent, r.x + 12);
    let y = r.y + r.h + L.top;
    const mids: number[] = [];
    for (const m of list) {
      mids.push(y + m.h / 2);
      y += m.h + L.gap;
    }
    later.push({ t: "line", pts: [{ x: railX, y: r.y + r.h + 3 }, { x: railX, y: mids[mids.length - 1] }], part: `rail:${i}` });
    list.forEach((m, j) => {
      later.push({ t: "line", pts: [{ x: railX, y: mids[j] }, { x: railX + L.branch, y: mids[j] }], part: `branch:${i}.${j}` });
      later.push({ t: "text", layout: m, at: { x: railX + L.branch + L.words, y: mids[j] }, align: "left", valign: "middle", part: `leaf:${i}.${j}` });
    });
  });
  return [...items, ...later];
}

/** Sideways, left to right: the root, its children in a column, each one's children fanned out beside it. */
function sideways(spec: TreeDiagram, k: number, room: { w: number; h: number }): Item[] | null {
  const { node: size, small } = sizesAt(k);
  const S = TREE.side;
  const root = fitAll([spec.root], size, S.rootW)?.[0];
  const kids = fitAll(
    spec.children.map((c) => c.text),
    size,
    S.kidW,
  );
  if (!root || !kids) return null;
  const rootSize = nodeSize(root);
  const kidSize = kids.map(nodeSize);
  const kidX = rootSize.w + S.gapX;
  const kidW = Math.max(...kidSize.map((s) => s.w));
  const leafX = kidX + kidW + S.gapX;
  const lists: WordsLayout[][] = [];
  for (const c of spec.children) {
    const out: WordsLayout[] = [];
    for (const t of c.children ?? []) {
      const m = measureWords(t, small, { maxWidth: room.w - leafX, maxLines: 2, balance: true });
      if (!m) return null;
      out.push(m);
    }
    lists.push(out);
  }
  const groupH = spec.children.map((_, i) => Math.max(kidSize[i].h, lists[i].reduce((a, m) => a + m.h, 0) + Math.max(0, lists[i].length - 1) * S.leafGap));
  const total = groupH.reduce((a, b) => a + b, 0) + (spec.children.length - 1) * S.groupGap;
  if (total > room.h) return null;
  const width = leafX + Math.max(0, ...lists.flat().map((m) => m.w));
  const x0 = (room.w - width) / 2;
  const rootRect: Rect = { x: x0, y: total / 2 - rootSize.h / 2, w: rootSize.w, h: rootSize.h };
  const items: Item[] = [...boxNode(rootRect, root, "node:root", TREE.ink.root)];
  const later: Item[] = [];
  let y = 0;
  spec.children.forEach((_, i) => {
    const cy = y + groupH[i] / 2;
    const r: Rect = { x: x0 + kidX + (kidW - kidSize[i].w) / 2, y: cy - kidSize[i].h / 2, w: kidSize[i].w, h: kidSize[i].h };
    items.push({ t: "line", pts: [{ x: rootRect.x + rootRect.w + 4, y: rootRect.y + rootRect.h / 2 }, { x: r.x - 4, y: cy }], part: `link:${i}` }, ...boxNode(r, kids[i], `node:${i}`, TREE.ink.child));
    const list = lists[i];
    const listH = list.reduce((a, m) => a + m.h, 0) + Math.max(0, list.length - 1) * S.leafGap;
    let ly = cy - listH / 2;
    list.forEach((m, j) => {
      const my = ly + m.h / 2;
      later.push({ t: "line", pts: [{ x: r.x + r.w + 4, y: cy }, { x: x0 + leafX - 6, y: my }], part: `branch:${i}.${j}` });
      later.push({ t: "text", layout: m, at: { x: x0 + leafX, y: my }, align: "left", valign: "middle", part: `leaf:${i}.${j}` });
      ly += m.h + S.leafGap;
    });
    y += groupH[i] + S.groupGap;
  });
  return [...items, ...later];
}

export function sketchTree(spec: TreeDiagram, box: { w: number; h: number }, seed: number): LectureSketch | null {
  if (spec.children.length < 1) return null;
  const leaves = spec.children.reduce((a, c) => a + leafCount(c), 0);
  for (const levels of [DIAGRAM.levels.slice(0, 3), DIAGRAM.levels.slice(3)]) {
    for (const k of levels) {
      const room = roomUnder(spec.title, box, k);
      if (!room) continue;
      // boxes all the way down while the leaves have room for them
      if (leaves <= 8) {
        for (const tw of TREE.textW) {
          const items = layered(spec, k, tw, room);
          const out = items ? drawDiagram(items, spec.title, box, k, seed, sizesAt(k).node, "content") : null;
          if (out) return out;
        }
      }
      for (const layout of [listed, sideways]) {
        const items = layout(spec, k, room);
        const out = items ? drawDiagram(items, spec.title, box, k, seed, sizesAt(k).node, "content") : null;
        if (out) return out;
      }
    }
  }
  return null;
}
