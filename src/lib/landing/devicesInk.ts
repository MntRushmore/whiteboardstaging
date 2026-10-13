/**
 * The real boards on the landing page's tablet and phone (v3, Devices.tsx): each is a screenshot of a
 * kid's Today board, taken with their ink and the tutor's marks hidden, and those very strokes, to be
 * drawn back over it as the picture comes into view. Captured on 2026-10-12 from the running app
 * against the local database (the demo family's kids). The board wrote the problems. The kids' lines
 * went in through the product itself: typed in the Type bar, or drawn through tldraw's own pen input
 * (the hand engine's strokes, as a test writes them, not a child). The board read each line and its
 * live tutor put the check mark on it and filled the Today stars. Nothing here was drawn for the page.
 *
 * TABLET: "Ava", 6th grade, on an iPad held upright (820 × 1180, zoomed in: camera x -26.0,
 * y 86.4, z 1.1), her Today practice 2/5 ÷ 2, −9 + 18, 5 − 8, 3², 4³, four of them
 * answered with the pen and checked (4 of 5). Her answer to 5 − 8 is off the screen at this zoom.
 * PHONE: "Maya", 4th grade, on a phone (390 × 797 below the status bar, camera x 0.0,
 * y 416.3, z 0.46): 52 + 18 answered by typing (the board wrote it, with its fine
 * pen) and 76 + 21 with the pen (2 of 5).
 *
 * Paths are in the screenshot's CSS px, in the order they were drawn; `len` is a stroke's length in
 * px, `pen` the width the board drew the kid's line at, at this zoom.
 *
 * Pure data: no React, no network.
 */

export interface PictureStroke {
  d: string;
  len: number;
}

export interface PictureLine {
  /** what the kid wrote, for the record */
  says: string;
  /** the kid's pen width, px */
  pen: number;
  /** the kid's strokes (the board's black pen) */
  kid: readonly PictureStroke[];
  /** the tutor's check mark on it (blue) */
  check: PictureStroke;
}

export interface InkPictureScene {
  image: string;
  width: number;
  height: number;
  /** the tutor's pen for the check marks, px */
  tutorPen: number;
  lines: readonly PictureLine[];
}

