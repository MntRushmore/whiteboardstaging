/**
 * The lecture director eval's LIVE sequences (./run.ts `runSequences`): a lecture told over several
 * ticks, each tick a sentence or two (what a live tick carries, every ~8 s while numbers or steps
 * are coming), with the board's state carried from one tick to the next the way the desk keeps it
 * — a new chart or diagram gets a fixed id and comes back in `screen.active` with its spec as it
 * now is; a heading starts a new screen.
 *
 * Each tick says what it must do — start a visual (of these kinds), update a named one, or leave
 * every live visual alone — and what the named charts must show after it, label by label (null:
 * not said yet), or which steps and events a diagram must hold, in order. The owner's case comes
 * first: sales told quarter by quarter, with a correction.
 */
import type { LectureKind, LectureSubject } from "./snippets";

export type SequenceExpect =
  /** nothing at all (logistics in the middle of a story) */
  | { none: true }
  /** no chart or diagram started or updated (a note may be fine) */
  | { keep: true }
  /** the visual named so (started by an earlier tick) updated, nothing new started */
  | { update: string }
  /** a new chart or diagram of one of these kinds, named so for the ticks after */
  | { start: string; kinds: LectureKind[]; also?: LectureKind[] };

export interface SequenceTick {
  fresh: string;
  expect: SequenceExpect;
  /** after this tick, what each named chart shows: label → number, or null for "not said yet" (other labels must be empty) */
  values?: Record<string, Record<string, number | null>>;
  /** after this tick, what each named diagram holds: patterns matched in order against its steps (or its events' dates) */
  items?: Record<string, string[]>;
}

export interface LectureSequence {
  id: string;
  subject: LectureSubject | "business";
  about: string;
  /** the screen's topic when the story begins */
  topic: string;
  ticks: SequenceTick[];
}

export const LECTURE_SEQUENCES: readonly LectureSequence[] = [
  {
    id: "seq-sales",
    subject: "business",
    about: "sales quarter by quarter, with a correction (the owner's case)",
    topic: "Annual Review",
    ticks: [
      {
        fresh: "Let's go through last year's sales, quarter by quarter, all four quarters. In the first quarter we sold 12 million dollars' worth.",
        expect: { start: "sales", kinds: ["bar", "line"] },
        values: { sales: { Q1: 12, Q2: null, Q3: null, Q4: null } },
      },
      { fresh: "Then in Q2 sales went up to 15 million.", expect: { update: "sales" }, values: { sales: { Q1: 12, Q2: 15, Q3: null, Q4: null } } },
      { fresh: "Q3 was our best quarter, 21 million, thanks to the summer launch.", expect: { update: "sales" }, values: { sales: { Q1: 12, Q2: 15, Q3: 21, Q4: null } } },
      { fresh: "Actually, let me correct myself: the second quarter was 16 million, not 15.", expect: { update: "sales" }, values: { sales: { Q1: 12, Q2: 16, Q3: 21, Q4: null } } },
      { fresh: "And the fourth quarter came in at 18 million, so we finished the year strong.", expect: { update: "sales" }, values: { sales: { Q1: 12, Q2: 16, Q3: 21, Q4: 18 } } },
    ],
  },
  {
    id: "seq-web",
    subject: "cs",
    about: "a process told step by step (a flow that grows)",
    topic: "How the Web Works",
    ticks: [
      { fresh: "So what actually happens when you type a web address into your browser and hit enter? Let's walk through it, one step at a time.", expect: { none: true } },
      {
        fresh: "First, the browser asks a DNS server for the site's IP address. Once it has the address, it opens a TCP connection to the server.",
        expect: { start: "web", kinds: ["flow"] },
        items: { web: ["dns", "tcp|connect"] },
      },
      { fresh: "Then it sends an HTTP request asking for the page.", expect: { update: "web" }, items: { web: ["dns", "tcp|connect", "http|request"] } },
      { fresh: "The server handles the request and sends back a response with the HTML.", expect: { update: "web" }, items: { web: ["dns", "tcp|connect", "http|request", "respon|html|server"] } },
      { fresh: "Finally, the browser renders the page on your screen.", expect: { update: "web" }, items: { web: ["dns", "tcp|connect", "http|request", "respon|html|server", "render|display|show"] } },
    ],
  },
  {
    id: "seq-space",
    subject: "history",
    about: "a timeline that grows",
    topic: "The Space Race",
    ticks: [
      {
        fresh: "The space race really begins in 1957, when the Soviet Union launches Sputnik, the first satellite. Four years later, in 1961, Yuri Gagarin becomes the first human in space.",
        expect: { start: "space", kinds: ["timeline"] },
        items: { space: ["1957", "1961"] },
      },
      { fresh: "The Americans answer in 1962, when John Glenn orbits the Earth.", expect: { update: "space" }, items: { space: ["1957", "1961", "1962"] } },
      { fresh: "And then, of course, in July 1969, Apollo 11 lands on the Moon.", expect: { update: "space" }, items: { space: ["1957", "1961", "1962", "1969"] } },
    ],
  },
  {
    id: "seq-switch",
    subject: "economics",
    about: "the topic switches mid-story (a new chart, the first untouched)",
    topic: "The Labour Market",
    ticks: [
      {
        fresh: "Let's look at the unemployment rate over the last three years. In 2021 it was 4.5 percent, and in 2022 it fell to 3.7 percent.",
        expect: { start: "jobs", kinds: ["line", "bar"] },
        values: { jobs: { 2021: 4.5, 2022: 3.7 } },
      },
      { fresh: "And in 2023 it rose slightly, to 4.0 percent.", expect: { update: "jobs" }, values: { jobs: { 2021: 4.5, 2022: 3.7, 2023: 4.0 } } },
      {
        fresh: "Okay, now a different measure altogether: inflation. Inflation was 4.7 percent in 2021 and shot up to 8.0 percent in 2022.",
        expect: { start: "prices", kinds: ["line", "bar"], also: ["heading"] },
        values: { jobs: { 2021: 4.5, 2022: 3.7, 2023: 4.0 }, prices: { 2021: 4.7, 2022: 8.0 } },
      },
      { fresh: "And in 2023 inflation came back down to 4.1 percent.", expect: { update: "prices" }, values: { jobs: { 2021: 4.5, 2022: 3.7, 2023: 4.0 }, prices: { 2021: 4.7, 2022: 8.0, 2023: 4.1 } } },
    ],
  },
  {
    id: "seq-aside",
    subject: "business",
    about: "unrelated numbers mid-story (the chart not corrupted)",
    topic: "App Growth",
    ticks: [
      { fresh: "Here's how sign-ups for the new app grew. In January we had 120 sign-ups, and in February 150.", expect: { start: "signups", kinds: ["bar", "line"] }, values: { signups: { Jan: 120, Feb: 150 } } },
      { fresh: "Quick reminder, the lab is in room 204 this week, and we finish at 4 30 today.", expect: { none: true }, values: { signups: { Jan: 120, Feb: 150 } } },
      { fresh: "Back to the app: in March sign-ups jumped to 210.", expect: { update: "signups" }, values: { signups: { Jan: 120, Feb: 150, Mar: 210 } } },
      { fresh: "By the way, the app store takes a 30 percent cut of every sale, which is a lot.", expect: { keep: true }, values: { signups: { Jan: 120, Feb: 150, Mar: 210 } } },
      { fresh: "And April was 260.", expect: { update: "signups" }, values: { signups: { Jan: 120, Feb: 150, Mar: 210, Apr: 260 } } },
    ],
  },
];
