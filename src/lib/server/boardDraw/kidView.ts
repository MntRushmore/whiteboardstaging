/**
 * WHAT THE KID SEES: the board with the painter's additions laid over it the way the iPad draws them
 * (ios/…/PictureTutor/PictureTutorCapture.swift `tutorBlue`): each overlay pixel's DARKNESS becomes the
 * tutor blue's opacity, so black ink is solid blue, soft edges stay soft — and a pale fill (a light
 * yellow or pale blue "shaded" slice) comes out nearly clear. That is why a fraction bar the painter did
 * shade showed "nothing shaded" on the iPad (the 11-13 demo). The check before show (./verify.ts) looks
 * at this picture, never at the painter's colours, and the bench scores it.
 */
import sharp from "sharp";
import type { Rgb } from "./overlay";

/** InkColor.tutor (AgathonBoard InkColor.swift): #2D5BFF */
export const TUTOR_BLUE = { r: 0x2d, g: 0x5b, b: 0xff } as const;

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** The iPad's opacity for one overlay pixel: coverage × darkness (0–1). */
export function blueAlpha(r: number, g: number, b: number, a: number): number {
  if (a <= 0) return 0;
  return (a / 255) * Math.max(0, Math.min(1, 1 - lum(r, g, b) / 255));
}

/** The board with `overlayRgba` (W×H×4, straight alpha) composited in tutor blue, as RGB. */
export function kidViewRgb(board: Rgb, overlayRgba: Uint8Array): Rgb {
  const n = board.width * board.height;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const al = blueAlpha(overlayRgba[i * 4], overlayRgba[i * 4 + 1], overlayRgba[i * 4 + 2], overlayRgba[i * 4 + 3]);
    out[i * 3] = Math.round(board.data[i * 3] * (1 - al) + TUTOR_BLUE.r * al);
    out[i * 3 + 1] = Math.round(board.data[i * 3 + 1] * (1 - al) + TUTOR_BLUE.g * al);
    out[i * 3 + 2] = Math.round(board.data[i * 3 + 2] * (1 - al) + TUTOR_BLUE.b * al);
  }
  return { width: board.width, height: board.height, data: out };
}

/** The kid's view as a JPEG data URL, long side at most `maxSide` px (a vision call's input). */
export async function kidViewJpeg(view: Rgb, maxSide = 1024): Promise<string> {
  const buf = await sharp(Buffer.from(view.data.buffer, view.data.byteOffset, view.data.length), { raw: { width: view.width, height: view.height, channels: 3 } })
    .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}
