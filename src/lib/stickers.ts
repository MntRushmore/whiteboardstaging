// Sticker definitions: each renders as an SVG string at a chosen pixel size.
// Used for both the library preview (rendered inline) and the canvas insert
// (rasterized to PNG and added as a tldraw image asset).

export type StickerCategory = "math" | "science" | "writing";

export type StickerDef = {
  id: string;
  label: string;
  category: StickerCategory;
  width: number;
  height: number;
  svg: (w: number, h: number) => string;
};

const txt = (
  x: number,
  y: number,
  s: string,
  size = 14,
  anchor: "start" | "middle" | "end" = "start",
) =>
  `<text x="${x}" y="${y}" font-family="Inter, system-ui, sans-serif" font-size="${size}" fill="#111" text-anchor="${anchor}">${s}</text>`;

const line = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke = "#111",
  width = 1.5,
) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" />`;

const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  stroke = "#111",
  fill = "none",
  rx = 0,
) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" stroke="${stroke}" stroke-width="1.5" fill="${fill}" />`;

const circle = (
  cx: number,
  cy: number,
  r: number,
  stroke = "#111",
  fill = "none",
  width = 1.5,
) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="${stroke}" stroke-width="${width}" fill="${fill}" />`;

const ellipse = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  stroke = "#111",
  fill = "none",
) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${stroke}" stroke-width="1.5" fill="${fill}" />`;

function wrap(content: string, w: number, h: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${content}</svg>`;
}

// ─── Math ────────────────────────────────────────────────────────────────────

const numberLine = (w: number, h: number) => {
  const pad = 16;
  const y = h / 2;
  const len = w - pad * 2;
  const step = len / 10;
  let parts = line(pad, y, pad + len, y);
  // Arrow tips
  parts += line(pad, y, pad + 6, y - 4);
  parts += line(pad, y, pad + 6, y + 4);
  parts += line(pad + len, y, pad + len - 6, y - 4);
  parts += line(pad + len, y, pad + len - 6, y + 4);
  for (let i = 0; i <= 10; i++) {
    const x = pad + i * step;
    parts += line(x, y - 6, x, y + 6);
    parts += txt(x, y + 22, String(i), 12, "middle");
  }
  return wrap(parts, w, h);
};

const coordGrid = (w: number, h: number) => {
  const pad = 12;
  const size = Math.min(w, h) - pad * 2;
  const x0 = (w - size) / 2;
  const y0 = (h - size) / 2;
  const cells = 10;
  const step = size / cells;
  let parts = "";
  // Grid lines
  for (let i = 0; i <= cells; i++) {
    const isAxis = i === cells / 2;
    const stroke = isAxis ? "#111" : "#cbd5e1";
    const sw = isAxis ? 1.5 : 1;
    parts += `<line x1="${x0 + i * step}" y1="${y0}" x2="${
      x0 + i * step
    }" y2="${y0 + size}" stroke="${stroke}" stroke-width="${sw}" />`;
    parts += `<line x1="${x0}" y1="${y0 + i * step}" x2="${x0 + size}" y2="${
      y0 + i * step
    }" stroke="${stroke}" stroke-width="${sw}" />`;
  }
  // Axis labels
  parts += txt(x0 + size + 4, y0 + size / 2 + 4, "x", 12);
  parts += txt(x0 + size / 2 + 4, y0 - 4, "y", 12);
  return wrap(parts, w, h);
};

const fractionBar = (w: number, h: number) => {
  const pad = 8;
  const barH = 40;
  const y = (h - barH) / 2;
  const segs = 4;
  const segW = (w - pad * 2) / segs;
  let parts = "";
  for (let i = 0; i < segs; i++) {
    parts += rect(pad + i * segW, y, segW, barH, "#111", i === 0 ? "#dbeafe" : "none");
  }
  parts += txt(w / 2, y + barH + 18, "1/4 segments", 12, "middle");
  return wrap(parts, w, h);
};

