import { ring } from "./raster";

/**
 * The skeleton as a graph a pen can follow.
 *
 * NODES. On an 8-thin skeleton a pixel with one neighbour is a line's END, with two it is the
 * middle of a line, with three or more it is part of a CROSSING; touching crossing pixels are one
 * node (a "+" thins to a little knot of them, not four junctions). Every node has a centre and a
 * radius: the ink's half-width there, so later steps can tell how big "near the crossing" is.
 *
 * EDGES are the pixel paths between nodes; a ring of middle pixels with no node at all (a circle,
 * an "o") is a LOOP; a lone pixel is a DOT.
 *
 * CLEANING. Thinning a real line leaves artefacts a pen never drew:
 * - two crossings a short BRIDGE apart, where two lines cross (thinning splits an X into two
 *   Y's): contracted into one node when the bridge is shorter than ¾ of their two ink radii;
 * - SPURS, short branches from a crossing to a free end where a thick line's corner or a bump on
 *   its edge was: pruned when the branch reaches past the edge of the lines it leaves by less
 *   than `spur` × their width. "The lines" are measured just outside the crossing (the median
 *   half-width of its branches there), not at the crossing itself, which is fat wherever strokes
 *   converge (an arrow's tip): a thick line's corner spur reaches only ~0.4 of a half-width past
 *   the edge, a bump its own height, while the crossbar of a small "t" or "f", an arrowhead's
 *   barb and a serif reach well past it and survive. A sharp corner's spur reaches further (to
 *   its mitre, R / sin(θ/2)), but it TAPERS like the wedge it runs into and leaves the corner
 *   outward, opposite the bisector of its two arms: a branch that does both and reaches under 6
 *   half-widths goes too (a tapering hand stroke — a tick, a barb — is never placed like that). A crossing whose
 *   branches are all spurs keeps its two longest (a tiny "+" is still a "+").
 * Both repeat until nothing changes: pruning can leave a new bridge, and contraction a new spur.
 */

export interface GNode {
  /** centre, working pixels (a pixel's centre is at +0.5) */
  x: number;
  y: number;
  /** the ink's radius at its pixels: the disc inside which the skeleton is unreliable */
  core: number;
  /** pixels it was made of (for weighting merges) */
  size: number;
  alive: boolean;
}

export interface GEdge {
  a: number;
  b: number;
  /** padded pixel indices from node a to node b, both ends' node pixels included */
  px: number[];
  len: number;
  alive: boolean;
}

export interface Graph {
  W2: number;
  /** the ink's radius at every padded pixel */
  r: Float32Array;
  nodes: GNode[];
  edges: GEdge[];
  /** closed rings of pixels with no node on them */
  loops: number[][];
  /** lone pixels */
  dots: number[];
}

const at = (p: number, W2: number): [number, number] => {
  const x = p % W2;
  return [x - 0.5, (p - x) / W2 - 0.5];
};

function pathLength(px: readonly number[], W2: number): number {
  let len = 0;
  for (let i = 1; i < px.length; i++) {
    const d = Math.abs(px[i] - px[i - 1]);
    len += d === 1 || d === W2 ? 1 : Math.SQRT2;
  }
  return len;
}

