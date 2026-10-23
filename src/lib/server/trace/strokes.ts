import { simplify, type Pt } from "@/lib/server/sketch/geometry";
import { dotSpiral } from "./dots";
import { blobs, degrees, pixelCentre, type Graph } from "./graph";

/**
 * The graph's edges → pen strokes, the way a person would draw them.
 *
 * PAIRING. At a crossing, the branches that carry on in the same direction are one stroke: each
 * branch leaves the node in a direction (measured just outside the node's ball, over a few line
 * widths), and pairs are taken greedily by the smallest turn, up to `maxTurn`. So a "+" is two
 * strokes, an "X" two, a "T" a bar and a stem. What is left over may still be one stroke round a
 * CORNER, up to `cornerTurn`: an arrowhead's two barbs are one "V", as a hand draws them, and the
 * shaft is its own line. A node with exactly two branches (what pruning leaves of a rectangle's
 * corner) always joins them. A branch left unpaired ends at the crossing's centre, on the line it
 * meets.
 *
 * JOINS. Inside a crossing's ball the skeleton is unreliable — it sags towards the stem of a "T"
 * and rounds the corner of an "L" — so each branch is cut where it leaves the ball and the pieces
 * are joined across it: straight on, directly; round a corner, at the APEX where the two
 * branches' own lines meet, so a rectangle's corners and an arrow's tip stay sharp instead of
 * being cut off or rounded.
 *
 * ENDS. A thinned line can stop a little short of where the ink does; a free end is carried on
 * along its own direction to a pen's half-width short of the ink's edge.
 *
 * CLOSED. A walk that comes back to its start (a ring of edges, or a loop with no node at all) is
 * a closed stroke; so is an open one whose ends meet within `closeGap`.
 */

export interface RawStroke {
  /** working-pixel points */
  pts: Pt[];
  /** indices into `pts` that are corners (the joins' apexes): smoothing keeps them sharp */
  corners: number[];
  closed: boolean;
  /** the padded skeleton pixels it was traced from (its colour is read along them) */
  px: number[];
  dot: boolean;
  /** points already final (a dot's spiral): not smoothed or simplified */
  fixed?: boolean;
}

export interface AssembleOptions {
  /** radians */
  maxTurn: number;
  cornerTurn: number;
  /** px over which a branch's direction is measured */
  look: number;
  /** px: an open stroke whose ends are this close is closed */
  closeGap: number;
  /** the drawing's typical line width, px */
  lineWidth: number;
  /** the padded ink (before thinning), its width and its radius, for the ends; the skeleton */
  ink: Uint8Array;
  skel: Uint8Array;
  /** padded: 1 inside a filled shape (outlined elsewhere: no dots found there) */
  solid?: Uint8Array;
  /** a dot's spiral: its pitch and least radius, working px */
  dotPitch: number;
  dotMin: number;
  W2: number;
  r: Float32Array;
}

interface Port {
  node: number;
  /** how many of the edge's points (from this end) lie inside the node's ball */
  trim: number;
  /** the first point outside the ball, and the direction away from the node */
  P: Pt;
  d: Pt;
}

