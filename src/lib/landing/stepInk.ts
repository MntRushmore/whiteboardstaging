/**
 * Two more scenes for the parent landing page, beside the five sums in boardInk.ts: an equation
 * worked over four lines with the tutor's marks on it (CHECKS_SCENE), and a slip the tutor ringed
 * with the next step written out in its own hand (HELP_SCENE). Both are copied from test
 * accounts' boards on the local database: CHECKS from "Solving linear equations" (2026-10-05, the
 * right-hand problem only), HELP from "3(x − 2) = 12" (2026-10-03). The student's ink was written
 * there by a test; every blue stroke (the ticks, the rings and the written-out "3x − 6 = 12") was
 * drawn by the board's own live tutor (`meta.source: "ai"`; the step is Help me's handwritten
 * suggestion, `meta.suggestFor`), so the page never shows a mark the product would not make. No
 * child wrote these strokes, and nothing on the page says one did.
 *
 * Each scene is in board units, translated so the top-left of all its strokes is (0, 0); the
 * strokes keep their places on the board relative to each other. `d` is the stroke as an SVG path
 * (the stored points, thinned to within 0.3 units), `len` its length. Strokes are in the order
 * they were written (shape index), with one exception: on the HELP board the tutor's ring and its
 * written step were stored in one batch, 2 ms apart, with the step's first stroke indexed ahead of
 * the ring, so here the ring comes first and the step follows in its own order. On the board the
 * tutor's step sits to the right of the ring, not under it.
 *
 * Pure data: no React, no network.
 */

/** One pen-down to pen-up stroke, and whose pen drew it. */
export interface SceneStroke {
  /** SVG path data, in the scene's units */
  d: string;
  /** the stroke's length in the same units */
  len: number;
  /** the student's pen, or the live tutor's (a tick, a ring, a written step) */
  ink: "student" | "tutor";
}

/** A few lines of one board: the student's ink and the tutor's marks together. */
export interface InkScene {
  /** what's written, for alt text */
  says: string;
  /** source board (local id + title), for the record */
  source: string;
  /** bounds of every stroke, in board units; strokes are translated so the scene's top-left is (0, 0) */
  width: number;
  height: number;
  /** every stroke, in the order written */
  strokes: readonly SceneStroke[];
  /** the ring's vertical centre and right edge, in scene units, so a speech bubble can sit beside it (null if no ring) */
  ring: { right: number; midY: number } | null;
}

