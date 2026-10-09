/**
 * The board the landing page's hero replays (src/components/landing/BoardReplay.tsx): five sums on
 * a real Agathon board, stroke by stroke, with the mark the live tutor put on each. Copied from a
 * test account's board on the local database (2026-10-05, "Basic arithmetic practice"). The
 * student's ink was written there by a test; the blue tick or ring on each line was drawn by the
 * board's own live tutor (`meta.source: "ai"`), so the page never shows a mark the product would
 * not make. No child wrote these strokes, and nothing on the page says one did.
 *
 * Each line is in board units with its origin at the line's top-left. `d` is the stroke as an SVG
 * path (the stored points, thinned to within 0.3 units), `len` its length, which sets how long the
 * replay takes to draw it. Strokes are in the order they were written.
 *
 * Pure data: no React, no network.
 */

/** One pen-down to pen-up stroke. */
export interface InkStroke {
  /** SVG path data, in the line's own units */
  d: string;
  /** the stroke's length in the same units */
  len: number;
}

/** A line of student ink and the one mark the tutor put on it. */
export interface InkLine {
  /** what the board read */
  latex: string;
  width: number;
  height: number;
  /** where the student's ink starts and ends across the line (a ring reaches further left and right) */
  inkX: number;
  inkRight: number;
  /** the student's strokes, in the order written */
  kid: readonly InkStroke[];
  /** a tick (right) or a ring (take another look) */
  mark: { kind: "tick" | "ring"; stroke: InkStroke };
}