const COS_STRAIGHT = Math.cos((20 * Math.PI) / 180);

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function assemble(g: Graph, o: AssembleOptions): RawStroke[] {
  const { W2 } = g;
  const deg = degrees(g);
  const E = g.edges.length;
  const pts: Pt[][] = g.edges.map((e) => (e.alive ? e.px.map((p) => pixelCentre(p, W2)) : []));
  const ports: Array<Port | null> = new Array(E * 2).fill(null);
  const portsAt = new Map<number, number[]>();

  for (let e = 0; e < E; e++) {
    const edge = g.edges[e];
    if (!edge.alive) continue;
    const q = pts[e];
    const n = q.length;
    for (const end of [0, 1] as const) {
      const node = end === 0 ? edge.a : edge.b;
      const N = g.nodes[node];
      const C: Pt = [N.x, N.y];
      const get = (i: number) => (end === 0 ? q[i] : q[n - 1 - i]);
      const trimR = deg[node] >= 2 ? N.core + 0.5 : 0;
      let k = 0;
      if (trimR > 0) while (k < n - 1 && dist(get(k), C) < trimR) k++;
      let k2 = k;
      let acc = 0;
      while (k2 < n - 1 && acc < o.look) {
        acc += dist(get(k2), get(k2 + 1));
        k2++;
      }
      let d: Pt = [get(k2)[0] - get(k)[0], get(k2)[1] - get(k)[1]];
      if (Math.hypot(d[0], d[1]) < 0.5) d = [get(n - 1)[0] - C[0], get(n - 1)[1] - C[1]];
      const len = Math.hypot(d[0], d[1]);
      d = len > 1e-9 ? [d[0] / len, d[1] / len] : [1, 0];
      const id = e * 2 + end;
      ports[id] = { node, trim: k, P: get(k), d };
      const list = portsAt.get(node) ?? [];
      list.push(id);
      portsAt.set(node, list);
    }
  }

  // ---- pairing
  const partner = new Int32Array(E * 2).fill(-1);
  for (const [node, list] of portsAt) {
    if (deg[node] < 2) continue;
    if (list.length === 2) {
      partner[list[0]] = list[1];
      partner[list[1]] = list[0];
      continue;
    }
    const pairs: Array<{ i: number; j: number; turn: number }> = [];
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const A = ports[list[a]]!;
        const B = ports[list[b]]!;
        const dot = A.d[0] * B.d[0] + A.d[1] * B.d[1];
        pairs.push({ i: list[a], j: list[b], turn: Math.acos(Math.max(-1, Math.min(1, -dot))) });
      }
    }
    pairs.sort((x, y) => x.turn - y.turn || x.i - y.i || x.j - y.j);
    for (const limit of [o.maxTurn, o.cornerTurn]) {
      for (const { i, j, turn } of pairs) {
        if (turn > limit) break;
        if (partner[i] >= 0 || partner[j] >= 0) continue;
        partner[i] = j;
        partner[j] = i;
      }
    }
  }

  // ---- walking
  const used = new Uint8Array(E);
  const out: RawStroke[] = [];

  const run = (stroke: Pt[], e: number, end: number) => {
    const q = pts[e];
    const n = q.length;
    const from = ports[e * 2 + end]!.trim;
    const to = n - 1 - ports[e * 2 + (1 - end)]!.trim;
    const get = (i: number) => (end === 0 ? q[i] : q[n - 1 - i]);
    const push = (p: Pt) => {
      const last = stroke[stroke.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) stroke.push(p);
    };
    if (from > to) push(get(Math.max(0, Math.min(n - 1, Math.round((from + to) / 2)))));
    else for (let i = from; i <= to; i++) push(get(i));
  };

  // an unpaired branch ends at the crossing's centre: on the line it meets (a "T"'s bar, an "m"'s stem)
  const touch = (p: Port): Pt | null => {
    const N = g.nodes[p.node];
    return dist([N.x, N.y], p.P) > 0.5 ? [N.x, N.y] : null;
  };

  const join = (stroke: Pt[], corners: number[], x: Port, q: Port) => {
    const cos = -(x.d[0] * q.d[0] + x.d[1] * q.d[1]);
    if (cos > COS_STRAIGHT) return;
    const N = g.nodes[x.node];
    const [ax, ay] = x.P;
    const [bx, by] = q.P;
    const [dax, day] = x.d;
    const [dbx, dby] = q.d;
    const det = -dax * dby + dbx * day;
    const reach = 2 * (N.core + 0.5) + 2;
    if (Math.abs(det) > 1e-6) {
      const s = (-(bx - ax) * dby + dbx * (by - ay)) / det;
      const t = (dax * (by - ay) - day * (bx - ax)) / det;
      if (s <= 0.5 && t <= 0.5 && s >= -reach && t >= -reach) {
        corners.push(stroke.length);
        stroke.push([ax + s * dax, ay + s * day]);
        return;
      }
    }
    const C: Pt = [N.x, N.y];
    if (dist(C, x.P) > 0.5 && dist(C, q.P) > 0.5) {
      corners.push(stroke.length);
      stroke.push(C);
    }
  };

  const walk = (start: number, cycle: boolean) => {
    const stroke: Pt[] = [];
    const corners: number[] = [];
    const px: number[] = [];
    const first = ports[start]!;
    if (!cycle && deg[first.node] >= 2) {
      const t = touch(first);
      if (t) stroke.push(t);
    }
    let cur = start;
    let closed = false;
    let last = first;
    for (let guard = 0; guard <= E; guard++) {
      const e = cur >> 1;
      used[e] = 1;
      run(stroke, e, cur & 1);
      for (const p of g.edges[e].px) px.push(p);
      const x = cur ^ 1;
      last = ports[x]!;
      const q = partner[x];
      if (q < 0) {
        if (deg[last.node] >= 2) {
          const t = touch(last);
          if (t) stroke.push(t);
        }
        break;
      }
      join(stroke, corners, last, ports[q]!);
      if (q === start) {
        closed = true;
        break;
      }
      cur = q;
    }
    let marks = corners;
    if (!closed) {
      if (deg[first.node] === 1 && extendEnd(stroke, true, o)) marks = corners.map((c) => c + 1);
      if (deg[last.node] === 1) extendEnd(stroke, false, o);
    }
    out.push(finishWalk(stroke, marks, closed, px, o.closeGap));
  };

  for (let p = 0; p < E * 2; p++) {
    const e = p >> 1;
    if (!g.edges[e].alive || used[e] || partner[p] >= 0) continue;
    walk(p, false);
  }
  for (let e = 0; e < E; e++) if (g.edges[e].alive && !used[e]) walk(e * 2, true);

  for (const loop of g.loops) out.push({ pts: loop.map((p) => pixelCentre(p, W2)), corners: [], closed: true, px: loop, dot: false });
  for (const p of g.dots) {
    const c = pixelCentre(p, W2);
    out.push({ pts: [c, c], corners: [], closed: false, px: [p], dot: true });
  }
  // filled dots on lines: a dot's spiral each; what the skeleton left wholly inside one goes
  const found = blobs(o.r, o.ink, o.skel, W2, o.lineWidth).filter((b) => !o.solid?.[(Math.floor(b.y) + 1) * W2 + Math.floor(b.x) + 1]);
  if (!found.length) return out;
  const kept = out.filter((s) => !found.some((b) => s.pts.every((q) => Math.hypot(q[0] - b.x, q[1] - b.y) <= b.r + 1)));
  for (const b of found) {
    const p = (Math.floor(b.y) + 1) * W2 + Math.floor(b.x) + 1;
    kept.push({ pts: dotSpiral(b.x, b.y, Math.max(b.r + 0.5, o.dotMin), o.dotPitch), corners: [], closed: false, px: [p], dot: false, fixed: true });
  }
  return kept;
}