/** 3x − 5 = 10 worked down to x = 5: the slip ringed, the fixed line and the answer ticked. */
export const CHECKS_SCENE: InkScene = {
  says: "3x − 5 = 10, 3x = 5 ringed, 3x = 15 ticked, x = 5 ticked",
  source: "29eec418-1077-4972-88f4-b8b3b281fa67 · Solving linear equations",
  width: 200.3,
  height: 222.4,
  strokes: [
    { d: "M27.4 2.3L29.2 1.2L31.9 0.4L34.7 0.6L37.2 1.4L41.8 5.5L42.2 8.6L39.3 12.5L34.3 14.2L33.2 13.7L32 13.8L36 14.2L39.2 16.3L40 19.5L39.3 22.6L37.3 25.5L33.6 27.5L28.1 27.9", len: 60, ink: "student" },
    { d: "M51.1 13.9L64.9 28", len: 20, ink: "student" },
    { d: "M64.5 13.9L51.4 28", len: 19, ink: "student" },
    { d: "M79.1 18.8L89.6 18.5", len: 11, ink: "student" },
    { d: "M120.4 0.7L107.4 0.9L106.2 12.9L111.5 13.5L116.2 15.1L117.5 21.8L116.6 25.4L112.9 27.6L107.3 28.3", len: 56, ink: "student" },
    { d: "M137.8 15.5L152.9 15.1", len: 15, ink: "student" },
    { d: "M137.8 22.7L152.9 22.4", len: 15, ink: "student" },
    { d: "M171.9 5.8L177.3 0L177.1 27.8", len: 36, ink: "student" },
    { d: "M192.9 0.3L196.6 1.9L198.9 5.7L200.3 11.6L199.5 23L197.2 26.1L193.1 27.5L189.7 26L187.2 22.4L185.3 17.3L185.4 11.5L186.9 5.9L189 1.9L192.9 0.3", len: 68, ink: "student" },
    { d: "M27.4 66.8L29.2 65.7L31.9 64.9L34.7 65L37.2 65.9L41.8 69.9L42.2 73.1L39.3 77L34.3 78.7L33.2 78.1L32 78.2L36 78.6L39.2 80.7L40 84L39.3 87.1L37.3 89.9L33.6 91.9L28.1 92.4", len: 60, ink: "student" },
    { d: "M51.1 78.4L64.9 92.5", len: 20, ink: "student" },
    { d: "M64.5 78.4L51.4 92.5", len: 19, ink: "student" },
    { d: "M80.9 80L96 79.7", len: 15, ink: "student" },
    { d: "M80.9 87.2L96 86.9", len: 15, ink: "student" },
    { d: "M129.3 65.1L116 65.3L115.2 77.8L120.8 78.1L125 79.8L127.3 83L126.7 87.2L124.8 89.9L121.7 91.9L116.2 92.7", len: 57, ink: "student" },
    { d: "M2.9 72.8L10.1 66.1L22.6 60.4L32.4 59.4L40.6 57.2L51.6 55.7L61.9 55.2L72.7 53.7L83.3 53.8L105 55.3L132.1 61L147.2 66.4L151.8 69.9L154.6 72.1L156.5 75.4L157.7 79.7L157.3 82.6L149.6 89.8L138.7 94.7L130.6 97.5L111.2 101.3L101.1 101.7L90.5 103.8L68.7 104L58.3 102.3L38.6 100.6L29.7 97.6L22.3 95.9L8 90.7L3.6 87.6L0.8 84.3L0 81.1L1.2 73.9L4.6 71L8 67L13.5 64.3", len: 363, ink: "tutor" },
    { d: "M27.4 131.8L29.2 130.7L31.9 130L34.7 130.1L37.2 131L41.8 135L42.2 138.1L39.3 142.1L37.6 142.4L35.6 143.5L32 143.3L36 143.7L39.2 145.8L40 149.1L39.3 152.1L37.3 155L33.6 157L28.1 157.5", len: 60, ink: "student" },
    { d: "M51.1 143.4L64.9 157.6", len: 20, ink: "student" },
    { d: "M64.5 143.4L51.4 157.6", len: 19, ink: "student" },
    { d: "M80.9 145.1L96 144.7", len: 15, ink: "student" },
    { d: "M80.9 152.3L96 152", len: 15, ink: "student" },
    { d: "M114.9 136.1L119.6 130.7L120.1 158.2", len: 35, ink: "student" },
    { d: "M144.5 129.9L131.4 130.1L130.5 142.2L135.8 142.9L139.8 144.9L141.7 148.1L141.8 151L139.9 154.9L138.5 155.9L137 156.8L131.3 157.5", len: 55, ink: "student" },
    { d: "M162.3 144.7L165.9 148.6L169.5 154.3L174.6 144.7L182.9 133", len: 37, ink: "tutor" },
    { d: "M27.4 208.2L41.2 222.3", len: 20, ink: "student" },
    { d: "M40.9 208.2L27.7 222.3", len: 19, ink: "student" },
    { d: "M57.2 209.9L72.3 209.6", len: 15, ink: "student" },
    { d: "M57.2 217.2L72.3 216.8", len: 15, ink: "student" },
    { d: "M105.7 194.8L92.7 195L91.6 207L96.8 207.6L101.4 209.3L102.4 212.4L102.8 215.9L101.8 219.5L98.3 221.7L92.6 222.4", len: 56, ink: "student" },
    { d: "M123.9 210.2L127.6 213.2L130.4 218.2L135.4 209.3L144 197.8", len: 35, ink: "tutor" },
  ],
  ring: { right: 157.7, midY: 78.9 },
};

