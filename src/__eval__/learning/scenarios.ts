/**
 * The learning tracker's parity scenarios (the iPad's `AttemptTracker` in Swift against the web's,
 * `src/lib/learning/tracker.ts`): board-event sequences as `LiveLoop` emits them, with the tracker's
 * own moments between them (`tick`, a save that goes through or fails, the board left and opened
 * again). `tracker.golden.test.ts` runs each through the web tracker — the real skill classifier,
 * the real mistake classifier on the real engine — and writes what it published, saved and kept;
 * the Swift tests (`ios/Packages/AgathonLive/Tests/AgathonLiveTests/LearningParityTests.swift`) run
 * the same steps through the Swift tracker and compare.
 *
 * Every rule in the tracker's header has a scenario here: how an attempt starts (a line, a problem,
 * the tutor solving one), outcomes recomputed from the counts (a ring or help after the answer),
 * `finishedAt`, counts per distinct line, local and model mistakes, active time and its caps, help
 * before its problem, screens, the board closed, idle attempts, what is never recorded, saving and
 * its failures, and coming back to a board.
 */
import type { CourseId } from "@/lib/onboarding/courseIds";
import type { AttemptOrigin, LearningSignal, LineMark } from "@/lib/learning/contracts";
import type { MistakeKind } from "@/lib/learning/hint";

export type Step =
  | { kind: "signal"; signal: LearningSignal }
  /** `tracker.tick(at)` (the runtime's minute clock) */
  | { kind: "tick"; at: number }
  /** `tracker.flush()` with the store answering this way */
  | { kind: "flush"; result: "ok" | "invalid" | "network" | "unauthorized" }
  /** the board left and opened again: `snapshot` → JSON → a new tracker's `restore` */
  | { kind: "reopen" };

export interface Scenario {
  name: string;
  course: CourseId | null;
  steps: Step[];
}

export const BOARD = "5d0c6f1a-2b3c-4d5e-8f60-0123456789ab";
export const OTHER_BOARD = "6e1d7a2b-3c4d-4e5f-8a61-123456789abc";
export const PAGE = "screen:p1";
export const PAGE2 = "screen:p2";
export const T0 = Date.parse("2026-10-18T15:00:00.000Z");

/** An attempt id as the tracker makes them (`newId`): uuid v4 shaped, numbered. */
export function attemptId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** `s` seconds after T0, to the millisecond (odd milliseconds on purpose: the ISO times carry them). */
const at = (s: number) => T0 + Math.round(s * 1000);

const ink = (head: string, page = PAGE) => `${page}#ink:${head}`;
const cell = (block: string, page = PAGE) => `${page}#cell:${block}`;
const teach = (seed: string, page = PAGE) => `${page}#teach:${seed}`;

interface LineOpts {
  page?: string;
  board?: string;
  problem?: string[];
  kind?: string;
  previous?: string;
  solved?: boolean;
}

function line(s: number, key: string, lineId: string, latex: string, mark: LineMark, o: LineOpts = {}): Step {
  return {
    kind: "signal",
    signal: {
      type: "line",
      at: at(s),
      boardId: o.board ?? BOARD,
      pageId: o.page ?? PAGE,
      problemKey: key,
      problemLatex: o.problem ?? [],
      lineId,
      latex,
      kind: (o.kind ?? "equation") as never,
      ...(o.previous !== undefined ? { previousLatex: o.previous } : {}),
      mark,
      solved: o.solved ?? false,
    },
  };
}

function problem(s: number, key: string, lines: string[], origin: AttemptOrigin, o: { page?: string; board?: string; parentId?: string } = {}): Step {
  return {
    kind: "signal",
    signal: {
      type: "problem",
      at: at(s),
      boardId: o.board ?? BOARD,
      pageId: o.page ?? PAGE,
      problemKey: key,
      problemLatex: lines,
      origin,
      ...(o.parentId ? { parentId: o.parentId } : {}),
    },
  };
}

function help(s: number, key: string, kind: "hint" | "next_step" | "solve" | "ask", auto = false): Step {
  return { kind: "signal", signal: { type: "help", at: at(s), problemKey: key, help: kind, auto } };
}

function mistake(s: number, key: string, lineId: string, kind: MistakeKind, source: "model" | "local" = "model"): Step {
  return { kind: "signal", signal: { type: "mistake", at: at(s), problemKey: key, lineId, kind, source } };
}

