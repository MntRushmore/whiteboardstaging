/**
 * The read-back: what the painter actually wrote, read with Mathpix, against the numbers the tutor
 * asked for. Image models write digits badly ("(1 0−1296)+1" for "(100−1296)+1", the owner's board,
 * 2026-10-25), and once the picture is the tutor's ink a wrong digit is a wrong answer. A number in
 * the picture that the tutor never asked for sends it back to the painter once (./run.ts).
 *
 * Never fails a run: an unreadable picture, a Mathpix error or no numbers asked for is "nothing
 * stray".
 */
import sharp from "sharp";
import { recognizeImage } from "@/lib/server/mathpix";

/** What the second painting is told on top of the first prompt. */
export const readbackNote =
  "Write every number EXACTLY as it appears in the instructions above, each digit fully formed and clearly separate; never split, merge or drop a digit.";

/** The read-back's wait, ms: Mathpix's text reader usually answers in well under a second. */
export const READBACK_TIMEOUT_MS = 3000;

const SUPERSCRIPTS: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

/** The numbers in a text: digit runs (a decimal part kept, a thousands comma dropped), no signs. */
export function numbersIn(text: string): string[] {
  const t = text
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => ` ${SUPERSCRIPTS[c]} `)
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
  return t.match(/\d+(?:\.\d+)?/g) ?? [];
}

/** A drawing whose tick marks and labels the tutor need not spell out. */
const GRAPHISH = /\b(graph|axis|axes|plot|number line|grid|coordinate|tick|scale)\b/i;

/**
 * Numbers `written` that `asked` never mentions. Nothing when the tutor asked for no numbers (a hint
 * in words, an arrow). Around a graph, lone digits are its ticks and pass.
 */
export function strayNumbers(written: string, asked: string): string[] {
  const want = new Set(numbersIn(asked));
  if (want.size === 0) return [];
  const graph = GRAPHISH.test(asked);
  const out = new Set<string>();
  for (const n of numbersIn(written)) {
    if (want.has(n)) continue;
    if (graph && /^\d$/.test(n)) continue;
    out.add(n);
  }
  return [...out];
}

/** The overlay (the painter's additions on transparent) read back, and its stray numbers. */
export async function strayNumbersOf(
  overlayPng: Buffer,
  width: number,
  height: number,
  asked: string,
  signal?: AbortSignal,
  requestId?: string,
): Promise<string[]> {
  if (numbersIn(asked).length === 0 || width <= 0 || height <= 0) return [];
  try {
    const jpeg = await sharp(overlayPng).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
    const read = await recognizeImage(`data:image/jpeg;base64,${jpeg.toString("base64")}`, signal, { timeoutMs: READBACK_TIMEOUT_MS, requestId });
    if (!read.ok) return [];
    return strayNumbers(read.latex, asked);
  } catch {
    return [];
  }
}
