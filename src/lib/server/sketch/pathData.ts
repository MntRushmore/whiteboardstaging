import { flattenArc, flattenCubic, flattenQuad, type Pt } from "./geometry";

/**
 * SVG path data (`d`) → subpaths of points, in the path's own coordinates: every command, absolute
 * and relative (M L H V C S Q T A Z), implicit repeats ("M 0 0 10 10" is a move then a line),
 * packed numbers ("M.5.5-1e2" is three numbers) and packed arc flags ("a5 5 0 1010 10"), as the
 * SVG grammar allows them.
 *
 * Curves are flattened here with `tol` in path units (the caller converts its tolerance through
 * the element's transform). Parsing stops at the first thing the grammar does not allow and keeps
 * what came before, as browsers render a path "up to the error". Bounded: at most `maxSegments`
 * segments are read, so a hostile `d` of a million commands costs no more than a long one.
 */

export interface Subpath {
  points: Pt[];
  closed: boolean;
}

export const MAX_PATH_SEGMENTS = 4000;

const COMMAND = /[MmLlHhVvCcSsQqTtAaZz]/;
const PARAMS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

class Scanner {
  i = 0;
  constructor(readonly s: string) {}
  skipSpace(): void {
    const s = this.s;
    while (this.i < s.length) {
      const c = s.charCodeAt(this.i);
      // space, tab, CR, LF, FF, and one comma between numbers
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 44) this.i++;
      else break;
    }
  }
  peek(): string {
    this.skipSpace();
    return this.s[this.i] ?? "";
  }
  /** A number, or null (the position is left where it was). */
  number(): number | null {
    this.skipSpace();
    const s = this.s;
    let j = this.i;
    if (s[j] === "+" || s[j] === "-") j++;
    const intStart = j;
    while (j < s.length && s[j] >= "0" && s[j] <= "9") j++;
    let digits = j > intStart;
    if (s[j] === ".") {
      j++;
      const fracStart = j;
      while (j < s.length && s[j] >= "0" && s[j] <= "9") j++;
      digits = digits || j > fracStart;
    }
    if (!digits) return null;
    if (s[j] === "e" || s[j] === "E") {
      let k = j + 1;
      if (s[k] === "+" || s[k] === "-") k++;
      const expStart = k;
      while (k < s.length && s[k] >= "0" && s[k] <= "9") k++;
      if (k > expStart) j = k;
    }
    const n = Number(s.slice(this.i, j));
    this.i = j;
    return n;
  }
  /** An arc flag: a single 0 or 1, which may be packed against the next number. */
  flag(): boolean | null {
    this.skipSpace();
    const c = this.s[this.i];
    if (c === "0" || c === "1") {
      this.i++;
      return c === "1";
    }
    return null;
  }
}

/** Parses and flattens `d`. Non-finite numbers end the path there (what came before is kept). */
export function parsePathData(d: string, tol: number, maxSegments = MAX_PATH_SEGMENTS): Subpath[] {
  const sc = new Scanner(d);
  const out: Subpath[] = [];
  let cur: Subpath | null = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  /** the last cubic's second control point / the last quadratic's control point, for S and T */
  let lastCubic: Pt | null = null;
  let lastQuad: Pt | null = null;
  let cmd = "";
  let segments = 0;

  const begin = () => {
    cur = { points: [[x, y]], closed: false };
    out.push(cur);
  };
  const ensure = (): Subpath => {
    if (!cur) begin();
    return cur!;
  };
  const read = (n: number, isArc: boolean): number[] | null => {
    const v: number[] = [];
    for (let k = 0; k < n; k++) {
      if (isArc && (k === 3 || k === 4)) {
        const f = sc.flag();
        if (f === null) return null;
        v.push(f ? 1 : 0);
      } else {
        const num = sc.number();
        if (num === null || !Number.isFinite(num)) return null;
        v.push(num);
      }
    }
    return v;
  };

  while (sc.i < d.length && segments < maxSegments) {
    const c = sc.peek();
    if (!c) break;
    if (COMMAND.test(c)) {
      cmd = c;
      sc.i++;
    } else if (!cmd || cmd === "z" || cmd === "Z") {
      // numbers with no command before them, or after Z: the grammar ends here
      break;
    }
    const lower = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    if (lower === "z") {
      if (cur) {
        (cur as Subpath).closed = true;
        x = startX;
        y = startY;
      }
      cur = null;
      lastCubic = lastQuad = null;
      segments++;
      continue;
    }
    const v = read(PARAMS[lower], lower === "a");
    if (!v) break;
    segments++;
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    let nextCubic: Pt | null = null;
    let nextQuad: Pt | null = null;
    switch (lower) {
      case "m": {
        x = ox + v[0];
        y = oy + v[1];
        startX = x;
        startY = y;
        begin();
        // further pairs after a move are lines
        cmd = rel ? "l" : "L";
        break;
      }
      case "l":
      case "h":
      case "v": {
        const sp = ensure();
        if (lower === "l") {
          x = ox + v[0];
          y = oy + v[1];
        } else if (lower === "h") x = ox + v[0];
        else y = oy + v[0];
        sp.points.push([x, y]);
        break;
      }
      case "c":
      case "s": {
        const sp = ensure();
        const p0: Pt = [x, y];
        let p1: Pt;
        let p2: Pt;
        let p3: Pt;
        if (lower === "c") {
          p1 = [ox + v[0], oy + v[1]];
          p2 = [ox + v[2], oy + v[3]];
          p3 = [ox + v[4], oy + v[5]];
        } else {
          p1 = lastCubic ? [2 * x - lastCubic[0], 2 * y - lastCubic[1]] : p0;
          p2 = [ox + v[0], oy + v[1]];
          p3 = [ox + v[2], oy + v[3]];
        }
        sp.points.push(...flattenCubic(p0, p1, p2, p3, tol));
        [x, y] = p3;
        nextCubic = p2;
        break;
      }
      case "q":
      case "t": {
        const sp = ensure();
        const p0: Pt = [x, y];
        const p1: Pt = lower === "q" ? [ox + v[0], oy + v[1]] : lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : p0;
        const p2: Pt = lower === "q" ? [ox + v[2], oy + v[3]] : [ox + v[0], oy + v[1]];
        sp.points.push(...flattenQuad(p0, p1, p2, tol));
        [x, y] = p2;
        nextQuad = p1;
        break;
      }
      case "a": {
        const sp = ensure();
        const end: Pt = [ox + v[5], oy + v[6]];
        sp.points.push(...flattenArc([x, y], v[0], v[1], v[2], v[3] === 1, v[4] === 1, end, tol));
        [x, y] = end;
        break;
      }
    }
    lastCubic = nextCubic;
    lastQuad = nextQuad;
  }
  return out.filter((sp) => sp.points.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])));
}