/** The skeleton's graph (`skel` is the padded thinned image, `list` its pixels in index order, `r` the ink radius). */
export function buildGraph(skel: Uint8Array, list: Int32Array, W2: number, r: Float32Array): Graph {
  const N = ring(W2);
  const size = skel.length;
  const deg = new Uint8Array(size);
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    let d = 0;
    for (let k = 0; k < 8; k++) if (skel[p + N[k]]) d++;
    deg[p] = d;
  }
  const nodeOf = new Int32Array(size).fill(-1);
  const nodes: GNode[] = [];
  const nodePx: number[][] = [];
  const dots: number[] = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (nodeOf[p] >= 0) continue;
    const d = deg[p];
    if (d === 2) continue;
    if (d === 0) {
      dots.push(p);
      continue;
    }
    const id = nodes.length;
    const px = [p];
    nodeOf[p] = id;
    if (d >= 3) {
      for (let k = 0; k < px.length; k++) {
        const q = px[k];
        for (let j = 0; j < 8; j++) {
          const t = q + N[j];
          if (skel[t] && deg[t] >= 3 && nodeOf[t] < 0) {
            nodeOf[t] = id;
            px.push(t);
          }
        }
      }
    }
    let sx = 0;
    let sy = 0;
    let rr = 0;
    for (const q of px) {
      const [x, y] = at(q, W2);
      sx += x;
      sy += y;
      rr = Math.max(rr, r[q]);
    }
    nodes.push({ x: sx / px.length, y: sy / px.length, core: Math.max(rr, 0.5), size: px.length, alive: true });
    nodePx.push(px);
  }

  const edges: GEdge[] = [];
  const visited = new Uint8Array(size);
  const addEdge = (a: number, b: number, px: number[]) => edges.push({ a, b, px, len: pathLength(px, W2), alive: true });
  for (let id = 0; id < nodes.length; id++) {
    for (const q of nodePx[id]) {
      for (let k = 0; k < 8; k++) {
        const t = q + N[k];
        if (!skel[t] || nodeOf[t] === id) continue;
        if (nodeOf[t] >= 0) {
          // two nodes touching: one edge, added from the lower pixel's side
          if (q < t) addEdge(id, nodeOf[t], [q, t]);
          continue;
        }
        if (visited[t]) continue;
        const px = [q, t];
        visited[t] = 1;
        let prev = q;
        let cur = t;
        let end = -1;
        for (let guard = 0; guard < size; guard++) {
          let next = -1;
          for (let j = 0; j < 8; j++) {
            const u = cur + N[j];
            if (skel[u] && u !== prev) {
              next = u;
              break;
            }
          }
          if (next < 0) break;
          px.push(next);
          if (nodeOf[next] >= 0) {
            end = nodeOf[next];
            break;
          }
          if (visited[next]) break;
          visited[next] = 1;
          prev = cur;
          cur = next;
        }
        if (end >= 0) addEdge(id, end, px);
      }
    }
  }

  const loops: number[][] = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (deg[p] !== 2 || nodeOf[p] >= 0 || visited[p]) continue;
    const px = [p];
    visited[p] = 1;
    let prev = p;
    let cur = -1;
    for (let j = 0; j < 8; j++) {
      if (skel[p + N[j]]) {
        cur = p + N[j];
        break;
      }
    }
    for (let guard = 0; cur >= 0 && cur !== p && guard < size; guard++) {
      if (visited[cur]) break;
      px.push(cur);
      visited[cur] = 1;
      let next = -1;
      for (let j = 0; j < 8; j++) {
        const u = cur + N[j];
        if (skel[u] && u !== prev) {
          next = u;
          break;
        }
      }
      prev = cur;
      cur = next;
    }
    if (px.length >= 3) loops.push(px);
  }
  return { W2, r, nodes, edges, loops, dots };
}

export function degrees(g: Graph): Int32Array {
  const deg = new Int32Array(g.nodes.length);
  for (const e of g.edges) {
    if (!e.alive) continue;
    deg[e.a]++;
    deg[e.b]++;
  }
  return deg;
}

/**
 * Crossings a short bridge apart → one node. How many bridges went. Shortest bridges first, and a
 * merge is refused when the knot it makes would reach past twice its lines' half-width: in a
 * sketchy, hatched corner every crossing is a bridge from the next, and merging them all would
 * swallow the corner into one node.
 */
