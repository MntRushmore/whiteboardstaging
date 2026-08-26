import { withTremor, type Pt } from "./path";
import type { InkSegment } from "./compose";

export const DIAGRAM_KINDS = [
  "triangle",
  "parallel-transversal",
  "right-triangle",
  "similar-triangles",
] as const;
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];

export type DiagramInk = {
  x: number;
  y: number;
  segments: InkSegment[];
};

const ORIGIN = { x: 560, y: 150 };

function seg(points: Pt[], seed: number): InkSegment {
  return { type: "free", points: withTremor(points, seed, 0.4) };
}

function line(x1: number, y1: number, x2: number, y2: number, seed: number): InkSegment {
  const n = 8;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
  }
  return seg(pts, seed);
}

function arc(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  seed: number,
): InkSegment {
  const n = 14;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return seg(pts, seed);
}

function tick(x: number, y: number, dx: number, dy: number, seed: number): InkSegment {
  return line(x - dx, y - dy, x + dx, y + dy, seed);
}

function triangle(): InkSegment[] {
  const A = { x: 130, y: 12 };
  const B = { x: 18, y: 168 };
  const C = { x: 242, y: 168 };
  return [
    line(A.x, A.y, B.x, B.y, 91),
    line(B.x, B.y, C.x, C.y, 92),
    line(C.x, C.y, A.x, A.y, 93),
    arc(A.x, A.y, 22, Math.PI * 0.15, Math.PI * 0.85, 94),
    arc(B.x, B.y, 20, -Math.PI * 0.15, Math.PI * 0.42, 95),
  ];
}

function parallelTransversal(): InkSegment[] {
  return [
    line(10, 36, 260, 36, 101),
    line(10, 150, 260, 150, 102),
    tick(118, 36, 3, 9, 103),
    tick(128, 36, 3, 9, 104),
    tick(118, 150, 3, 9, 105),
    tick(128, 150, 3, 9, 106),
    line(70, 8, 210, 178, 107),
    arc(148, 150, 22, Math.PI * 1.05, Math.PI * 1.55, 108),
  ];
}

function rightTriangle(): InkSegment[] {
  const B = { x: 24, y: 168 };
  const C = { x: 216, y: 168 };
  const A = { x: 24, y: 36 };
  return [
    line(B.x, B.y, C.x, C.y, 111),
    line(C.x, C.y, A.x, A.y, 112),
    line(A.x, A.y, B.x, B.y, 113),
    line(B.x, B.y - 18, B.x + 18, B.y - 18, 114),
    line(B.x + 18, B.y - 18, B.x + 18, B.y, 115),
  ];
}

function similarTriangles(): InkSegment[] {
  const s = [
    { x: 16, y: 168 },
    { x: 96, y: 168 },
    { x: 40, y: 96 },
  ];
  const L = [
    { x: 140, y: 176 },
    { x: 260, y: 176 },
    { x: 176, y: 68 },
  ];
  return [
    line(s[0].x, s[0].y, s[1].x, s[1].y, 121),
    line(s[1].x, s[1].y, s[2].x, s[2].y, 122),
    line(s[2].x, s[2].y, s[0].x, s[0].y, 123),
    tick(56, 168, 2, 7, 124),
    line(L[0].x, L[0].y, L[1].x, L[1].y, 125),
    line(L[1].x, L[1].y, L[2].x, L[2].y, 126),
    line(L[2].x, L[2].y, L[0].x, L[0].y, 127),
    tick(186, 176, 2, 7, 128),
    tick(196, 176, 2, 7, 129),
  ];
}

export function composeDiagram(kind: DiagramKind): DiagramInk {
  const segments =
    kind === "triangle"
      ? triangle()
      : kind === "parallel-transversal"
        ? parallelTransversal()
        : kind === "right-triangle"
          ? rightTriangle()
          : similarTriangles();
  return { x: ORIGIN.x, y: ORIGIN.y, segments };
}