const placeValue = (w: number, h: number) => {
  const pad = 8;
  const cellW = (w - pad * 2) / 4;
  const cellH = 50;
  const y = (h - cellH - 24) / 2;
  const labels = ["Thousands", "Hundreds", "Tens", "Ones"];
  let parts = "";
  for (let i = 0; i < 4; i++) {
    parts += rect(pad + i * cellW, y, cellW, cellH, "#111");
    parts += txt(pad + i * cellW + cellW / 2, y + cellH + 18, labels[i], 11, "middle");
  }
  return wrap(parts, w, h);
};

const tenFrame = (w: number, h: number) => {
  const cols = 5,
    rows = 2;
  const pad = 16;
  const cellW = (w - pad * 2) / cols;
  const cellH = (h - pad * 2) / rows;
  let parts = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      parts += rect(pad + c * cellW, pad + r * cellH, cellW, cellH, "#111");
    }
  }
  return wrap(parts, w, h);
};

// ─── Science ─────────────────────────────────────────────────────────────────

const atom = (w: number, h: number) => {
  const cx = w / 2,
    cy = h / 2;
  let parts = "";
  parts += ellipse(cx, cy, w * 0.42, h * 0.18);
  parts += `<g transform="rotate(60 ${cx} ${cy})">${ellipse(
    cx,
    cy,
    w * 0.42,
    h * 0.18,
  )}</g>`;
  parts += `<g transform="rotate(-60 ${cx} ${cy})">${ellipse(
    cx,
    cy,
    w * 0.42,
    h * 0.18,
  )}</g>`;
  parts += circle(cx, cy, 8, "#111", "#ef4444", 1);
  // Electrons
  parts += circle(cx + w * 0.42, cy, 4, "#111", "#3b82f6", 1);
  parts += circle(cx - w * 0.21, cy + h * 0.16, 4, "#111", "#3b82f6", 1);
  parts += circle(cx - w * 0.21, cy - h * 0.16, 4, "#111", "#3b82f6", 1);
  return wrap(parts, w, h);
};

const beaker = (w: number, h: number) => {
  const pad = 18;
  const top = pad + 10;
  const bottom = h - pad;
  const left = pad + 8;
  const right = w - pad - 8;
  let parts = "";
  // Spout
  parts += `<path d="M ${left} ${top} L ${pad} ${
    top - 8
  }" stroke="#111" stroke-width="1.5" fill="none" />`;
  parts += `<path d="M ${right} ${top} L ${w - pad} ${
    top - 8
  }" stroke="#111" stroke-width="1.5" fill="none" />`;
  // Body
  parts += `<path d="M ${left} ${top} L ${left} ${bottom} L ${right} ${bottom} L ${right} ${top}" stroke="#111" stroke-width="1.5" fill="none" />`;
  // Liquid
  const liqTop = bottom - (bottom - top) * 0.4;
  parts += `<path d="M ${left + 1} ${liqTop} L ${left + 1} ${bottom - 1} L ${
    right - 1
  } ${bottom - 1} L ${right - 1} ${liqTop} Z" fill="#bfdbfe" />`;
  // Tick marks
  for (let i = 1; i < 4; i++) {
    const ty = top + ((bottom - top) * i) / 4;
    parts += line(left, ty, left + 8, ty);
  }
  return wrap(parts, w, h);
};

const forceArrow = (w: number, h: number) => {
  const y = h / 2;
  const pad = 16;
  const tip = w - pad;
  let parts = line(pad, y, tip, y, "#dc2626", 2);
  parts += `<path d="M ${tip} ${y} L ${tip - 12} ${y - 7} L ${tip - 12} ${
    y + 7
  } Z" fill="#dc2626" />`;
  parts += txt(w / 2, y - 14, "F", 18, "middle");
  return wrap(parts, w, h);
};

const cell = (w: number, h: number) => {
  let parts = "";
  parts += ellipse(w / 2, h / 2, w * 0.4, h * 0.35, "#16a34a", "#dcfce7");
  parts += ellipse(w * 0.6, h * 0.5, w * 0.13, h * 0.16, "#7c3aed", "#ede9fe");
  parts += circle(w * 0.42, h * 0.42, 4, "#16a34a", "#86efac");
  parts += circle(w * 0.55, h * 0.62, 3, "#16a34a", "#86efac");
  parts += txt(w * 0.6, h * 0.53, "nucleus", 9, "middle");
  return wrap(parts, w, h);
};

