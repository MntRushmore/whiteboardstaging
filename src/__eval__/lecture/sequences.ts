/**
 * The lecture director eval's sequences (./live.ts `runSequences`): a lecture told over several
 * ticks, each tick what a tick carries (a sentence or two, every few seconds while anyone talks),
 * with the board's state carried from one tick to the next the way the desk keeps it — a new chart
 * or diagram gets a fixed id and comes back in `screen.active` with its spec as it now is; a
 * heading starts a new slide; a full slide (its bullets, or a second visual) goes on on the next
 * screen as "<title> (cont.)".
 *
 * Each tick says what it must do — start a visual (of these kinds), update a named one, leave every
 * live visual alone, or draw nothing at all — and what the named charts must show after it, label
 * by label (null: not said yet), or which steps and events a diagram must hold, in order.
 *
 * LIVE (`LECTURE_SEQUENCES`, round 2): charts and diagrams that grow; the owner's case first, sales
 * told quarter by quarter with a correction.
 *
 * SLIDES (`SLIDE_SEQUENCES`, round 4): a whole lecture built into a deck, tick by tick. Beside what
 * each tick does to the visuals, a tick may be due a new slide (`title`: the start, or a topic
 * change) and may make key points (`points`) that must become bullets; the filler ticks must draw
 * nothing. A business-school lecture on cold calling (the funnel, connect rates by day with a
 * correction, the five steps of a call, the three objections, calls vs emails) and a biology
 * lecture with no numbers at all (the heart: a picture, then the path of the blood).
 */
import type { LectureKind, LectureSubject } from "./snippets";

export type SequenceExpect =
  /** nothing at all (logistics, filler, an anecdote in the middle of a story) */
  | { none: true }
  /** no visual started or updated (bullets are fine) */
  | { keep: true }
  /** the visual named so (started by an earlier tick) updated, nothing new started */
  | { update: string }
  /** SLIDES: the visual named so may grow or be left alone (its detail may be a bullet instead); nothing new started */
  | { may: string }
  /** a new visual of one of these kinds, named so for the ticks after */
  | { start: string; kinds: LectureKind[]; also?: LectureKind[] };

export interface SequenceTick {
  fresh: string;
  expect: SequenceExpect;
  /** after this tick, what each named chart shows: label → number, or null for "not said yet" (other labels must be empty) */
  values?: Record<string, Record<string, number | null>>;
  /** after this tick, what each named diagram holds: patterns matched in order against its steps (or its events' dates, its spokes, its rows) */
  items?: Record<string, string[]>;
  /** SLIDES: a new slide is due on this tick (the start, or a topic change), its title matching this pattern */
  title?: string;
  /** SLIDES: the key points made on this tick, each a pattern a bullet must match (on this tick, or the next when the point runs on) */
  points?: string[];
}