/** Tidy a walk: drop repeated points, close it if its ends meet, flag a stroke that is only a dot. */
function finishWalk(stroke: Pt[], corners: number[], closed: boolean, px: number[], closeGap: number): RawStroke {
  let pts = stroke;
  if (!closed && pts.length >= 4) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
    if (dist(pts[0], pts[pts.length - 1]) <= closeGap && len > 4 * closeGap) {
      closed = true;
      if (dist(pts[0], pts[pts.length - 1]) < 0.75) pts = pts.slice(0, -1);
    }
  }
  if (closed && pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 0.25) pts = pts.slice(0, -1);
  if (closed && pts.length < 3) closed = false;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  const dot = len < 1;
  if (pts.length === 1) pts = [pts[0], pts[0]];
  return { pts, corners: corners.filter((i) => i < pts.length), closed: closed && !dot, px, dot };
}

/**
 * A free end carried on to where the ink ends, less a pen's half-width (a round pen drawn there
 * ends where the ink does). Only ever lengthens, by at most two widths.
 */
function extendEnd(stroke: Pt[], atStart: boolean, o: AssembleOptions): boolean {
  const n = stroke.length;
  if (n < 2) return false;
  const get = (i: number) => (atStart ? stroke[i] : stroke[n - 1 - i]);
  const E = get(0);
  let acc = 0;
  let i = 0;
  while (i < n - 1 && acc < o.look) {
    acc += dist(get(i), get(i + 1));
    i++;
  }
  const Q = get(i);
  const ux0 = E[0] - Q[0];
  const uy0 = E[1] - Q[1];
  const len = Math.hypot(ux0, uy0);
  if (len < 1) return false;
  const ux = ux0 / len;
  const uy = uy0 / len;
  const W2 = o.W2;
  const idx = (x: number, y: number) => (Math.floor(y) + 1) * W2 + Math.floor(x) + 1;
  const rq = Math.max(0.5, o.r[idx(Q[0], Q[1])] || o.r[idx(E[0], E[1])] || 0.5);
  let D = 0;
  for (let t = 0.5; t <= 3 * rq + 3; t += 0.5) {
    const x = E[0] + t * ux;
    const y = E[1] + t * uy;
    const p = idx(x, y);
    if (p < 0 || p >= o.ink.length || !o.ink[p]) break;
    D = t;
  }
  const shift = Math.min(D - rq, 2 * rq + 1);
  if (shift <= 0.75) return false;
  const p: Pt = [E[0] + shift * ux, E[1] + shift * uy];
  if (atStart) stroke.unshift(p);
  else stroke.push(p);
  return true;
}