export function contractBridges(g: Graph, bridge: number): number {
  const deg = degrees(g);
  const parent = Int32Array.from(g.nodes, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const members = new Map<number, number[]>();
  const candidates = g.edges
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.alive && e.a !== e.b && deg[e.a] >= 3 && deg[e.b] >= 3 && e.len <= bridge * (g.nodes[e.a].core + g.nodes[e.b].core) + 0.5)
    .sort((x, y) => x.e.len - y.e.len || x.i - y.i);
  let merged = 0;
  for (const { e } of candidates) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra === rb) {
      e.alive = false;
      merged++;
      continue;
    }
    const group = [...(members.get(ra) ?? [ra]), ...(members.get(rb) ?? [rb])];
    let sx = 0;
    let sy = 0;
    let n = 0;
    let core = 0;
    for (const m of group) {
      const nd = g.nodes[m];
      sx += nd.x * nd.size;
      sy += nd.y * nd.size;
      n += nd.size;
      core = Math.max(core, nd.core);
    }
    const cx = sx / n;
    const cy = sy / n;
    let reach = 0;
    for (const m of group) {
      const nd = g.nodes[m];
      reach = Math.max(reach, Math.hypot(nd.x - cx, nd.y - cy) + nd.core);
    }
    if (reach > 2 * core + 1.5) continue;
    const root = Math.min(ra, rb);
    parent[Math.max(ra, rb)] = root;
    members.delete(ra);
    members.delete(rb);
    members.set(root, group);
    e.alive = false;
    merged++;
  }
  if (!merged) return 0;
  for (const [root, group] of members) {
    if (group.length < 2) continue;
    let sx = 0;
    let sy = 0;
    let n = 0;
    let core = 0;
    for (const m of group) {
      const nd = g.nodes[m];
      sx += nd.x * nd.size;
      sy += nd.y * nd.size;
      n += nd.size;
      core = Math.max(core, nd.core);
    }
    for (const m of group) if (m !== root) g.nodes[m].alive = false;
    Object.assign(g.nodes[root], { x: sx / n, y: sy / n, core, size: n });
  }
  for (const e of g.edges) {
    if (!e.alive) continue;
    e.a = find(e.a);
    e.b = find(e.b);
  }
  return merged;
}

/**
 * A ring hardly longer than the width of the knot it hangs on is the knot's own artefact. Any
 * bigger ring is a real hole (thinning keeps holes, and pinholes were filled): the eye of an
 * "e", the bowl of an "a" — kept, however small the writing.
 */
function dropTinyLoops(g: Graph): number {
  let n = 0;
  for (const e of g.edges) {
    if (e.alive && e.a === e.b && e.len <= 2 * (g.nodes[e.a].core + 1)) {
      e.alive = false;
      n++;
    }
  }
  return n;
}

/**
 * The half-width of the lines at a node: the median ink radius along its branches just outside
 * its ball (up to six pixels of each). A node with no branch outside its ball falls back to its
 * core over √2 (the disc a perpendicular crossing inscribes is √2 × its lines' half-width).
 */
function lineRadius(g: Graph, node: number, deg: Int32Array): number {
  const N = g.nodes[node];
  const vals: number[] = [];
  for (const e of g.edges) {
    if (!e.alive || (e.a !== node && e.b !== node)) continue;
    for (const end of e.a === e.b ? [0, 1] : [e.a === node ? 0 : 1]) {
      let taken = 0;
      for (let i = 0; i < e.px.length && taken < 6; i++) {
        const p = e.px[end === 0 ? i : e.px.length - 1 - i];
        const [x, y] = at(p, g.W2);
        if (Math.hypot(x - N.x, y - N.y) < N.core + 1) continue;
        vals.push(g.r[p]);
        taken++;
      }
    }
  }
  if (!vals.length || deg[node] < 1) return Math.max(0.5, N.core / Math.SQRT2);
  vals.sort((a, b) => a - b);
  return Math.max(0.5, vals[vals.length >> 1]);
}

/**
 * Whether a branch thins steadily towards its tip, as the spur into a sharp corner's mitre does
 * (the ink narrows like a wedge: at three quarters of the way out it is under 0.45 of its width
 * at one quarter), where a real stroke keeps its width until its round end. Measured outside the
 * crossing's own disc.
 */
function tapers(g: Graph, e: GEdge, j: number): boolean {
  const J = g.nodes[j];
  const px = j === e.a ? e.px : e.px.slice().reverse();
  const out: number[] = [];
  for (const p of px) {
    const [x, y] = at(p, g.W2);
    if (Math.hypot(x - J.x, y - J.y) >= J.core) out.push(p);
  }
  if (out.length < 3) return false;
  const q = (f: number) => g.r[out[Math.min(out.length - 1, Math.floor(f * out.length))]];
  return q(0.75) < 0.45 * Math.max(0.5, q(0.25));
}