function tutorSolved(s: number, key: string, lines: string[], o: { page?: string; board?: string; origin?: AttemptOrigin } = {}): Step {
  return {
    kind: "signal",
    signal: {
      type: "tutor_solved",
      at: at(s),
      boardId: o.board ?? BOARD,
      pageId: o.page ?? PAGE,
      problemKey: key,
      problemLatex: lines,
      ...(o.origin ? { origin: o.origin } : {}),
    },
  };
}

const screen = (s: number, page: string, board = BOARD): Step => ({ kind: "signal", signal: { type: "screen", at: at(s), boardId: board, pageId: page } });
const closed = (s: number, board = BOARD): Step => ({ kind: "signal", signal: { type: "closed", at: at(s), boardId: board } });
const tick = (s: number): Step => ({ kind: "tick", at: at(s) });
const flush = (result: "ok" | "invalid" | "network" | "unauthorized" = "ok"): Step => ({ kind: "flush", result });
const reopen: Step = { kind: "reopen" };

/** The student's own two-step equation, head line first. */
const HEAD = "2x+3=11";
const P = ["2x+3=11"];

export function scenarios(): Scenario[] {
  const K = ink("ln_head");
  return [
    {
      name: "first try: solved with no ring and no help",
      course: "algebra1",
      steps: [
        line(0, K, "ln_head", HEAD, null, { problem: P }),
        line(10.25, K, "ln_b", "2x=8", "check", { problem: P, previous: HEAD }),
        line(20.5, K, "ln_c", "x=4", "check", { problem: P, previous: "2x=8", solved: true }),
        flush(),
      ],
    },
    {
      name: "self-corrected: a ring classified locally, then the fix",
      course: "algebra1",
      steps: [
        line(0, K, "ln_head", HEAD, null, { problem: P }),
        line(12.003, K, "ln_b", "2x=14", "circle", { problem: P, previous: HEAD }),
        line(30, K, "ln_c", "2x=8", "check", { problem: P, previous: HEAD }),
        line(41, K, "ln_d", "x=4", "check", { problem: P, previous: "2x=8", solved: true }),
        flush(),
      ],
    },
    {
      name: "a model mistake wins over the local one for the same read",
      course: "algebra1",
      steps: [
        line(0, K, "ln_head", "3x+5=20", null, { problem: ["3x+5=20"] }),
        mistake(5, K, "ln_b", "arithmetic"),
        line(8, K, "ln_b", "3x=25", "circle", { problem: ["3x+5=20"], previous: "3x+5=20" }),
        mistake(9, K, "ln_b", "concept"),
        mistake(9.5, K, "ln_b", "sign", "local"),
        line(20, K, "ln_b", "3x=15", "check", { problem: ["3x+5=20"], previous: "3x+5=20" }),
        mistake(21, K, "ln_b", "arithmetic", "local"),
        line(30, K, "ln_c", "x=5", "check", { problem: ["3x+5=20"], previous: "3x=15", solved: true }),
      ],
    },
    {
      name: "a line read again with the same mistake counts it once; another kind adds one",
      course: null,
      steps: [
        line(0, K, "ln_head", "4x-7=9", null, { problem: ["4x-7=9"] }),
        line(10, K, "ln_b", "4x=2", "circle", { problem: ["4x-7=9"], previous: "4x-7=9" }),
        line(20, K, "ln_b", "4x=2 ", "circle", { problem: ["4x-7=9"], previous: "4x-7=9" }),
        mistake(21, K, "ln_b", "sign"),
        line(30, K, "ln_b", "4x=17", "circle", { problem: ["4x-7=9"], previous: "4x-7=9" }),
        mistake(31, K, "ln_b", "arithmetic"),
        line(40, K, "ln_c", "4x=16", "check", { problem: ["4x-7=9"], previous: "4x-7=9" }),
        line(50, K, "ln_d", "x=4", "check", { problem: ["4x-7=9"], previous: "4x=16", solved: true }),
      ],
    },
    {
      name: "with help: a hint and the tutor's step, then the student's answer",
      course: "algebra1",
      steps: [
        line(0, K, "ln_head", HEAD, null, { problem: P }),
        help(5, K, "ask"),
        help(5.5, K, "hint"),
        line(20, K, "ln_b", "2x=8", "check", { problem: P, previous: HEAD }),
        help(40, K, "next_step", true),
        line(60, K, "ln_c", "x=4", "check", { problem: P, previous: "2x=8", solved: true }),
        flush(),
      ],
    },
    {
      name: "the tutor solves it: tutor_solved, and the student's answer after it stays the tutor's",
      course: "algebra1",
      steps: [
        line(0, K, "ln_head", "5x+2=17", null, { problem: ["5x+2=17"] }),
        help(3, K, "ask"),
        help(3.5, K, "solve"),
        tutorSolved(3.5, K, ["5x+2=17"]),
        line(30, K, "ln_b", "x=3", "check", { problem: ["5x+2=17"], previous: "5x+2=17", solved: true }),
        flush(),
      ],
    },
    {
      name: "answered first, then the tutor's solve: still the student's, now with help",
      course: "algebra1",
      steps: [
        line(0, K, "ln_head", HEAD, null, { problem: P }),
        line(10, K, "ln_b", "x=4", "check", { problem: P, previous: HEAD, solved: true }),
        help(20, K, "solve"),
        tutorSolved(20, K, P),
      ],
    },
    {
      name: "a ring after the answer: first try becomes self-corrected, finishedAt stays",
      course: "algebra1",
      steps: [
        line(0, K, "ln_head", HEAD, null, { problem: P }),
        line(10, K, "ln_b", "x=4", "check", { problem: P, previous: HEAD, solved: true }),
        line(25, K, "ln_c", "x+1=6", "circle", { problem: P, previous: "x=4" }),
        flush(),
      ],
    },
    {
      name: "unfinished, then answered on coming back: finishedAt moves to the answer",
      course: "algebra1",
      steps: [
        line(0, K, "ln_head", HEAD, null, { problem: P }),
        line(10, K, "ln_b", "2x=8", "check", { problem: P, previous: HEAD }),
        screen(20, PAGE2),
        screen(200, PAGE),
        line(210, K, "ln_c", "x=4", "check", { problem: P, previous: "2x=8", solved: true }),
      ],
    },
    {
      name: "a chat problem: given, the student's lines under it, a Now you try after it",
      course: "algebra1",
      steps: [
        problem(0, cell("hb_1"), ["3x-4=11"], "tutor_problem"),
        line(15, cell("hb_1"), "ln_a", "3x=15", "check", { problem: ["3x-4=11"], previous: "3x-4=11" }),
        line(25, cell("hb_1"), "ln_b", "x=6", "circle", { problem: ["3x-4=11"], previous: "3x=15" }),
        help(30, cell("hb_1"), "next_step"),
        line(45, cell("hb_1"), "ln_c", "x=5", "check", { problem: ["3x-4=11"], previous: "3x=15", solved: true }),
        problem(60, cell("hb_2"), ["4x-3=13"], "now_you_try", { parentId: attemptId(1) }),
        line(70, cell("hb_2"), "ln_d", "4x=16", "check", { problem: ["4x-3=13"], previous: "4x-3=13" }),
        line(80, cell("hb_2"), "ln_e", "x=4", "check", { problem: ["4x-3=13"], previous: "4x=16", solved: true }),
        flush(),
      ],
    },
    {
      name: "a practice set: a problem written and never touched is never recorded",
      course: null,
      steps: [
        problem(0, cell("hb_a"), ["7+5"], "practice"),
        problem(0.2, cell("hb_b"), ["9+8"], "practice"),
        problem(0.4, cell("hb_c"), ["6+7"], "practice"),
        line(10, cell("hb_a"), "ln_1", "12", "check", { problem: ["7+5"], kind: "expression", previous: "7+5", solved: true }),
        line(20, cell("hb_b"), "ln_2", "18", "circle", { problem: ["9+8"], kind: "expression", previous: "9+8" }),
        line(28, cell("hb_b"), "ln_2", "17", "check", { problem: ["9+8"], kind: "expression", previous: "9+8", solved: true }),
        closed(40),
        flush(),
      ],
    },
    {
      name: "a problem known by its cell before its problem signal (a reload): tutor_problem, then given",
      course: "algebra1",
      steps: [
        line(0, cell("hb_9"), "ln_a", "2x=10", "check", { problem: ["2x+1=11"], previous: "2x+1=11" }),
        problem(1, cell("hb_9"), ["2x+1=11"], "practice"),
        line(9, cell("hb_9"), "ln_b", "x=5", "check", { problem: ["2x+1=11"], previous: "2x=10", solved: true }),
      ],
    },
    {
      name: "taught: a worked solution the chat wrote",
      course: "algebra1",
      steps: [
        problem(0, teach("s1"), ["x^{2}-5x+6=0"], "teach"),
        help(0, teach("s1"), "solve"),
        tutorSolved(0, teach("s1"), ["x^{2}-5x+6=0"], { origin: "teach" }),
        flush(),
      ],
    },
    {
      name: "the tutor solves a problem it does not know yet (a line never sent)",
      course: "geometry",
      steps: [tutorSolved(0, cell("hb_x"), ["a^{2}+b^{2}=c^{2}", "a=3", "b=4"]), help(0.5, cell("hb_x"), "solve"), flush()],
    },
    {
      name: "help before the problem's first line is kept and counted; old help is not",
      course: "algebra1",
      steps: [
        help(0, K, "ask"),
        help(1, K, "hint"),
        help(2, ink("ln_other"), "hint"),
        line(30, K, "ln_head", HEAD, null, { problem: P }),
        help(400, ink("ln_late"), "ask"),
        line(600, ink("ln_late"), "ln_late", "x+2=5", null, { problem: ["x+2=5"] }),
        line(610, ink("ln_late"), "ln_l2", "x=3", "check", { problem: ["x+2=5"], previous: "x+2=5", solved: true }),
      ],
    },
    {
      name: "labels and scratch the tutor never judged: never recorded, forgotten when closed",
      course: null,
      steps: [
        line(0, ink("ln_lab"), "ln_lab", "\\text{Q3}", null, { problem: ["\\text{Q3}"], kind: "label" }),
        line(5, ink("ln_lab"), "ln_scr", "12", null, { problem: ["\\text{Q3}"], kind: "expression" }),
        screen(10, PAGE2),
        line(20, ink("ln_lab"), "ln_scr2", "13", "check", { problem: ["\\text{Q3}"], kind: "expression", page: PAGE }),
      ],
    },
    {
      name: "active time: gaps capped at two minutes, time on another problem not counted",
      course: "algebra1",
      steps: [
        line(0, K, "ln_head", HEAD, null, { problem: P }),
        line(30, K, "ln_b", "2x=8", "check", { problem: P, previous: HEAD }),
        line(40, ink("ln_q2"), "ln_q2", "5x=20", null, { problem: ["5x=20"] }),
        line(100, ink("ln_q2"), "ln_q2b", "x=4", "check", { problem: ["5x=20"], previous: "5x=20", solved: true }),
        line(130, K, "ln_c", "x=4", "check", { problem: P, previous: "2x=8", solved: true }),
        line(900, K, "ln_d", "4=4", "check", { problem: P, previous: "x=4" }),
      ],
    },
    {
      name: "the same line again changes nothing and does not open a closed attempt",
      course: "algebra1",
      steps: [
        line(0, K, "ln_head", HEAD, null, { problem: P }),
        line(10, K, "ln_b", "2x=8", "check", { problem: P, previous: HEAD }),
        line(11, K, "ln_b", "2x=8", "check", { problem: P, previous: HEAD }),
        screen(20, PAGE2),
        line(30, K, "ln_b", "2x=8", "check", { problem: P, previous: HEAD }),
        line(40, K, "ln_b", "2x=8", null, { problem: P, previous: HEAD }),
      ],
    },
    {
      name: "the student's head line read again: the problem and its skill follow it",
      course: "algebra1",
      steps: [
        line(0, K, "ln_head", "2x+3=11", null, { problem: ["2x+3=11"] }),
        line(10, K, "ln_b", "2x=8", "check", { problem: ["2x+3=11"], previous: "2x+3=11" }),
        line(20, K, "ln_head", "x^{2}+3=12", null, { problem: ["x^{2}+3=12"] }),
        line(30, K, "ln_c", "x^{2}=9", "check", { problem: ["x^{2}+3=12"], previous: "x^{2}+3=12" }),
      ],
    },
    {
      name: "idle: closed after thirty minutes, opened again by a new line",
      course: "algebra1",
      steps: [
        line(0, K, "ln_head", HEAD, null, { problem: P }),
        line(10, K, "ln_b", "2x=8", "check", { problem: P, previous: HEAD }),
        tick(60),
        tick(1809),
        tick(1810),
        line(1900, K, "ln_c", "x=4", "check", { problem: P, previous: "2x=8", solved: true }),
        tick(4000),
      ],
    },
    {
      name: "the board closed: open attempts end unfinished; another board's are left alone",
      course: "algebra1",
      steps: [
        line(0, K, "ln_head", HEAD, null, { problem: P }),
        line(10, K, "ln_b", "2x=8", "check", { problem: P, previous: HEAD }),
        line(12, ink("ln_o", PAGE), "ln_o", "3+4", "check", { problem: ["3+4"], kind: "expression", board: OTHER_BOARD }),
        closed(20),
        flush(),
      ],
    },
    {
      name: "a system: its lines joined, classified as one problem",
      course: "algebra1",
      steps: [
        problem(0, cell("hb_s"), ["x+y=10", "x-y=2"], "tutor_problem"),
        line(20, cell("hb_s"), "ln_1", "2x=12", "check", { problem: ["x+y=10", "x-y=2"], previous: "x-y=2" }),
        line(30, cell("hb_s"), "ln_2", "x=6", "check", { problem: ["x+y=10", "x-y=2"], previous: "2x=12" }),
        line(40, cell("hb_s"), "ln_3", "y=4", "check", { problem: ["x+y=10", "x-y=2"], previous: "x=6", solved: true }),
      ],
    },
    {
      name: "a long problem is cut to 500 characters",
      course: null,
      steps: [
        line(0, ink("ln_long"), "ln_long", `${"1+".repeat(300)}1`, null, { problem: [`${"1+".repeat(300)}1`], kind: "expression" }),
        line(5, ink("ln_long"), "ln_l2", "301", "check", { problem: [`${"1+".repeat(300)}1`], kind: "expression", solved: true }),
      ],
    },
    {
      name: "saving: a failure a retry can fix keeps them pending; one refused as invalid is dropped",
      course: "algebra1",
      steps: [
        line(0, K, "ln_head", HEAD, null, { problem: P }),
        line(10, K, "ln_b", "2x=8", "check", { problem: P, previous: HEAD }),
        flush("network"),
        line(20, K, "ln_c", "x=4", "check", { problem: P, previous: "2x=8", solved: true }),
        flush("unauthorized"),
        flush("ok"),
        line(30, ink("ln_q"), "ln_q", "6x=18", null, { problem: ["6x=18"] }),
        line(31, ink("ln_q"), "ln_q2", "x=3", "check", { problem: ["6x=18"], previous: "6x=18", solved: true }),
        flush("invalid"),
        flush("ok"),
      ],
    },
    {
      name: "coming back to the board goes on with the same attempt",
      course: "algebra1",
      steps: [
        line(0, K, "ln_head", HEAD, null, { problem: P }),
        line(10, K, "ln_b", "2x=14", "circle", { problem: P, previous: HEAD }),
        help(12, K, "hint"),
        closed(20),
        flush(),
        reopen,
        line(500, K, "ln_c", "2x=8", "check", { problem: P, previous: HEAD }),
        line(510, K, "ln_d", "x=4", "check", { problem: P, previous: "2x=8", solved: true }),
        flush(),
        reopen,
        help(600, K, "ask"),
      ],
    },
    {
      name: "a ring under a ringed line is the student correcting it: no local mistake for the fix",
      course: "algebra1",
      steps: [
        line(0, K, "ln_head", "3x+6=21", null, { problem: ["3x+6=21"] }),
        line(10, K, "ln_b", "3x=27", "circle", { problem: ["3x+6=21"], previous: "3x+6=21" }),
        line(20, K, "ln_c", "x=9", "circle", { problem: ["3x+6=21"], previous: "3x=27" }),
        line(30, K, "ln_d", "3x=15", "check", { problem: ["3x+6=21"], previous: "3x+6=21" }),
      ],
    },
    {
      name: "mistakes the local classifier names across kinds",
      course: "algebra1",
      steps: [
        line(0, ink("m1"), "m1", "3(x+2)=18", null, { problem: ["3(x+2)=18"] }),
        line(5, ink("m1"), "m1b", "3x+2=18", "circle", { problem: ["3(x+2)=18"], previous: "3(x+2)=18" }),
        line(10, ink("m2"), "m2", "x+5=9", null, { problem: ["x+5=9"] }),
        line(15, ink("m2"), "m2b", "x=14", "circle", { problem: ["x+5=9"], previous: "x+5=9" }),
        line(20, ink("m3"), "m3", "3x+2x", null, { problem: ["3x+2x"], kind: "expression" }),
        line(25, ink("m3"), "m3b", "6x", "circle", { problem: ["3x+2x"], kind: "expression", previous: "3x+2x" }),
        line(30, ink("m4"), "m4", "\\frac{1}{2}+\\frac{1}{3}", null, { problem: ["\\frac{1}{2}+\\frac{1}{3}"], kind: "expression" }),
        line(35, ink("m4"), "m4b", "\\frac{2}{5}", "circle", { problem: ["\\frac{1}{2}+\\frac{1}{3}"], kind: "expression", previous: "\\frac{1}{2}+\\frac{1}{3}" }),
        line(40, ink("m5"), "m5", "x^{3}\\cdot x^{4}", null, { problem: ["x^{3}\\cdot x^{4}"], kind: "expression" }),
        line(45, ink("m5"), "m5b", "x^{12}", "circle", { problem: ["x^{3}\\cdot x^{4}"], kind: "expression", previous: "x^{3}\\cdot x^{4}" }),
        line(50, ink("m6"), "m6", "2x+3=11", null, { problem: ["2x+3=11"] }),
        line(55, ink("m6"), "m6b", "2x=11", "circle", { problem: ["2x+3=11"], previous: "2x+3=11" }),
        line(60, ink("m7"), "m7", "12\\times4", null, { problem: ["12\\times4"], kind: "expression" }),
        line(65, ink("m7"), "m7b", "46", "circle", { problem: ["12\\times4"], kind: "expression", previous: "12\\times4", solved: false }),
      ],
    },
    {
      name: "a question mark is no verdict; a line ticked then unmarked stays judged",
      course: "algebra1",
      steps: [
        problem(0, cell("hb_q"), ["8\\div2"], "practice"),
        line(5, cell("hb_q"), "ln_q", "\\text{four}", "question", { problem: ["8\\div2"], kind: "text" }),
        line(10, cell("hb_q"), "ln_r", "4", "check", { problem: ["8\\div2"], kind: "expression", solved: true }),
        line(15, cell("hb_q"), "ln_r", "4", null, { problem: ["8\\div2"], kind: "expression" }),
      ],
    },
    {
      name: "many problems on two screens, the course unknown",
      course: null,
      steps: [
        line(0, ink("a", PAGE), "a", "15-7", null, { problem: ["15-7"], kind: "expression" }),
        line(4, ink("a", PAGE), "a2", "8", "check", { problem: ["15-7"], kind: "expression", previous: "15-7", solved: true }),
        line(9, ink("b", PAGE), "b", "6\\times7", null, { problem: ["6\\times7"], kind: "expression" }),
        line(14, ink("b", PAGE), "b2", "42", "check", { problem: ["6\\times7"], kind: "expression", previous: "6\\times7", solved: true }),
        screen(20, PAGE2),
        line(25, ink("c", PAGE2), "c", "\\frac{3}{4}+\\frac{1}{4}", null, { problem: ["\\frac{3}{4}+\\frac{1}{4}"], kind: "expression", page: PAGE2 }),
        line(31, ink("c", PAGE2), "c2", "1", "check", { problem: ["\\frac{3}{4}+\\frac{1}{4}"], kind: "expression", previous: "\\frac{3}{4}+\\frac{1}{4}", solved: true, page: PAGE2 }),
        line(40, ink("d", PAGE2), "d", "0.5\\times0.2", null, { problem: ["0.5\\times0.2"], kind: "expression", page: PAGE2 }),
        help(41, ink("d", PAGE2), "solve"),
        tutorSolved(41, ink("d", PAGE2), ["0.5\\times0.2"], { page: PAGE2 }),
        line(50, ink("e", PAGE2), "e", "25\\%\\text{ of }80", null, { problem: ["25\\%\\text{ of }80"], kind: "expression", page: PAGE2 }),
        closed(60),
        flush(),
      ],
    },
  ];
}
