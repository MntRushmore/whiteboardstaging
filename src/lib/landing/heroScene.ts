/**
 * The hero painting (v4, the `HeroScene` slot): a boy at the kitchen table writing with a stylus on a
 * tablet propped on a wooden stand, a woman at the counter behind him with a mug, late-afternoon
 * light. Made 2026-10-13 with Gemini 3 Pro Image through OpenRouter: one wide scene in the style of
 * an earlier candidate, re-framed to 16:9 with plain tabletop added below, then the boy's grip
 * redrawn. By hand afterwards: a few engraving-like marks on the tablet's edge were painted out,
 * since at full size they read as lettering. Candidates and 1:1 crops are in
 * docs/qa-screenshots/landing-v4/art-*.png.
 *
 * The screen is blank on purpose, so the board's real ink can be drawn onto it. `board` is the
 * screen's four corners in the image's own pixels, measured on the source and scaled into each
 * export; the tablet is turned toward the boy and leans back, so map ink onto it with a projective
 * transform (CSS `matrix3d` from the four corners), not a scale. The boy's hand and stylus cover the
 * screen's left edge between the pen tip and the bottom-left corner: start ink at `penTip` and keep
 * it to the right of the hand, or it will draw over his fingers.
 *
 * The bottom third of the wide painting is plain tabletop, for the iPad replay to overlap; the cream
 * wall above and right of the boy is open, if a headline is ever set on the painting.
 *
 * Pure data: no React, no network.
 */

/** A point in the image's own pixels (its `width` × `height`). */
export interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

/** The blank screen's corners, clockwise from top-left. */
export interface SceneBoard {
  readonly tl: ScenePoint;
  readonly tr: ScenePoint;
  readonly br: ScenePoint;
  readonly bl: ScenePoint;
}

export interface HeroSceneImage {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  /** the tablet's blank screen, or null in a crop that doesn't show it */
  readonly board: SceneBoard | null;
  /** where the stylus touches the screen, or null in a crop that doesn't show it */
  readonly penTip: ScenePoint | null;
}

/** The wide painting, 16:9. */
export const HERO_SCENE: HeroSceneImage = {
  src: "/landing/v4/hero-scene.webp",
  width: 2400,
  height: 1340,
  alt: "A painting of a boy in a mustard sweater writing with a stylus on a tablet propped on a wooden stand at the kitchen table, while a woman stands at the counter by the window holding a mug, in warm late-afternoon light.",
  board: {
    tl: { x: 1743, y: 352 },
    tr: { x: 2132, y: 312 },
    br: { x: 1957, y: 838 },
    bl: { x: 1602, y: 764 },
  },
  penTip: { x: 1753, y: 673 },
};

/** The phone crop, 4:3: the boy and the tablet, without the kitchen behind. */
export const HERO_SCENE_PHONE: HeroSceneImage = {
  src: "/landing/v4/hero-scene-phone.webp",
  width: 1200,
  height: 900,
  alt: "A painting of a boy in a mustard sweater writing with a stylus on a tablet propped on a wooden stand at a kitchen table, in warm late-afternoon light.",
  board: {
    tl: { x: 702, y: 179 },
    tr: { x: 1028, y: 145 },
    br: { x: 881, y: 586 },
    bl: { x: 583, y: 524 },
  },
  penTip: { x: 710, y: 448 },
};