export const BOARD_LINES: readonly InkLine[] = [
  {
    latex: "7+5=12",
    width: 196.1,
    height: 28.3,
    inkX: 0,
    inkRight: 157.6,
    kid: [
      { d: "M0 0L15.4 0.3L4.6 27.9", len: 45 },
      { d: "M30 18.4L44.4 18.1", len: 14 },
      { d: "M37.2 10.5L37.2 25.6", len: 15 },
      { d: "M75.9 0.1L62.9 0.1L61.7 12.8L67.9 13L70 14.6L72.6 18.3L73.4 22.1L71.8 24.8L68.1 27.1L62.8 27.7", len: 56 },
      { d: "M93.3 15.2L108.4 14.9", len: 15 },
      { d: "M93.3 22.4L108.4 22.1", len: 15 },
      { d: "M127.4 6.3L132.9 0.7L132.6 28.3", len: 35 },
      { d: "M141.8 5.3L143.3 3.2L145.6 2L148.4 1.5L151.8 1.7L154.5 2.5L156.7 4L156.7 6.4L154.6 13.1L144.8 22.1L142.7 24.9L141.7 28L157.6 27.6", len: 62 },
    ],
    mark: { kind: "tick", stroke: { d: "M175.3 15.4L179.6 19.5L182.4 24.5L187.8 14.8L196.1 3.1", len: 37 } },
  },
  {
    latex: "9-3=5",
    width: 208.6,
    height: 52,
    inkX: 36,
    inkRight: 173,
    kid: [
      { d: "M50.8 24.1L49.7 19.1L47.6 15.5L44.6 13.7L42.9 13.5L41.2 13.4L38.2 14.9L36.9 17L36 20.6L36 24.1L37.7 26.6L43.1 28.2L46.5 27.7L49.4 25.8L50.8 23.7L50.1 37.7L49.3 39.2L46.9 40.6L44.1 40.8L39.3 40.1L37.4 39L36.4 37.2", len: 78 },
      { d: "M66.3 29.4L76.9 29", len: 11 },
      { d: "M93.4 13L95.3 11.8L97.6 11.4L100.5 11.5L103.6 12.4L105.9 14L106.7 15.3L107.5 16.7L108 19.9L107.6 21.4L102.4 24.2L100.3 24.6L98.1 24.1L98.1 23.7L104.7 27L105.6 30.6L105.4 31.9L105.1 33.3L103.2 36.2L99.4 38.2L94 38.6", len: 59 },
      { d: "M124.4 26.1L139.5 25.8", len: 15 },
      { d: "M124.4 33.4L139.5 33", len: 15 },
      { d: "M173 11.3L159.6 11.5L158.8 24L164.4 24.3L167.2 25.4L168.6 26L170.9 29.2L170.3 33.4L168.4 36.1L165.3 38.1L159.8 38.9", len: 57 },
    ],
    mark: { kind: "ring", stroke: { d: "M5.3 18.9L8.1 15.4L13.5 11.7L32.5 7.1L56.5 2.9L82.9 0.1L111.4 0.1L140.3 1.4L153.1 3.6L186 10.3L194.5 13.6L199.8 16.7L208.6 24.2L207.6 27.3L208.3 31L202.4 33.9L200.2 38.2L183.1 43.4L148.8 50.2L120.7 51.6L92.1 52L77.7 50L63.9 49.5L51.4 48.3L28.9 42.7L11.3 37.5L2.8 30.9L0 27.3L6.4 16.9L11.5 13.7L19.8 9.6", len: 465 } },
  },
  {
    latex: "6 \\times 4=24",
    width: 204.7,
    height: 28.3,
    inkX: 0,
    inkRight: 166.5,
    kid: [
      { d: "M13.5 0.6L10.1 0.5L7.3 1.5L4.6 3.7L2.1 6.8L0.4 10.9L0.1 20.3L0.4 23.3L2.7 26.4L5.9 27.3L9.1 28.1L12.6 27.1L15.1 24.2L15.5 20.7L14.7 17.2L13.3 15L7.3 13.5L4.6 13.9L2.4 15.1L1 17.1", len: 72 },
      { d: "M31 11.8L43.5 25.6", len: 19 },
      { d: "M43.5 11.8L31 25.6", len: 19 },
      { d: "M73 0.1L60.9 19.4L76.9 18.8", len: 39 },
      { d: "M72.3 0.1L72.7 28", len: 28 },
      { d: "M93.6 15.2L108.7 14.8", len: 15 },
      { d: "M93.6 22.4L108.7 22.1", len: 15 },
      { d: "M127.1 5.6L128.6 3.5L130.8 2.3L133.7 1.8L137.1 2L139.7 2.8L142 4.3L141.9 6.7L139.9 13.4L136.5 16.1L130.1 22.4L127.9 25.2L126.9 28.3L142.8 27.9", len: 62 },
      { d: "M162.6 0L150.3 19.3L166.5 18.7", len: 39 },
      { d: "M161.9 0L162.2 27.9", len: 28 },
    ],
    mark: { kind: "tick", stroke: { d: "M184.5 14.9L188.4 18.8L191.8 24.4L197.4 13.8L200.9 8L204.7 2.8", len: 37 } },
  },
  {
    latex: "\\frac{1}{2}+\\frac{1}{4}=\\frac{3}{4}",
    width: 224.5,
    height: 61.5,
    inkX: 0,
    inkRight: 166.9,
    kid: [
      { d: "M13.2 4.8L17.3 0.1L17.7 23.8", len: 30 },
      { d: "M0 30.9L10.1 30.5L19 31.4L28.1 30.6", len: 28 },
      { d: "M9.2 41.2L10.6 39.2L12.3 38.2L18 38.1L20.6 39.4L21.9 40.8L22.6 42.7L22.2 44.7L19.1 47.5L15 52.8L9.9 58.1L9.3 60.6L22.8 60.3", len: 53 },
      { d: "M41.6 30.5L56.1 30.1", len: 14 },
      { d: "M48.8 22.6L48.8 37.7", len: 15 },
      { d: "M80.1 4.8L84.1 0.2L84.6 23.8", len: 30 },
      { d: "M66.6 30.9L95.3 30.6", len: 29 },
      { d: "M86.6 37.6L76 54.1L89.9 53.7", len: 33 },
      { d: "M86 37.6L86.3 61.5", len: 24 },
      { d: "M110.6 27.1L125.7 26.8", len: 15 },
      { d: "M110.6 34.3L125.7 34", len: 15 },
      { d: "M148.5 1.7L150.2 0.7L154.9 0L157.2 0.8L159.1 1.9L160.9 4.9L161.1 7.4L159.8 9.6L157.4 11.5L156.6 11.1L152.9 11.4L156.3 11.7L158.8 14.3L159.7 16.3L159.2 19L157 21.9L153.8 23.5L149.1 23.8", len: 51 },
      { d: "M138.2 30.9L148.6 30.8L157.2 31.5L166.9 30.6", len: 29 },
      { d: "M158.2 37.6L147.8 53.6L161.5 53.7", len: 33 },
      { d: "M157.6 37.6L157.9 61.5", len: 24 },
    ],
    mark: { kind: "tick", stroke: { d: "M185.1 32.7L192.1 40.8L198.8 50.4L216.9 18.1L224.5 9.1", len: 71 } },
  },
  {
    latex: "12-4=8",
    width: 190.7,
    height: 28.6,
    inkX: 0,
    inkRight: 152.2,
    kid: [
      { d: "M0 6.5L4.8 0.9L5.3 28.6", len: 35 },
      { d: "M14.5 5.9L16 3.7L21.3 1.6L24.4 1.6L27.1 2.3L29.5 4.8L28.9 9.9L24.1 16.6L20.6 19.1L17.5 22.3L14.4 28.5L30.2 28.2", len: 63 },
      { d: "M45.1 19.1L55.6 18.8", len: 10 },
      { d: "M83.8 0.7L71.8 20L87.8 19.4", len: 39 },
      { d: "M83.2 0.7L83.5 28.6", len: 28 },
      { d: "M104.5 16.1L119.6 15.8", len: 15 },
      { d: "M104.5 23.3L119.6 23", len: 15 },
      { d: "M144.5 0L147.9 0.8L150 3L151 5.9L151.4 8.9L150.3 11.4L148.4 13.1L144.2 13.6L140.7 13.1L138.3 8.3L139 2.9L141.2 0.7L144.5 0", len: 43 },
      { d: "M144.5 13.8L148.4 14.7L150.8 16.7L152.2 20.1L151.2 26.4L148.8 27.8L144.6 28.5L141.3 27.7L138.9 25.8L137.1 23.2L137.3 20.1L138.7 16.9L140.8 14.7L144.5 13.8", len: 47 },
    ],
    mark: { kind: "tick", stroke: { d: "M170 15.9L173.6 19L177.3 24.4L181.9 15.5L186.7 7.7L190.7 2.4", len: 37 } },
  },
];