const periodicCell = (w: number, h: number) => {
  let parts = rect(8, 8, w - 16, h - 16, "#111", "#fafafa", 4);
  parts += txt(14, 24, "1", 11);
  parts += txt(w / 2, h / 2 + 4, "H", 32, "middle");
  parts += txt(w / 2, h - 22, "Hydrogen", 10, "middle");
  parts += txt(w / 2, h - 12, "1.008", 9, "middle");
  return wrap(parts, w, h);
};

// ─── Writing ─────────────────────────────────────────────────────────────────

const essayOutline = (w: number, h: number) => {
  const labels = ["Intro", "Body 1", "Body 2", "Body 3", "Conclusion"];
  const pad = 12;
  const rowH = (h - pad * 2) / 5;
  let parts = "";
  for (let i = 0; i < 5; i++) {
    parts += rect(pad, pad + i * rowH, w - pad * 2, rowH - 4, "#111", "#fafafa", 4);
    parts += txt(pad + 8, pad + i * rowH + rowH / 2 + 3, labels[i], 12);
  }
  return wrap(parts, w, h);
};

const venn = (w: number, h: number) => {
  const r = Math.min(w, h) * 0.32;
  const cy = h / 2;
  const cxA = w / 2 - r * 0.55;
  const cxB = w / 2 + r * 0.55;
  let parts = "";
  parts += circle(cxA, cy, r, "#3b82f6", "rgba(59,130,246,0.15)", 1.5);
  parts += circle(cxB, cy, r, "#dc2626", "rgba(220,38,38,0.15)", 1.5);
  parts += txt(cxA - r * 0.5, cy + 4, "A", 14, "middle");
  parts += txt(cxB + r * 0.5, cy + 4, "B", 14, "middle");
  return wrap(parts, w, h);
};

const tChart = (w: number, h: number) => {
  const pad = 12;
  let parts = "";
  parts += line(w / 2, pad, w / 2, h - pad);
  parts += line(pad, pad + 28, w - pad, pad + 28);
  parts += txt(w / 4, pad + 20, "Pros", 13, "middle");
  parts += txt((3 * w) / 4, pad + 20, "Cons", 13, "middle");
  return wrap(parts, w, h);
};

// ─── Registry ────────────────────────────────────────────────────────────────

export const STICKERS: StickerDef[] = [
  { id: "number-line", label: "Number line (0–10)", category: "math", width: 480, height: 90, svg: numberLine },
  { id: "coord-grid", label: "Coordinate grid", category: "math", width: 360, height: 360, svg: coordGrid },
  { id: "fraction-bar", label: "Fraction bar", category: "math", width: 400, height: 80, svg: fractionBar },
  { id: "place-value", label: "Place value chart", category: "math", width: 400, height: 100, svg: placeValue },
  { id: "ten-frame", label: "Ten frame", category: "math", width: 320, height: 140, svg: tenFrame },
  { id: "atom", label: "Atom diagram", category: "science", width: 280, height: 220, svg: atom },
  { id: "beaker", label: "Beaker", category: "science", width: 200, height: 240, svg: beaker },
  { id: "force-arrow", label: "Force arrow", category: "science", width: 320, height: 100, svg: forceArrow },
  { id: "cell", label: "Cell diagram", category: "science", width: 320, height: 220, svg: cell },
  { id: "periodic-cell", label: "Periodic table cell", category: "science", width: 160, height: 180, svg: periodicCell },
  { id: "essay-outline", label: "5-paragraph outline", category: "writing", width: 380, height: 280, svg: essayOutline },
  { id: "venn", label: "Venn diagram", category: "writing", width: 360, height: 240, svg: venn },
  { id: "t-chart", label: "T-chart (Pros / Cons)", category: "writing", width: 360, height: 220, svg: tChart },
];

// Convert an SVG string to a PNG data URL by drawing it onto a canvas at the
// requested pixel size. Returns a Promise<string> resolving to a `data:image/png;base64,...` URL.
export async function svgToPng(
  svgString: string,
  width: number,
  height: number,
  scale = 2,
): Promise<string> {
  const blob = new Blob([svgString], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