// ------------------------------------------------------------------ finishing

/** Points where the line turns by more than ~55° over a few pixels, the sharpest of their neighbourhood. */
function pixelCorners(p: Pt[], closed: boolean, k: number): Uint8Array {
  const n = p.length;
  const turn = new Float32Array(n);
  const pin = new Uint8Array(n);
  if (n < 2 * k + 1) return pin;
  for (let i = 0; i < n; i++) {
    let a = i - k;
    let b = i + k;
    if (closed) {
      a = (a + n) % n;
      b %= n;
    } else if (a < 0 || b >= n) continue;
    const v1x = p[a][0] - p[i][0];
    const v1y = p[a][1] - p[i][1];
    const v2x = p[b][0] - p[i][0];
    const v2y = p[b][1] - p[i][1];
    const l = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    if (l < 1e-9) continue;
    turn[i] = Math.PI - Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / l)));
  }
  const min = (55 * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    if (turn[i] < min) continue;
    let best = true;
    for (let j = -k; j <= k && best; j++) {
      if (!j) continue;
      let q = i + j;
      if (closed) q = (q + n) % n;
      else if (q < 0 || q >= n) continue;
      if (turn[q] > turn[i] || (turn[q] === turn[i] && j < 0)) best = false;
    }
    if (best) pin[i] = 1;
  }
  return pin;
}

/**
 * Corners thinning cut off, put back. Thinning peels a thick band's corner from both sides, so
 * the centreline turns it with a short chamfer; after simplification that is a run of short
 * segments between two long ones. When the long ones turn by 35° or more and their lines meet
 * within a line width or two of the run, the run becomes that meeting point: the rectangle's
 * corner, the elbow of an "L", an arrow's tip. A curve's segments are all of a size, so it never
 * matches.
 */
