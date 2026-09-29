/**
 * A two-minute lecture to try lecture mode without a microphone (development only: the board page
 * exposes `window.__agathonLectureDemo()`, which plays it through the scripted speech source). It
 * walks through what the director should do: a sales chart that grows quarter by quarter (with a
 * correction and a value past the axis top), a split of revenue as a pie, a topic change, a process
 * told step by step (a flow that grows), a few dates (a timeline), and a closing line about
 * homework that should draw nothing.
 */
export const DEMO_LECTURE: ReadonlyArray<{ atMs: number; text: string }> = [
  { atMs: 0, text: "Good morning everyone. Today we're looking at how the company did this year, and then at how a product gets from an idea to launch." },
  { atMs: 7_000, text: "Let's start with sales. We'll go quarter by quarter, Q1 through Q4." },
  { atMs: 13_000, text: "In the first quarter, sales were 12 million dollars." },
  { atMs: 21_000, text: "Then in Q2, sales went up to 15 million." },
  { atMs: 29_000, text: "Q3 was tough. Sales fell to 9 million because of the supply problems." },
  { atMs: 37_000, text: "Actually, sorry, I misspoke earlier. Q2 was 16 million, not 15." },
  { atMs: 45_000, text: "And in Q4 we had our best quarter ever, 22 million dollars." },
  { atMs: 53_000, text: "So where did that money come from? Half of revenue, 50 percent, came from subscriptions, 30 percent from hardware, and 20 percent from services." },
  { atMs: 66_000, text: "Okay, let's switch topics to how a product actually gets built." },
  { atMs: 73_000, text: "First, the team does research to understand the customer." },
  { atMs: 81_000, text: "Next, they design a prototype." },
  { atMs: 89_000, text: "Then the prototype is tested with real users." },
  { atMs: 97_000, text: "After testing, they fix the problems they found." },
  { atMs: 105_000, text: "And finally, the product is launched." },
  { atMs: 113_000, text: "A quick bit of history to finish. The company was founded in 2008. In 2012 it released its first product." },
  { atMs: 122_000, text: "In 2016 it went public, and in 2021 it opened its first office in Europe." },
  { atMs: 131_000, text: "That's it for today. Homework is chapter four, due Friday." },
];