/** The direction a branch leaves a node in: towards its point `reach` along it (or its far end). */
function leaving(g: Graph, e: GEdge, j: number, reach: number): [number, number] {
  const J = g.nodes[j];
  const px = j === e.a ? e.px : e.px.slice().reverse();
  let target = px[px.length - 1];
  let acc = 0;
  for (let i = 1; i < px.length; i++) {
    const d = Math.abs(px[i] - px[i - 1]);
    acc += d === 1 || d === g.W2 ? 1 : Math.SQRT2;
    if (acc >= reach) {
      target = px[i];
      break;
    }
  }
  const [x, y] = at(target, g.W2);
  const l = Math.hypot(x - J.x, y - J.y) || 1;
  return [(x - J.x) / l, (y - J.y) / l];
}

/**
 * Whether a branch runs out of a CORNER into its mitre: the node's two other branches meet at an
 * angle (they are not one straight line), and this one leaves opposite their bisector, outward.
 * Only such a branch may be pruned for tapering — a hand's strokes taper at their ends too (a
 * tick, an arrowhead's barbs), and those never sit like that.
 */
function intoCorner(g: Graph, e: GEdge, j: number): boolean {
  const others = g.edges.filter((o) => o !== e && o.alive && (o.a === j || o.b === j));
  if (others.length !== 2 || others.some((o) => o.a === o.b)) return false;
  const reach = 2 * g.nodes[j].core + 3;
  const [ax, ay] = leaving(g, others[0], j, reach);
  const [bx, by] = leaving(g, others[1], j, reach);
  if (ax * bx + ay * by < Math.cos((165 * Math.PI) / 180)) return false; // a straight line through: a "T", no corner
  const mx = ax + bx;
  const my = ay + by;
  const ml = Math.hypot(mx, my);
  if (ml < 1e-6) return false;
  const [sx, sy] = leaving(g, e, j, reach);
  return -(sx * mx + sy * my) / ml > Math.cos((40 * Math.PI) / 180);
}

/** Short branches from a crossing to a free end, removed. How many. */
export function pruneSpurs(g: Graph, spur: number, minSpur: number): number {
  const deg = degrees(g);
  const radius = new Map<number, number>();
  const byNode = new Map<number, Array<{ e: GEdge; tip: number }>>();
  for (const e of g.edges) {
    if (!e.alive || e.a === e.b) continue;
    let j = -1;
    let tip = -1;
    if (deg[e.a] === 1 && deg[e.b] >= 3) [j, tip] = [e.b, e.a];
    else if (deg[e.b] === 1 && deg[e.a] >= 3) [j, tip] = [e.a, e.b];
    if (j < 0) continue;
    const J = g.nodes[j];
    let R = radius.get(j);
    if (R === undefined) {
      R = lineRadius(g, j, deg);
      radius.set(j, R);
    }
    // the branch's reach from the crossing's centre, past the lines' edge
    const [fx, fy] = at(e.px[j === e.a ? 0 : e.px.length - 1], g.W2);
    const reach = e.len + Math.hypot(fx - J.x, fy - J.y);
    const short = reach - R < Math.max(minSpur, spur * 2 * R);
    if (!short && !(reach - R < 6 * R && deg[j] === 3 && intoCorner(g, e, j) && tapers(g, e, j))) continue;
    const list = byNode.get(j) ?? [];
    list.push({ e, tip });
    byNode.set(j, list);
  }
  let pruned = 0;
  for (const [j, list] of byNode) {
    let gone = list;
    if (list.length >= deg[j]) {
      // every branch is short: keep the two longest, it is a small mark, not a knot of hairs
      gone = list.slice().sort((a, b) => a.e.len - b.e.len).slice(0, Math.max(0, list.length - 2));
    }
    for (const { e, tip } of gone) {
      e.alive = false;
      g.nodes[tip].alive = false;
      pruned++;
    }
  }
  return pruned;
}