export interface LectureSequence {
  id: string;
  subject: LectureSubject | "business";
  about: string;
  /** the screen's topic when the story begins (null: an empty screen, the lecture's first words) */
  topic: string | null;
  /** a slide deck, scored as one (./live.ts `scoreSlides`): titles, bullets, repeats, filler */
  slides?: true;
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

/** The five funnel stages, as the lecturer names them (null: not said yet). */
const funnel = (dials: number, connects: number | null, conversations: number | null, meetings: number | null, deals: number | null) => ({ Dials: dials, Connects: connects, Conversations: conversations, Meetings: meetings, Deals: deals });
/** Connect rates Monday to Friday (a working week: never a weekend nobody mentioned). */
const days = (mon: number, tue: number | null, wed: number | null, thu: number | null, fri: number | null) => ({ Monday: mon, Tuesday: tue, Wednesday: wed, Thursday: thu, Friday: fri });
const STEPS = ["open|intro|who", "reason|care|value|why", "discover|question", "objection", "close|meeting|ask"];

export const SLIDE_SEQUENCES: readonly LectureSequence[] = [
  {
    id: "slides-cold-calling",
    subject: "business",
    about: "a business-school lecture on cold calling, under 3 minutes in 29 ticks: 6 slides, 3 visuals that grow (a correction among them) and 2 more, 9 key points, 4 filler ticks",
    topic: null,
    slides: true,
    ticks: [
      // the subject: a title at once, then the points as they are made
      { fresh: "Okay, let's start. Today: cold calling in B2B sales, which many of you will do in your first job.", expect: { keep: true }, title: "cold call" },
      { fresh: "What is a cold call? Phoning a prospect who has never heard of you and hasn't asked to be contacted.", expect: { keep: true }, points: ["never (heard|asked)|not asked|hasn.t asked|unsolicited|no prior|stranger|unexpected|didn.t ask"] },
      { fresh: "People say cold calling is dead. It isn't: it's still the fastest way to start a conversation with a new buyer.", expect: { keep: true }, points: ["fastest|not dead|isn.t dead|still work|still the"] },
      { fresh: "Can everyone at the back hear me? Thumbs up. Great.", expect: { none: true } },
      // the funnel: a chart from its first number, the stages announced, then filled in
      {
        fresh: "First, the numbers: the cold calling funnel. Dials, connects, conversations, meetings, deals. A rep makes about 100 dials a day.",
        expect: { start: "funnel", kinds: ["bar", "line"] },
        title: "funnel",
        values: { funnel: funnel(100, null, null, null, null) },
      },
      { fresh: "Of those 100, about 25 connect: a real person picks up.", expect: { update: "funnel" }, values: { funnel: funnel(100, 25, null, null, null) } },
      { fresh: "Of those, maybe 10 become a real conversation, over a minute long.", expect: { update: "funnel" }, values: { funnel: funnel(100, 25, 10, null, null) } },
      { fresh: "Those 10 conversations book about 3 meetings, and on average 1 of them becomes a deal.", expect: { update: "funnel" }, values: { funnel: funnel(100, 25, 10, 3, 1) } },
      { fresh: "So it's a numbers game: a hundred dials for one deal. Hence daily activity targets.", expect: { keep: true }, points: ["numbers game|activity|target|per deal|for (one|1|a single) deal|dials for"], values: { funnel: funnel(100, 25, 10, 3, 1) } },
      { fresh: "Sorry, that's my phone, let me just silence it. Okay, right.", expect: { none: true } },
      // connect rates by day: a chart for a working week, filled in, then a correction
      {
        fresh: "Next: when should you call? Connect rates by day of the week. Monday is 11 percent.",
        expect: { start: "days", kinds: ["bar", "line"] },
        title: "day|when|timing|time to call|connect rate|best time",
        values: { days: days(11, null, null, null, null) },
      },
      { fresh: "Tuesday is 14 percent, and Wednesday is the best day at 16 percent.", expect: { update: "days" }, values: { days: days(11, 14, 16, null, null) } },
      { fresh: "Thursday drops back to 12 percent, and Friday is the worst, just 8 percent.", expect: { update: "days" }, values: { days: days(11, 14, 16, 12, 8) } },
      { fresh: "Sorry, correction: Wednesday was 15 percent, not 16. Still the best day.", expect: { update: "days" }, values: { days: days(11, 14, 15, 12, 8) } },
      {
        fresh: "So call mid-week, Tuesday to Thursday, and avoid Friday afternoons, when people are wrapping up.",
        expect: { keep: true },
        points: ["mid.?week|tue", "friday"],
        values: { days: days(11, 14, 15, 12, 8) },
      },
      // the five steps of a call: a flow that grows step by step
      { fresh: "Now the call itself. A good cold call has five steps, in order.", expect: { keep: true }, title: "call|step|structure|anatomy|script" },
      { fresh: "Step one, the opener: who you are and why you're calling. Step two, a reason to care.", expect: { start: "steps", kinds: ["flow"] }, items: { steps: STEPS.slice(0, 2) } },
      { fresh: "Step three is discovery: ask open questions about how they handle this today.", expect: { update: "steps" }, items: { steps: STEPS.slice(0, 3) } },
      { fresh: "Step four is handling objections, which we'll come back to in a minute.", expect: { update: "steps" }, items: { steps: STEPS.slice(0, 4) } },
      { fresh: "And step five, the close: ask for a specific meeting time, never a vague follow-up.", expect: { update: "steps" }, items: { steps: STEPS }, points: ["specific|vague|exact|time"] },
      // the three objections: a visual of the three, each answer a bullet
      {
        fresh: "Okay, objections. You'll hear three. First, 'I'm not interested'. Second, 'just send me an email'.",
        expect: { start: "objections", kinds: ["hub", "tree", "table"] },
        title: "objection",
        items: { objections: ["interest", "email"] },
      },
      { fresh: "For 'not interested', don't argue. Ask what they use today, which keeps the conversation going.", expect: { may: "objections" }, points: ["argue|use|using|today|current"] },
      { fresh: "'Send me an email' is usually a brush-off. Agree, but ask one question first so it's relevant.", expect: { may: "objections" }, points: ["brush|one question|relevant"] },
      { fresh: "The third: 'we already have a supplier'. Fine, ask what they'd change about them if they could.", expect: { update: "objections" }, items: { objections: ["interest", "email", "supplier|vendor|provider|already have"] } },
      { fresh: "Someone once hung up on me four times in one morning. Character building.", expect: { none: true } },
      // calls vs emails: a comparison, then the advice as bullets
      {
        fresh: "Finally, calls versus cold emails. Email scales to hundreds a day, but few reply. A call gets a real conversation, but you make far fewer.",
        expect: { start: "versus", kinds: ["table", "venn"] },
        title: "email",
      },
      { fresh: "Emails are easy to ignore; a call is harder to ignore, and you hear their tone of voice.", expect: { may: "versus" } },
      { fresh: "My advice: use both. Email first to warm them up, then call two days later, mentioning it.", expect: { may: "versus" }, points: ["both|email first|warm|then call"] },
      { fresh: "That's all for today. For next week, read chapter 4 and do twenty practice dials.", expect: { none: true } },
    ],
  },
  {
    id: "slides-heart",
    subject: "biology",
    about: "a biology lecture with no numbers, 11 ticks: a picture of the heart and its parts as bullets, then the path of the blood as a flow that grows",
    topic: null,
    slides: true,
    ticks: [
      { fresh: "Right, today we're on the heart, and how it pumps blood around the body.", expect: { keep: true }, title: "heart" },
      {
        fresh: "The heart is a muscle about the size of your fist. Inside, it has four chambers: two atria at the top, and two ventricles underneath.",
        expect: { start: "heart", kinds: ["sketch", "hub", "tree"] },
        points: ["muscle|fist"],
      },
      { fresh: "Down the middle runs a thick wall of muscle, the septum, and the left ventricle has the thickest wall of all, because it pumps blood to the whole body.", expect: { may: "heart" }, points: ["left ventricle|thickest"] },
      { fresh: "Between the chambers there are valves, little flaps that stop the blood flowing backwards.", expect: { may: "heart" }, points: ["valve"] },
      { fresh: "Is that clear at the back? Good. Grab some water if you need it.", expect: { none: true } },
      {
        fresh: "Next topic: the path the blood takes through the heart. Blood from the body comes back into the right atrium, then drops into the right ventricle.",
        expect: { start: "path", kinds: ["flow", "cycle"] },
        title: "blood|path|flow|circulation|route|journey",
        items: { path: ["right atrium", "right ventricle"] },
      },
      { fresh: "The right ventricle pumps it to the lungs, where it picks up oxygen and gets rid of carbon dioxide.", expect: { update: "path" }, items: { path: ["right atrium", "right ventricle", "lung"] }, points: ["oxygen"] },
      { fresh: "From the lungs it comes back into the left atrium, and then down into the left ventricle.", expect: { update: "path" }, items: { path: ["right atrium", "right ventricle", "lung", "left atrium", "left ventricle"] } },
      { fresh: "And the left ventricle pumps it out through the aorta to the rest of the body, and round it goes again.", expect: { update: "path" }, items: { path: ["right atrium", "right ventricle", "lung", "left atrium", "left ventricle", "aorta|body"] } },
      { fresh: "That's why we call it a double circulation: the blood goes through the heart twice on every trip round the body.", expect: { keep: true }, points: ["double|twice"] },
      { fresh: "Okay, homework: label the diagram on page 62, and bring your lab coats on Friday.", expect: { none: true } },
    ],
  },
];
