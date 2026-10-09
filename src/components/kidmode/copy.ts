/**
 * Every word of the simple board. The dock's are for a 6-year-old: one short word under each picture,
 * read at a glance or not at all. The More card's are for the grown-up beside them.
 */
export const KID_COPY = {
  /** the switch in Board options and at the top of More */
  simpleBoard: "Simple board",
  simpleBoardHint: "Fewer, bigger buttons for young kids",
  /** the dock */
  dock: "Tools",
  pen: "Pen",
  eraser: "Eraser",
  undo: "Undo",
  colour: "Colour",
  colours: "Colours",
  colourName: {
    black: "Black",
    red: "Red",
    green: "Green",
    violet: "Purple",
  },
  /** pages: the board's screens (src/lib/screens), named as a kid names them */
  pages: "Pages",
  newPage: "New page",
  full: "This board is full",
  prev: "Page before",
  next: "Next page",
  pageOf: (index: number, count: number) => `Page ${index} of ${count}`,
  /** the bar */
  back: "Back to my boards",
  more: "More",
  moreHint: "More tools and settings, for grown-ups",
  moreTitle: "For grown-ups",
  close: "Close",
  newTopic: "New topic",
} as const;