/**
 * BLOBS: filled dots ON lines — the point a force acts on, a plotted point at a corner, an
 * electron on its orbit. (A dot on its own is found whole, before thinning: `dots.ts`.) Thinning
 * shrinks a filled disc to a pixel or a knot (often at the disc's edge, where its lines meet), so
 * the dot would vanish into the lines through it; it is found instead from the ink's radius: a local
 * maximum at least 2.5 px and 1.5× the drawing's typical line WIDTH (where two sketchy lines merge,
 * or three strokes meet at an arrow's tip, the ink is thick too, but not that thick), with the ring
 * just outside it mostly paper (a line through the ring fills ~0.39 of it, whatever its width; a
 * dot's few thin lines far less): over half paper when the dot is 3× the half-width of the
 * skeleton lines round it, over three quarters when it is only 2×. And a dot is a STEP in width:
 * 1.5–3 px outside its disc the ink is under 0.45 of its radius thick (a pencil's pressure spot
 * at a line's end, or a small filled arrowhead, thins gradually instead). Strongest first, none inside another.
 */
export function blobs(r: Float32Array, ink: Uint8Array, skel: Uint8Array, W2: number, lineWidth: number): Array<{ x: number; y: number; r: number }> {
  const H2 = ink.length / W2;
  const N = ring(W2);
  const cands: number[] = [];
  const least = Math.max(2.5, 1.5 * lineWidth);
  for (let p = W2 + 1; p < ink.length - W2 - 1; p++) {
    const v = r[p];
    if (v < least) continue;
    let max = true;
    for (let k = 0; k < 8 && max; k++) if (r[p + N[k]] > v) max = false;
    if (max) cands.push(p);
  }
  cands.sort((a, b) => r[b] - r[a] || a - b);
  const out: Array<{ x: number; y: number; r: number }> = [];
  for (const p of cands) {
    const R = r[p];
    const [x, y] = at(p, W2);
    if (out.some((b) => Math.hypot(b.x - x, b.y - y) < b.r + R + 1)) continue;
    const R1 = 1.4 * (R + 0.5);
    const R2 = 1.9 * (R + 0.5);
    const K = Math.ceil(R2);
    let n = 0;
    let on = 0;
    const lines: number[] = [];
    const px = (p % W2) | 0;
    const py = (p - px) / W2;
    for (let dy = -K; dy <= K; dy++) {
      for (let dx = -K; dx <= K; dx++) {
        const d = Math.hypot(dx, dy);
        if (d < R1 || d > R2) continue;
        const qx = px + dx;
        const qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= W2 || qy >= H2) continue;
        const q = qy * W2 + qx;
        n++;
        on += ink[q];
        if (skel[q]) lines.push(r[q]);
      }
    }
    lines.sort((a, b) => a - b);
    const rho = lines.length ? lines[lines.length >> 1] : 0;
    // a dot is a STEP in width: just outside it only thin lines go on, where a pencil's pressure
    // spot or a stroke's heavy end thins gradually into its line
    let outside = 0;
    const K2 = Math.ceil(R + 3);
    for (let dy = -K2; dy <= K2; dy++) {
      for (let dx = -K2; dx <= K2; dx++) {
        const d = Math.hypot(dx, dy);
        if (d < R + 1.5 || d > R + 3) continue;
        const qx = px + dx;
        const qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= W2 || qy >= H2) continue;
        outside = Math.max(outside, r[qy * W2 + qx]);
      }
    }
    if (outside >= 0.45 * R) continue;
    const paper = n > 0 ? 1 - on / n : 0;
    // 3 × its lines and the ring round it over half paper, or 2 × and the ring three quarters paper
    if ((R >= 3 * rho && paper > 0.55) || (R >= 2 * rho && paper > 0.75)) out.push({ x, y, r: R });
  }
  return out;
}

/** Contract and prune until the graph stops changing. How many spurs went. */
export function cleanGraph(g: Graph, opts: { spur: number; minSpur: number; bridge: number }): number {
  let pruned = 0;
  for (let round = 0; round < 6; round++) {
    const c = dropTinyLoops(g) + contractBridges(g, opts.bridge) + dropTinyLoops(g);
    const p = pruneSpurs(g, opts.spur, opts.minSpur);
    pruned += p;
    if (!c && !p) break;
  }
  for (const n of g.nodes) n.alive = false;
  for (const e of g.edges) if (e.alive) g.nodes[e.a].alive = g.nodes[e.b].alive = true;
  return pruned;
}

export { at as pixelCentre };
