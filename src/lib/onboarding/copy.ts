/**
 * The words of the welcome and of the empty boards home, in one place so the two say the same
 * thing: what the product does, in two lines, and one next step. The second step asks for the
 * grade first, in words a six-year-old can read (a grown-up often sets it up beside them), and
 * then, for the grown-up, where they heard of us.
 */
export const WELCOME_COPY = {
  kicker: "Welcome to Agathon",
  title: "The whiteboard that writes back.",
  /** what it does, in two lines */
  lines: ["Write your math by hand, one step on each line.", "Your tutor checks every step and cheers you on."],
  /** under the buttons: we are in beta, and where to tell us about a bug */
  beta: "Agathon is brand new and still in beta. If something looks wrong, tap Report a bug at the top. We read every report.",
  getStarted: "Let's go",
  skip: "Skip for now",
  gradeStep: "Your grade",
  gradeTitle: "What grade are you in?",
  gradeLede: "Your tutor picks problems just right for you.",
  gradesLabel: "Grades",
  highSchool: "In high school?",
  /** optional, for the grown-up: never blocks Start */
  heardTitle: "How did you hear about Agathon?",
  heardHint: "Optional, for grown-ups.",
  back: "Back",
  start: "Start",
  starting: "Opening your board…",
  createFailed: "Couldn't create your board",
} as const;

/** Alt text for the product pictures in `public/login/` (shared with the sign-in page's panel). */
export const PRODUCT_PICTURES = {
  solved: {
    src: "/login/solved-lines.webp",
    alt: "Two lines a student wrote, y = 2x + 1 and y = −x + 4, solved step by step and graphed by the tutor in handwriting, crossing at (1, 3).",
    width: 1150,
    height: 832,
  },
  checked: {
    src: "/login/checked-steps.webp",
    alt: "A student's steps, 2x = 8 and x = 4, each ticked by the tutor.",
    width: 582,
    height: 400,
  },
} as const;
