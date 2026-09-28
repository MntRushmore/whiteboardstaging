/**
 * The words of the welcome and of the empty boards home, in one place so the two say the same
 * thing: what the product does, in two lines, and one next step.
 */
export const WELCOME_COPY = {
  kicker: "Welcome to Agathon Classroom",
  title: "The whiteboard that writes back.",
  /** what it does, in two lines */
  lines: ["Write maths by hand, one step per line.", "The tutor checks each step and answers in its own handwriting."],
  getStarted: "Get started",
  skip: "Skip for now",
  courseTitle: "Which course are you taking?",
  courseLede: "The tutor will write your first problem from it.",
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
