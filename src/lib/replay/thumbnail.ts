/**
 * A screen's thumbnail for the viewer's page switcher, as an SVG string drawn straight from the
 * stored records: the strokes as paths in their own colours, everything else (the tutor's typeset
 * maths, pictures, notes, shapes) as a light box where it sits. Pure and cheap — no editor, no
 * export, no fonts — so every screen of a long board gets one at once.
 */
import type { TLRecord } from "tldraw";

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** tldraw's light-theme ink colours (DefaultColorThemePalette.lightMode[color].solid). */
const INK: Record<string, string> = {
  black: "#1d1d1d",
  grey: "#9fa8b2",
  "light-violet": "#e085f4",
  violet: "#ae3ec9",
  blue: "#4465e9",
  "light-blue": "#4ba1f1",
  yellow: "#f1ac4b",
  orange: "#e16919",
  green: "#099268",
  "light-green": "#4cb05e",
  "light-red": "#f87777",
  red: "#e03131",
  white: "#ffffff",
};

/** tldraw's STROKE_SIZES, +1 as the draw shape draws them */
const STROKE: Record<string, number> = { s: 3, m: 4.5, l: 6, xl: 11 };

/** at most this many points of one stroke are drawn (a thumbnail needs no more) */
const MAX_POINTS = 48;

type Shape = { id: string; type: string; parentId: string; index: string; x: number; y: number; rotation: number; opacity: number; props: Record<string, unknown> };

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const r1 = (v: number) => Math.round(v * 10) / 10;

function strokePath(props: Record<string, unknown>): string {
  const segments = Array.isArray(props.segments) ? (props.segments as { points?: unknown }[]) : [];
  let d = "";
  for (const seg of segments) {
    const pts = Array.isArray(seg?.points) ? (seg.points as { x?: unknown; y?: unknown }[]) : [];
    if (pts.length === 0) continue;
    const step = Math.max(1, Math.ceil(pts.length / MAX_POINTS));
    for (let i = 0; i < pts.length; i += step) d += `${i === 0 ? "M" : "L"}${r1(num(pts[i].x))} ${r1(num(pts[i].y))}`;
    const last = pts[pts.length - 1];
    if ((pts.length - 1) % step !== 0) d += `L${r1(num(last.x))} ${r1(num(last.y))}`;
    // a dot: a zero-length line still draws with a round cap
    if (pts.length === 1) d += `L${r1(num(last.x) + 0.01)} ${r1(num(last.y))}`;
  }
  return d;
}

function shapeSvg(s: Shape, children: string, minStroke: number): string {
  const p = s.props;
  let body = "";
  if (s.type === "draw" || s.type === "highlight") {
    const d = strokePath(p);
    if (d) {
      const w = Math.max(minStroke, (STROKE[String(p.size)] ?? 4.5) * num(p.scale, 1) * (s.type === "highlight" ? 4 : 1));
      const color = INK[String(p.color)] ?? INK.black;
      body = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${r1(w)}" stroke-linecap="round" stroke-linejoin="round"${s.type === "highlight" ? ' stroke-opacity="0.35"' : ""}/>`;
    }
  } else if (typeof p.w === "number" && typeof p.h === "number" && s.type !== "group") {
    const fill = s.type === "math" ? "#eef2ff" : s.type === "image" || s.type === "video" ? "#e5e7eb" : "#f3f4f6";
    const stroke = s.type === "math" ? "#c7d2fe" : "#d1d5db";
    body = `<rect width="${r1(num(p.w))}" height="${r1(num(p.h))}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
  }
  if (!body && !children) return "";
  const rot = num(s.rotation);
  const transform = `translate(${r1(num(s.x))} ${r1(num(s.y))})${rot ? ` rotate(${r1((rot * 180) / Math.PI)})` : ""}`;
  const opacity = num(s.opacity, 1);
  return `<g transform="${transform}"${opacity < 1 ? ` opacity="${opacity}"` : ""}>${body}${children}</g>`;
}

/** The SVG for `pageId`'s screen, `width` px wide (16:9 for a standard screen). */
export function pageThumbnailSvg(records: readonly TLRecord[], pageId: string, screen: ScreenRect, width = 160): string {
  const kids = new Map<string, Shape[]>();
  for (const r of records as readonly unknown[]) {
    const s = r as Shape & { typeName?: string };
    if (s?.typeName !== "shape") continue;
    const list = kids.get(s.parentId);
    if (list) list.push(s);
    else kids.set(s.parentId, [s]);
  }
  // a stroke at least 1.6 px wide in the thumbnail, or a screen of writing reads as a smudge
  const minStroke = (1.6 * screen.w) / Math.max(1, width);
  const draw = (parent: string, depth: number): string => {
    const list = kids.get(parent);
    if (!list || depth > 32) return "";
    return [...list]
      .sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0))
      .map((s) => shapeSvg(s, draw(s.id, depth + 1), minStroke))
      .join("");
  };
  const height = Math.round((width * screen.h) / Math.max(1, screen.w));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${r1(screen.x)} ${r1(screen.y)} ${r1(screen.w)} ${r1(screen.h)}">` +
    `<rect x="${r1(screen.x)}" y="${r1(screen.y)}" width="${r1(screen.w)}" height="${r1(screen.h)}" fill="#ffffff"/>` +
    draw(pageId, 0) +
    `</svg>`
  );
}

/** As an `<img src>`. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