/** 3(x − 2) = 12 opened up as 3x − 2 = 12: the tutor rings it and writes 3x − 6 = 12 beside it. */
export const HELP_SCENE: InkScene = {
  says: "3(x − 2) = 12, 3x − 2 = 12 ringed, the tutor writes 3x − 6 = 12 beside it",
  source: "f26324b9-e653-45e8-8ed3-c87bc4e3fccd · 3(x − 2) = 12",
  width: 386.6,
  height: 116.6,
  strokes: [
    { d: "M36.2 7.9L37.9 6.6L42.3 5.6L44.5 6.1L46.4 7.4L47.6 10L46.9 15.1L45.2 16.3L43.7 16.4L42.5 17.7L40.1 17.9L39.6 17.2L39 17.3L41.8 18.2L43.7 20.1L44.6 22.9L44.2 26L41.9 28.6L38.5 30.6L33.8 31.3", len: 52, ink: "student" },
    { d: "M57.9 1.3L55 5.3L51.1 18.4L52.5 27.8L54.2 31", len: 32, ink: "student" },
    { d: "M67.7 15.7L78.8 30", len: 18, ink: "student" },
    { d: "M80.1 15.3L65.9 30.4", len: 21, ink: "student" },
    { d: "M93.7 19.6L104.2 19.3", len: 11, ink: "student" },
    { d: "M122.4 6L124.2 3.6L126.6 2.1L132.5 2.5L136.7 4.9L136.5 8.5L135.2 12.3L120.7 27.8L119.2 31L134.7 31", len: 64, ink: "student" },
    { d: "M141.8 0L143.5 4.3L144.2 8.8L144.9 14.3L144.5 18.8L140.5 28.2L137.8 31.7", len: 34, ink: "student" },
    { d: "M162.2 18.7L175 19.2", len: 13, ink: "student" },
    { d: "M160.8 27.3L173.6 27.5", len: 13, ink: "student" },
    { d: "M191.6 12.2L196.4 7.4L193.4 32.2", len: 32, ink: "student" },
    { d: "M202.8 11L206.2 7.5L209.3 6.8L211.3 6.9L213.5 7.7L215.5 9.3L215.3 11.1L212.6 17.9L203.4 26.2L201.5 29L200.2 31.9L213.6 31.3", len: 56, ink: "student" },
    { d: "M42.5 78.4L44.3 77.1L49.1 76.8L51.5 77.5L53.9 79.5L54.8 81.5L53.5 87.6L47.3 90.5L45.6 90.4L45.1 89.8L48.7 90.1L51.1 93.1L51.4 95.4L51.1 98.9L48.8 101.9L45 103.9L39.8 104.7", len: 57, ink: "student" },
    { d: "M64.4 88.6L74.4 101.4", len: 16, ink: "student" },
    { d: "M74.1 88.4L61.4 102.1", len: 19, ink: "student" },
    { d: "M86.2 92.4L94.9 91.8", len: 9, ink: "student" },
    { d: "M109.8 80.1L111.3 78L113.4 76.7L116.3 75.8L120.7 75.8L123.3 80.1L119.6 86.6L110.7 95.5L107.1 101.6L120.9 101.3", len: 58, ink: "student" },
    { d: "M136.9 87.4L151.5 87", len: 15, ink: "student" },
    { d: "M136.6 97.1L151.1 97", len: 15, ink: "student" },
    { d: "M171.8 78.4L177.5 72L174 102.9", len: 40, ink: "student" },
    { d: "M186.1 77.6L187.7 75.2L190.5 73.8L193.1 73.3L195.6 73.7L198.3 75.7L200 77.5L200.8 79.8L199.3 83L197.1 86.2L193.2 89L184.3 99.4L183.1 102.4L198.3 102.4", len: 64, ink: "student" },
    { d: "M5.3 81.4L9.9 77.3L16.3 73.6L26.8 71.1L37.2 67.7L48.9 65.4L95.5 60.8L112.4 60.8L145.5 62.6L177.3 65.3L202.4 70.7L216.6 72.4L233 79.3L236.4 82.8L241.2 90.6L238.7 94.6L233.6 98.7L227.3 101.2L222.4 104.6L212.6 107.6L198.1 110.7L171 114.5L155.5 115.9L122.3 116.6L73.4 114L57.9 112.3L45 110L32.1 106.3L20.2 104L7.1 97.1L0.7 93L0.6 88.9L0 85.5L1.3 82.1L13.3 74.4L23 71.4", len: 534, ink: "tutor" },
    { d: "M264.7 80.5L267.8 79.3L272 79.8L273.4 80.7L274.6 82.4L275 85.1L274.6 86.3L270.8 88.6L268.7 88.8L268 88.2L271.1 89L272.5 90.5L273.2 92.7L273.1 94.9L271.6 96.8L269 98L265.2 98.4", len: 42, ink: "tutor" },
    { d: "M281 88.4L291 98.7", len: 14, ink: "tutor" },
    { d: "M291 88.4L281 98.7", len: 14, ink: "tutor" },
    { d: "M300.9 91.9L308.2 91.7", len: 7, ink: "tutor" },
    { d: "M329.3 79.6L327 79.4L322.9 81.6L320.3 86.2L319.6 92.4L320.5 95.5L324 98.1L326.6 98.7L330.4 96L330.9 93.2L330.7 92.1L330.4 91L329 89.7L325.3 88.6L323.2 88.8L321.6 89.7L320.6 91", len: 50, ink: "tutor" },
    { d: "M341.8 89.5L352.3 89.3", len: 11, ink: "tutor" },
    { d: "M341.8 94.6L352.3 94.3", len: 11, ink: "tutor" },
    { d: "M365.5 83.5L369.3 78.8L369.2 98.8", len: 26, ink: "tutor" },
    { d: "M375.6 82.8L376.7 81.2L378.2 80.4L382.7 80L384.4 80.3L385.2 82.1L386.3 83.2L385.7 85.9L377.7 94.5L375.6 98.6L386.6 98.4", len: 44, ink: "tutor" },
  ],
  ring: { right: 241.2, midY: 88.7 },
};
