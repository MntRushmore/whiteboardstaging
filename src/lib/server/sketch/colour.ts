import { LECTURE_PALETTE, type LectureInk } from "@/lib/live/lecture/contracts";

/**
 * A model's SVG colour → one of the board's inks (`LECTURE_PALETTE`, black, grey). The tutor has a
 * handful of markers, so any colour is read as the marker nearest in HUE, the way a person would
 * pick one ("brown" is the orange marker, "navy" the blue, "pink" the violet) — not by RGB
 * distance, which would turn every dark colour black and every pale one grey.
 *
 * NEVER RED: red means "wrong" on this board. Reds (and crimson, tomato, maroon…) are orange.
 * Near-white is its own answer ("white"): on a whiteboard a white stroke is invisible and a white
 * fill is no fill, so the caller drops it (or, on a dark background it dropped, inks it black).
 */

export type Rgb = { r: number; g: number; b: number };

/** A parsed paint: a colour (with its alpha), none, or something we cannot resolve to a colour. */
export type Paint = { kind: "colour"; rgb: Rgb; alpha: number } | { kind: "none" } | { kind: "current" } | { kind: "unknown" };

/** The inks' own colours (tldraw's light theme), for the eval's previews and the tests. */
export const INK_HEX: Record<LectureInk, string> = {
  blue: "#4465e9",
  orange: "#e16919",
  green: "#099268",
  violet: "#ae3ec9",
  "light-blue": "#4ba1f1",
  yellow: "#f1ac4b",
  black: "#1d1d1d",
  grey: "#9fa8b2",
};

/** The CSS named colours models actually write (an unknown name is read as black). */
const NAMED: Record<string, string> = {
  black: "000000", white: "ffffff", red: "ff0000", green: "008000", blue: "0000ff", yellow: "ffff00", orange: "ffa500", purple: "800080",
  violet: "ee82ee", pink: "ffc0cb", brown: "a52a2a", gray: "808080", grey: "808080", lightgray: "d3d3d3", lightgrey: "d3d3d3",
  darkgray: "a9a9a9", darkgrey: "a9a9a9", dimgray: "696969", dimgrey: "696969", silver: "c0c0c0", gainsboro: "dcdcdc", whitesmoke: "f5f5f5",
  slategray: "708090", slategrey: "708090", lightslategray: "778899", darkslategray: "2f4f4f", navy: "000080", darkblue: "00008b",
  mediumblue: "0000cd", royalblue: "4169e1", steelblue: "4682b4", dodgerblue: "1e90ff", deepskyblue: "00bfff", skyblue: "87ceeb",
  lightskyblue: "87cefa", lightblue: "add8e6", powderblue: "b0e0e6", cornflowerblue: "6495ed", cadetblue: "5f9ea0", aliceblue: "f0f8ff",
  cyan: "00ffff", aqua: "00ffff", teal: "008080", turquoise: "40e0d0", darkturquoise: "00ced1", lightcyan: "e0ffff", aquamarine: "7fffd4",
  lime: "00ff00", limegreen: "32cd32", lightgreen: "90ee90", palegreen: "98fb98", darkgreen: "006400", forestgreen: "228b22",
  seagreen: "2e8b57", mediumseagreen: "3cb371", olive: "808000", olivedrab: "6b8e23", yellowgreen: "9acd32", greenyellow: "adff2f",
  springgreen: "00ff7f", lawngreen: "7cfc00", chartreuse: "7fff00", darkolivegreen: "556b2f", mintcream: "f5fffa", honeydew: "f0fff0",
  gold: "ffd700", goldenrod: "daa520", darkgoldenrod: "b8860b", khaki: "f0e68c", darkkhaki: "bdb76b", lightyellow: "ffffe0",
  lemonchiffon: "fffacd", beige: "f5f5dc", wheat: "f5deb3", tan: "d2b48c", burlywood: "deb887", moccasin: "ffe4b5", peachpuff: "ffdab9",
  bisque: "ffe4c4", navajowhite: "ffdead", cornsilk: "fff8dc", ivory: "fffff0", linen: "faf0e6", oldlace: "fdf5e6", seashell: "fff5ee",
  darkorange: "ff8c00", coral: "ff7f50", tomato: "ff6347", orangered: "ff4500", salmon: "fa8072", lightsalmon: "ffa07a", darksalmon: "e9967a",
  crimson: "dc143c", firebrick: "b22222", darkred: "8b0000", maroon: "800000", indianred: "cd5c5c", lightcoral: "f08080",
  chocolate: "d2691e", saddlebrown: "8b4513", sienna: "a0522d", peru: "cd853f", sandybrown: "f4a460", rosybrown: "bc8f8f",
  magenta: "ff00ff", fuchsia: "ff00ff", orchid: "da70d6", plum: "dda0dd", thistle: "d8bfd8", lavender: "e6e6fa", indigo: "4b0082",
  darkviolet: "9400d3", darkorchid: "9932cc", mediumpurple: "9370db", mediumorchid: "ba55d3", blueviolet: "8a2be2", slateblue: "6a5acd",
  darkslateblue: "483d8b", rebeccapurple: "663399", darkmagenta: "8b008b", hotpink: "ff69b4", deeppink: "ff1493", lightpink: "ffb6c1",
  palevioletred: "db7093", mediumvioletred: "c71585", mistyrose: "ffe4e1", lavenderblush: "fff0f5", snow: "fffafa", ghostwhite: "f8f8ff",
  floralwhite: "fffaf0", antiquewhite: "faebd7", azure: "f0ffff", midnightblue: "191970", darkcyan: "008b8b", lightseagreen: "20b2aa",
  mediumturquoise: "48d1cc", mediumaquamarine: "66cdaa", darkseagreen: "8fbc8f", lightsteelblue: "b0c4de", mediumslateblue: "7b68ee",
};