export const TABLET_SCENE: InkPictureScene = {
  image: "/landing/v3/devices-tablet.webp",
  width: 820,
  height: 1180,
  tutorPen: 3.9,
  lines: [
    {
      says: "2/5 × 1/2",
      pen: 9.4,
      kid: [
        { d: "M102.3 300.2L104.6 296.8L112.4 293.4L120.6 295.6L124.2 297.5L125 301.6L117.3 312.6L111.5 319.5L106.9 323.9L104.1 328.2L102.4 332.7L125.1 332.3", len: 91 },
        { d: "M86.9 344.7L103.1 343.8L118.3 345.5L133.9 344.2", len: 47 },
        { d: "M124.1 355.8L105.1 355.8L103.5 373.3L111.3 374.6L118.4 376.8L120.8 382L117.8 391.6L113 394.9L105.2 395.6", len: 81 },
        { d: "M158.7 332.3L179.6 355.4", len: 31 },
        { d: "M179.6 332.3L158.7 355.4", len: 31 },
        { d: "M220.6 301L227.2 293L228.1 332.7", len: 50 },
        { d: "M198.4 344.7L245.4 344.2", len: 47 },
        { d: "M214 362L215.8 358.6L219 356.5L224.1 356.1L228.7 356.5L234.9 359.2L234.6 364.8L232 371.9L222.2 382.2L215.1 390.8L214.1 394.8L236.6 394.1", len: 89 },
      ],
      check: { d: "M264.7 346.7L273.5 355.3L280.7 366.6L301.2 331L309 321.1", len: 79 },
    },
    {
      says: "= 1/5",
      pen: 9.4,
      kid: [
        { d: "M86.9 461.2L112.2 460.6", len: 25 },
        { d: "M86.9 473.3L112.2 472.7", len: 25 },
        { d: "M155.1 424L163.4 416.2L162.6 455.7", len: 51 },
        { d: "M133 467.6L149.6 466.4L180 467", len: 47 },
        { d: "M170.2 478.8L151 478.9L150.5 496.8L159.1 497.5L164.6 500.2L166.8 505.1L167 509.3L164.8 513.8L159.1 518L151.3 518.5", len: 81 },
      ],
      check: { d: "M200.3 470L207.9 478.6L215.2 490.3L226.1 470.2L234.5 456.5L243 443.8", len: 79 },
    },
    {
      says: "9",
      pen: 9.4,
      kid: [
        { d: "M667.2 333.6L665.4 325L661.8 319.1L657.1 316.1L651.9 315L646.5 317.3L642.5 321.8L642.4 327.8L643.3 334.2L645.3 336.1L649.4 338.5L659.9 339.7L664.4 336.2L667.4 331.6L666.5 357.3L659.7 361L651.8 362L647.9 360.5L644.8 358.6L643 355.6", len: 133 },
      ],
      check: { d: "M686.8 340.4L692.5 346.6L699.1 354.9L706.8 340.2L720.1 319.6", len: 60 },
    },
    {
      says: "3 × 3 = 9",
      pen: 9.4,
      kid: [
        { d: "M86.9 733.8L90 731.8L94.6 730.9L99.6 730.9L103.5 732.1L108.2 734.7L111 738.5L110.8 745.2L109.9 748.2L108.2 749.7L101.5 753.2L95.6 753.7L95 752.5L101 754.4L105.3 757.3L107.6 762.9L107.1 767.7L103.6 772.8L97.5 776L88 776.7", len: 99 },
        { d: "M138.2 751.5L159.1 774.6", len: 31 },
        { d: "M159.1 751.5L138.2 774.6", len: 31 },
        { d: "M188.9 733.7L192.1 731.9L196.5 730.8L206.4 731.9L213.3 738.7L212.3 744.9L212.9 747.4L209.6 749.1L206.5 752.4L202.6 753.8L196.9 753.3L202.6 754.6L208.3 757.8L210.2 763.3L208.9 767.8L205.6 772.8L200.7 775.5L199.4 776.1L190 776.6", len: 100 },
        { d: "M241 756.9L266.3 756.3", len: 25 },
        { d: "M241 769L266.3 768.4", len: 25 },
        { d: "M322.3 753.5L320.5 745.1L316.8 739.3L315.8 738.5L311.7 735.6L306.9 735.5L302 737.9L298.4 742.1L296.7 747.2L297.9 753.8L306.1 759.1L315.4 759L319.9 756L322.4 752.9L321.3 776.6L318.7 779.2L311.5 782.4L306.8 782.1L302.8 780.6L300 778.4L298.1 775.5", len: 129 },
      ],
      check: { d: "M342.5 758.1L355.2 774.5L365.4 757.4L372.2 744.9L379.3 735.8", len: 66 },
    },
  ],
};

export const PHONE_SCENE: InkPictureScene = {
  image: "/landing/v3/devices-phone.webp",
  width: 390,
  height: 797,
  tutorPen: 1.5,
  lines: [
    {
      says: "70",
      pen: 1.3,
      kid: [
        { d: "M27.1 271.8L55.5 271.4L35.4 321.8", len: 83 },
        { d: "M78.9 271.4L85.3 273.8L89.9 281.2L92.1 291.2L91.7 300.9L89.8 311.7L86 316.8L79.3 321.9L73.1 318.8L68.6 310.7L66.4 301L65.7 291.4L66 288.8L67.6 281L71.7 274.7L72.2 274L73 273.6L78.9 271.4", len: 123 },
      ],
      check: { d: "M100.4 297.8L103.7 301.2L106.8 305.8L114.7 291.8L118.6 286.4", len: 33 },
    },
    {
      says: "97",
      pen: 3.7,
      kid: [
        { d: "M289.4 296.9L287.5 287.3L282.9 280.7L277.6 277.1L271.5 276.7L265.6 278L262.1 283.1L259.9 290.9L261.8 297.5L262.8 298.3L266 300.4L269.4 302.2L276.8 303.4L281.7 302.5L286.1 300.9L290.3 296.3L287.3 320.8L286.8 323.2L285.7 326.3L281.8 328.6L277.3 328.4L272.3 329.3L267.6 327.3L264.1 325.1L262 321.8", len: 148 },
        { d: "M304.4 270.7L335.2 271.6L313.2 323.8", len: 87 },
      ],
      check: { d: "M342.2 301.1L345.7 304.5L348.9 308.8L356.7 295.1L360.8 289.8", len: 33 },
    },
  ],
};