export function sharpenCorners(input: Pt[], closed: boolean, width: number): Pt[] {
  let p = input;
  const short = Math.max(2.5, 1.2 * width);
  const long = 2.5 * short;
  const reach = 1.5 * width + 2;
  const minTurn = (35 * Math.PI) / 180;
  for (let pass = 0; pass < 2; pass++) {
    const n = p.length;
    if (n < (closed ? 4 : 4)) return p;
    const segs = closed ? n : n - 1;
    const len = (i: number) => dist(p[i % n], p[(i + 1) % n]);
    const drop = new Uint8Array(n);
    const replace = new Map<number, Pt>();
    for (let i = 0; i < segs; i++) {
      // a long segment i, then a run of short ones, then a long one
      if (len(i) < long) continue;
      let j = i + 1;
      while (j < i + 1 + 4 && (closed || j < segs) && len(j) < short) j++;
      if (j === i + 1 || (!closed && j >= segs) || len(j) < long || j - i > segs - 1) continue;
      const A = p[i % n];
      const B = p[(i + 1) % n];
      const C = p[j % n];
      const D = p[(j + 1) % n];
      const ux = B[0] - A[0];
      const uy = B[1] - A[1];
      const vx = D[0] - C[0];
      const vy = D[1] - C[1];
      const turn = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)))));
      if (turn < minTurn) continue;
      const det = ux * vy - uy * vx;
      if (Math.abs(det) < 1e-9) continue;
      const t = ((C[0] - A[0]) * vy - (C[1] - A[1]) * vx) / det;
      const X: Pt = [A[0] + t * ux, A[1] + t * uy];
      if (dist(X, B) > reach || dist(X, C) > reach) continue;
      // B becomes X; the run's other points go
      replace.set((i + 1) % n, X);
      for (let k = i + 2; k <= j; k++) drop[k % n] = 1;
    }
    if (!replace.size) return p;
    const out: Pt[] = [];
    for (let i = 0; i < n; i++) {
      if (drop[i] && !replace.has(i)) continue;
      out.push(replace.get(i) ?? p[i]);
    }
    p = out;
  }
  return p;
}

/**
 * The stroke's final points (working pixels): lightly smoothed (two passes of 1-2-1, corners and
 * open ends pinned, so a pixel staircase becomes a line and a rectangle stays a rectangle), then
 * Douglas–Peucker within `eps`, then corners sharpened (`sharpenCorners`). A closed stroke starts
 * at a corner when it has one, so the simplification never has to keep a point in the middle of a
 * side.
 */
export function finishStroke(s: RawStroke, eps: number, width = 3): Pt[] {
  if (s.dot) return [s.pts[0], s.pts[0]];
  if (s.fixed) return s.pts.map((q) => [q[0], q[1]] as Pt);
  let p = s.pts.map((q) => [q[0], q[1]] as Pt);
  const n = p.length;
  if (n <= 2) return p;
  const pin = pixelCorners(p, s.closed, 3);
  for (const c of s.corners) if (c >= 0 && c < n) pin[c] = 1;
  if (!s.closed) pin[0] = pin[n - 1] = 1;
  for (let pass = 0; pass < 2; pass++) {
    const q = p.map((v) => [v[0], v[1]] as Pt);
    for (let i = 0; i < n; i++) {
      if (pin[i]) continue;
      const a = s.closed ? p[(i - 1 + n) % n] : p[i - 1];
      const b = s.closed ? p[(i + 1) % n] : p[i + 1];
      q[i] = [(a[0] + 2 * p[i][0] + b[0]) / 4, (a[1] + 2 * p[i][1] + b[1]) / 4];
    }
    p = q;
  }
  if (!s.closed) return sharpenCorners(simplify(p, eps), false, width);
  let start = pin.indexOf(1);
  if (start < 0) {
    start = 0;
    for (let i = 1; i < n; i++) if (p[i][1] < p[start][1] - 1e-9 || (Math.abs(p[i][1] - p[start][1]) <= 1e-9 && p[i][0] < p[start][0])) start = i;
  }
  const ringPts = [...p.slice(start), ...p.slice(0, start)];
  // a ring simplified as one open line from its start back to it; the far side is split off first
  // so Douglas–Peucker has a chord to measure against
  let far = 1;
  for (let i = 1; i < ringPts.length; i++) if (dist(ringPts[i], ringPts[0]) > dist(ringPts[far], ringPts[0])) far = i;
  const a = simplify(ringPts.slice(0, far + 1), eps);
  const b = simplify([...ringPts.slice(far), ringPts[0]], eps);
  const out = sharpenCorners([...a, ...b.slice(1, -1)], true, width);
  return out.length >= 3 ? out : ringPts.slice(0, 3);
}