function hexRgb(h: string): Rgb | null {
  const s = h.length === 3 || h.length === 4 ? h.slice(0, 3).replace(/./g, (c) => c + c) : h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1);

/** rgb()/rgba() channel: "255", "50%" */
function channel(s: string): number {
  const t = s.trim();
  const n = parseFloat(t);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, t.endsWith("%") ? (n * 255) / 100 : n));
}

function hslRgb(h: number, s: number, l: number): Rgb {
  const hue = (((h % 360) + 360) % 360) / 360;
  const f = (n: number) => {
    const k = (n + hue * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return { r: f(0), g: f(8), b: f(4) };
}

/** A fill or stroke value: `#abc`, `#aabbcc(dd)`, `rgb()`, `rgba()`, `hsl()`, a name, `none`, `currentColor`, `url(#…)` (with its fallback colour, if any). */
export function parsePaint(value: string | undefined): Paint | null {
  if (value === undefined) return null;
  const v = value.trim().toLowerCase().slice(0, 200);
  if (!v || v === "inherit") return null;
  if (v === "none" || v === "transparent") return { kind: "none" };
  if (v === "currentcolor") return { kind: "current" };
  if (v.startsWith("url(")) {
    const fallback = v.replace(/^url\([^)]*\)\s*/, "");
    return fallback ? (parsePaint(fallback) ?? { kind: "unknown" }) : { kind: "unknown" };
  }
  if (v.startsWith("#")) {
    const hex = v.slice(1);
    const rgb = hexRgb(hex);
    if (!rgb) return { kind: "unknown" };
    const alpha = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { kind: "colour", rgb, alpha };
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(v);
  if (fn) {
    const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return { kind: "unknown" };
    const alphaPart = parts[3];
    const alpha = alphaPart === undefined ? 1 : clamp01(alphaPart.endsWith("%") ? parseFloat(alphaPart) / 100 : parseFloat(alphaPart));
    if (fn[1].startsWith("rgb")) return { kind: "colour", rgb: { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]) }, alpha };
    const h = parseFloat(parts[0]);
    const s = clamp01(parseFloat(parts[1]) / 100);
    const l = clamp01(parseFloat(parts[2]) / 100);
    return Number.isFinite(h) ? { kind: "colour", rgb: hslRgb(h, s, l), alpha } : { kind: "unknown" };
  }
  const named = NAMED[v];
  return named ? { kind: "colour", rgb: hexRgb(named)!, alpha: 1 } : { kind: "unknown" };
}

function hsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** The ink for a colour, or "white" for one that would not show on a whiteboard. */
export function nearestInk(rgb: Rgb): LectureInk | "white" {
  const { h, s, l } = hsl(rgb);
  if (l >= 0.93) return "white";
  // dull or very dark colours are the black or grey marker, by lightness
  const chroma = s * (1 - Math.abs(2 * l - 1));
  if (l < 0.12 || chroma < 0.15) return l < 0.4 ? "black" : "grey";
  // reds are orange (never red), pale reds are pink: the violet marker
  if (h < 15 || h >= 335) return l > 0.72 ? "violet" : "orange";
  // tldraw's "yellow" is amber (35°) and its orange a red-orange (24°): the line between them is
  // 34°, so a vivid dark orange (33°) is still orange and CSS "orange" (39°) is amber
  if (h < 34) return "orange"; // orange, brown, rust
  if (h < 70) return "yellow"; // amber, gold, tan, yellow, olive
  if (h < 170) return "green";
  if (h < 200) return "light-blue"; // cyan, turquoise
  if (h < 222) return l > 0.5 ? "light-blue" : "blue"; // sky and steel blue
  if (h < 255) return l > 0.78 ? "light-blue" : "blue";
  return "violet"; // purple, magenta, pink
}

/** The inks in the order the board uses them, and black and grey (for the tests' round trip). */
export const ALL_INKS: readonly LectureInk[] = [...LECTURE_PALETTE, "black", "grey"];
