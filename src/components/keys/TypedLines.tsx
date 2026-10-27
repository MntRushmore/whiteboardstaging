"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ANSWER_LINE, stepLine } from "@/lib/keys/check";
import { KEYS_COPY } from "@/lib/keys/copy";
import { lookAgainWhere } from "@/lib/keys/a11y";
import { cellById, lineOfCell, type MathItem } from "@/lib/keys/item";
import { afterDigit, carryFor, firstCell, gridMove, intentFor, nextRowStart } from "@/lib/keys/keymap";
import { boxMax, boxStart, boxStep } from "@/lib/keys/shrink";
import { sayInputFor } from "@/lib/keys/say";
import { openStep, outcomeOf, rootValues, type ProblemAction, type ProblemState } from "@/lib/keys/session";
import { ColumnCells } from "./ColumnCells";
import { play, pop } from "./feel";
import { FractionCells, FractionText } from "./FractionCells";
import { askHint, speakLine } from "./tutorVoice";
import { useSaid } from "./useKeysTutor";
import styles from "./keys.module.css";
import { Burst, Eye, Ring, Tick } from "./TutorMarks";
import { boxWidth, TutorWriting } from "./TutorWriting";

export interface TypedLinesProps {
  problem: ProblemState;
  dispatch: (a: ProblemAction) => void;
  /** the last problem of the set: Next says "All done" */
  last: boolean;
  onNext: () => void;
  /** offered after a problem done with help: one more like it (null: not offered) */
  onNowYouTry: (() => void) | null;
  /** the kid's grade, for the tutor's words (null: unknown) */
  grade: number | null;
}

/** The problem printed big, a `?` drawn as an empty box, fractions stacked (an equation: the page's hero). */
function ProblemText({ item }: { item: MathItem }) {
  const { text } = item;
  if (item.layout.kind === "fraction") {
    return (
      <p className={styles.problem} aria-hidden="true">
        <span className={styles.fracLine}>
          <FractionText text={text} />
        </span>
      </p>
    );
  }
  return (
    <p className={styles.problem} aria-hidden="true">
      {text.split("?").map((part, i) => (
        <span key={i}>
          {i > 0 && "□"}
          {part}
        </span>
      ))}
    </p>
  );
}

/** What the answer row keeps of what is typed: digits; a fraction's `/`; an equation's letter, `=` and minus. */
function answerText(item: MathItem, raw: string): string {
  if (item.math?.kind === "equation") {
    const L = item.math.letter;
    return raw.replace(new RegExp(`[^\\d\\s=${L}${L.toUpperCase()}\\-−]`, "g"), "").slice(0, 10);
  }
  if (item.layout.kind === "fraction") return raw.replace(/[^\d\s/]/g, "").slice(0, 9);
  return raw.replace(/[^\d\s]/g, "").slice(0, 7);
}

/**
 * A fraction answer, stacked (docs/KEYS.md, "Fraction input"): the top, `/` goes down to the bottom,
 * ↑ ↓ move between them, Backspace in an empty bottom goes back up. The row's value is `top/bottom`.
 */
function FractionAnswer({
  value,
  readOnly,
  onKey,
  onChange,
}: {
  value: string;
  readOnly: boolean;
  onKey: (e: KeyboardEvent<HTMLInputElement>, part: "num" | "den") => void;
  onChange: (v: string) => void;
}) {
  const [num = "", den = ""] = value.split("/");
  const join = (n: string, d: string) => (n || d ? `${n}/${d}` : "");
  const box = (part: "num" | "den") => (
    <input
      id={part === "num" ? "keys-answer" : undefined}
      data-slot={part === "num" ? ANSWER_LINE : `${ANSWER_LINE}:den`}
      className={`${styles.answerInput} ${styles.answerFracCell}`}
      value={part === "num" ? num : den}
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      readOnly={readOnly}
      maxLength={3}
      aria-label={part === "num" ? "Answer, top of the fraction" : "Answer, bottom of the fraction"}
      aria-describedby="keys-feedback"
      onKeyDown={(e) => onKey(e, part)}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, "").slice(0, 3);
        onChange(part === "num" ? join(v, den) : join(num, v));
      }}
    />
  );
  return (
    <span className={styles.frac}>
      {box("num")}
      <span className={styles.fracBar} aria-hidden="true" />
      {box("den")}
    </span>
  );
}

/** What the screen reader hears after a check or a help (`said`: the tutor's line as shown). */
function announce(p: ProblemState, said: string | null): string {
  if (p.notice === "write_first") return KEYS_COPY.writeFirst;
  if (p.phase === "done") return outcomeOf(p) === "first_try" ? `${KEYS_COPY.gotIt} ${KEYS_COPY.nailedIt}` : KEYS_COPY.gotIt;
  if (p.help?.kind === "worked") return said ?? "";
  const open = openStep(p);
  if (open) {
    const ring = p.subMark === "ring" ? `${KEYS_COPY.lookAgain} ` : "";
    return said === null ? "" : `${ring}${said} ${open.step.item.words}.`;
  }
  if (p.help?.kind === "nudge") return said ?? p.help.text;
  if (p.phase === "look_again") return lookAgainWhere(p.item, p.ringed);
  return "";
}

/** The keys that work right now, under the page. */
function Legend({ carry, blocks, over, done }: { carry: boolean; blocks: boolean; over: boolean; done: string | null }) {
  const keys: [string, string][] = done
    ? [["Enter", done]]
    : [
        ["0–9", "type"],
        ["⌫", "erase"],
        ...(carry ? ([["c", "carry"]] as [string, string][]) : []),
        ...(over ? ([["/", "over"]] as [string, string][]) : []),
        ...(blocks ? ([["Space", "add one"]] as [string, string][]) : []),
        ["?", "help"],
        ["Enter", "check"],
      ];
  return (
    <p className={styles.legend} aria-hidden="true">
      {keys.map(([k, what]) => (
        <span key={k}>
          <span className={styles.kbd}>{k}</span>
          {what}
        </span>
      ))}
    </p>
  );
}

/**
 * The work surface (docs/KEYS.md, "Focus"): one big problem in the middle of the page, typed straight
 * into its boxes, the tutor's feedback beside it and the tutor's writing right under it. A column or a
 * fraction is its own answer; an equation is worked on step lines with an answer row. Typed steps
 * open on request elsewhere. Intents come from `src/lib/keys/keymap.ts`; this carries them out and
 * moves focus.
 */
export function TypedLines({ problem, dispatch, last, onNext, onNowYouTry, grade }: TypedLinesProps) {
  const { item, phase } = problem;
  const values = rootValues(problem);
  const open = openStep(problem);
  const done = phase === "done";
  const kind = item.layout.kind;
  // A column's or a fraction's own boxes hold the answer; an equation keeps the answer row.
  const answerRow = kind === "lines";
  // An equation is worked on its lines; anywhere else the lines open on request.
  const linesAreWork = kind === "lines";
  const [stepsOpen, setStepsOpen] = useState(() => problem.steps.some((s) => s.trim() !== ""));
  const showSteps = linesAreWork || stepsOpen;

  // The tutor's words for what it says now: its own within 1.5 s, else the fixed line.
  const said = useSaid(sayInputFor(problem, grade));
  const tutorLine = said.line ?? (problem.help?.kind === "nudge" && !said.pending ? problem.help.text : null);

  // A nudge about a slip no bug rule names: the check endpoint's words, when they come.
  const helps = problem.counts.helps;
  const askFor = problem.help?.kind === "nudge" && !problem.bug && problem.helpLevel === 1 ? helps : null;
  const latest = useRef(problem);
  useEffect(() => {
    latest.current = problem;
  });
  useEffect(() => {
    if (askFor === null) return;
    let live = true;
    void askHint(latest.current).then((text) => {
      if (live && text && latest.current.counts.helps === askFor) dispatch({ type: "hint_text", text });
    });
    return () => {
      live = false;
    };
  }, [askFor, dispatch]);

  // Every focusable slot carries `data-slot` (`cell:r0`, `step:1`, `answer`, `box`, `next`).
  const surface = useRef<HTMLDivElement>(null);
  // Now when the slot is on the page (so a fast typist's next key lands in it), else after the render
  // that adds it (a new step, the box, Next).
  const focus = useCallback((key: string) => {
    const find = () => surface.current?.querySelector<HTMLElement>(`[data-slot="${key}"]`);
    const el = find();
    if (el) el.focus();
    else requestAnimationFrame(() => find()?.focus());
  }, []);

  // Focus follows the problem: the first cell on a new problem, the box when a smaller problem opens,
  // the cell that broke after a check, Next once it is solved.
  const seen = useRef({ item: "", checks: -1, open: false, phase: "" });
  useEffect(() => {
    const was = seen.current;
    const isOpen = open !== null;
    if (was.item !== item.id) {
      const first = firstCell(item);
      // an equation starts on its first line
      focus(first ? `cell:${first}` : item.layout.kind === "lines" ? stepLine(0) : ANSWER_LINE);
    } else if (phase === "done" && was.phase !== "done") {
      focus("next");
    } else if (isOpen && !was.open) {
      focus("box");
    } else if (problem.counts.checks !== was.checks && phase !== "done") {
      // the first ringed line's ones-most cell (digits go right to left), else the answer row or a
      // step (their slot keys are their line ids)
      const cells = problem.ringed.map((id) => cellById(item, id)).filter((c) => c !== undefined);
      const line = cells.length ? lineOfCell(item, cells[0].id) : null;
      const first = cells.filter((c) => lineOfCell(item, c.id) === line).sort((p, q) => p.place - q.place)[0];
      const bad = first ? `cell:${first.id}` : problem.result?.firstBadLine;
      if (bad && (bad !== ANSWER_LINE || answerRow)) focus(bad);
    }
    seen.current = { item: item.id, checks: problem.counts.checks, open: isOpen, phase };
  }, [item, phase, open, problem.counts.checks, problem.ringed, problem.result, focus, answerRow]);

  // The sounds answer what the page just did: a check, the smaller problem, the end.
  const heard = useRef({ checks: problem.counts.checks, subMark: problem.subMark, solved: problem.solvedSteps.length, phase });
  useEffect(() => {
    const was = heard.current;
    if (phase === "done" && was.phase !== "done") play("right");
    else if (problem.solvedSteps.length > was.solved) play("small");
    else if (problem.counts.checks > was.checks && problem.ringed.length + Object.values(problem.marks).filter((m) => m === "ring").length > 0) play("look");
    else if (problem.subMark === "ring" && was.subMark !== "ring") play("look");
    heard.current = { checks: problem.counts.checks, subMark: problem.subMark, solved: problem.solvedSteps.length, phase };
  }, [phase, problem.counts.checks, problem.subMark, problem.solvedSteps.length, problem.ringed, problem.marks]);

  const check = useCallback(() => dispatch(open ? { type: "sub_check" } : { type: "check" }), [dispatch, open]);
  const help = useCallback(() => dispatch({ type: "help" }), [dispatch]);

  // `?` and Ctrl+Enter from anywhere on the page (a button, the page itself); the inputs handle their own.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const intent = intentFor(e, "answer");
      if (intent?.type === "help") {
        e.preventDefault();
        help();
      } else if (intent?.type === "check") {
        e.preventDefault();
        check();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [help, check]);

  const setCell = (id: string, value: string) => dispatch({ type: "cell", id, value });

  const openSteps = (index = 0) => {
    setStepsOpen(true);
    focus(stepLine(index));
  };

  /** Enter in the work: a column checks itself; elsewhere the answer row takes the work's answer. */
  const enterFromWork = () => {
    if (!answerRow) return check();
    dispatch({ type: "fill_answer" });
    focus(ANSWER_LINE);
  };

  function onCellKey(id: string, e: KeyboardEvent<HTMLInputElement>) {
    if (item.layout.kind === "fraction") return onFracKey(id, e);
    const intent = intentFor(e, "cell");
    if (!intent) return;
    e.preventDefault();
    switch (intent.type) {
      case "digit": {
        if (done) return;
        setCell(id, intent.digit);
        pop(e.currentTarget);
        play("key");
        const next = afterDigit(item, id);
        if (next) focus(`cell:${next}`);
        return;
      }
      case "erase": {
        if (done) return;
        play("key");
        if (values[id]) return setCell(id, "");
        const back = gridMove(item, id, "right");
        if (back) {
          setCell(back, "");
          focus(`cell:${back}`);
        }
        return;
      }
      case "move": {
        const to = gridMove(item, id, intent.dir);
        if (to) focus(`cell:${to}`);
        else if (intent.dir === "down") openSteps(0);
        return;
      }
      case "carry": {
        const to = carryFor(item, id);
        if (to) focus(`cell:${to}`);
        return;
      }
      case "enter": {
        if (done) return onNext();
        // a product's partial rows: Enter goes on to the next row, then checks
        const next = nextRowStart(item, id);
        if (next) return focus(`cell:${next}`);
        return enterFromWork();
      }
      case "check":
        return check();
      case "help":
        return help();
    }
  }

  /** A fraction's top or bottom: digits fill it (up to three), `/` goes down to the bottom, arrows move. */
  function onFracKey(id: string, e: KeyboardEvent<HTMLInputElement>) {
    const intent = intentFor(e, "frac");
    if (!intent) return;
    e.preventDefault();
    const cell = cellById(item, id);
    const width = cell?.width ?? 3;
    const v = values[id] ?? "";
    switch (intent.type) {
      case "digit":
        if (done) return;
        setCell(id, (v + intent.digit).slice(0, width));
        pop(e.currentTarget);
        play("key");
        return;
      case "over":
      case "move": {
        const dir = intent.type === "over" ? "down" : intent.dir;
        const to = dir === "up" || dir === "down" ? gridMove(item, id, dir) : null;
        if (to) focus(`cell:${to}`);
        else if (dir === "down") openSteps(0);
        return;
      }
      case "erase": {
        if (done) return;
        play("key");
        if (v) return setCell(id, v.slice(0, -1));
        const up = gridMove(item, id, "up");
        if (up) focus(`cell:${up}`);
        return;
      }
      case "enter":
        if (done) return onNext();
        return enterFromWork();
      case "check":
        return check();
      case "help":
        return help();
    }
  }

  function onStepKey(index: number, e: KeyboardEvent<HTMLInputElement>) {
    const intent = intentFor(e, "step");
    if (!intent) return;
    if (intent.type === "erase") {
      if (problem.steps[index] === "" && problem.steps.length > 1) {
        e.preventDefault();
        dispatch({ type: "remove_step", index });
        focus(stepLine(Math.max(0, index - 1)));
      }
      return;
    }
    e.preventDefault();
    switch (intent.type) {
      case "enter":
        if (done) return onNext();
        dispatch({ type: "add_step", after: index });
        focus(stepLine(index + 1));
        return;
      case "move":
        if (intent.dir === "up") {
          const first = firstCell(item);
          focus(index > 0 ? stepLine(index - 1) : first ? `cell:${first}` : stepLine(0));
        } else if (index < problem.steps.length - 1) {
          focus(stepLine(index + 1));
        } else if (answerRow) {
          focus(ANSWER_LINE);
        }
        return;
      case "check":
        return check();
      case "help":
        return help();
    }
  }

  /** The answer row (`part`: a stacked fraction's top or bottom; `/` stacks it, arrows move between them). */
  function onAnswerKey(e: KeyboardEvent<HTMLInputElement>, part: "whole" | "num" | "den" = "whole") {
    const intent = intentFor(e, "answer");
    if (part === "den" && e.key === "Backspace" && !(problem.answer.split("/")[1] ?? "")) {
      e.preventDefault();
      return focus(ANSWER_LINE);
    }
    if (!intent) return;
    if (intent.type === "over") {
      if (part !== "num") return;
      e.preventDefault();
      return focus(`${ANSWER_LINE}:den`);
    }
    e.preventDefault();
    switch (intent.type) {
      case "enter":
        if (done) return onNext();
        return dispatch({ type: "check" });
      case "check":
        return check();
      case "move":
        if (part === "num" && intent.dir === "down") return focus(`${ANSWER_LINE}:den`);
        if (part === "den" && intent.dir === "up") return focus(ANSWER_LINE);
        if (intent.dir === "up") return openSteps(problem.steps.length - 1);
        return;
      case "help":
        return help();
    }
  }

  function onBoxKey(id: string, e: KeyboardEvent<HTMLInputElement>) {
    const intent = intentFor(e, "box");
    if (!intent || !open) return;
    const m = open.step.manipulative;
    const raw = open.values[id] ?? "";
    const n = Number(raw) || 0;
    const width = boxWidth(open.step.item, id);
    const max = boxMax(m, Number(open.step.item.answer));
    const line = m?.kind === "number_line" ? m : null;
    if (intent.type === "move" && (intent.dir === "up" || intent.dir === "down")) {
      // up and down leave the box for the lines around it (the browser's own moves are not wanted here)
      e.preventDefault();
      if (intent.dir === "up") return showSteps ? focus(stepLine(0)) : undefined;
      return answerRow ? focus(ANSWER_LINE) : undefined;
    }
    e.preventDefault();
    switch (intent.type) {
      case "digit":
        pop(e.currentTarget);
        play("key");
        return dispatch({ type: "sub_cell", id, value: width > 1 ? (raw + intent.digit).slice(-width) : intent.digit });
      case "add_block": {
        const from = raw === "" ? boxStart(m) : n;
        pop(e.currentTarget);
        play("block");
        return dispatch({ type: "sub_cell", id, value: String(Math.min(max, from + boxStep(m))) });
      }
      case "move": {
        if (!line) return;
        const from = raw === "" ? line.start : n;
        const to = Math.max(line.min, Math.min(line.max, from + (intent.dir === "right" ? 1 : -1)));
        play("block");
        return dispatch({ type: "sub_cell", id, value: String(to) });
      }
      case "erase": {
        play("key");
        // a typed number loses its last digit; built blocks, bars and rows lose one step
        if (!m || line) return dispatch({ type: "sub_cell", id, value: raw.slice(0, -1) });
        const next = n - boxStep(m);
        return dispatch({ type: "sub_cell", id, value: next > 0 ? String(next) : "" });
      }
      case "enter":
      case "check":
        return dispatch({ type: "sub_check" });
      case "help":
        return help();
      default:
        return;
    }
  }

  const outcome = outcomeOf(problem);
  // "Look again." stays while a ring is on the page, but steps aside while the tutor's smaller problem is open
  const ringOnPage = problem.ringed.length > 0 || Object.values(problem.marks).includes("ring");
  const lookAgain = !open && (phase === "look_again" || (phase === "helping" && ringOnPage));
  const message = announce(problem, tutorLine);
  const hasCarry = item.layout.kind === "columns" && item.layout.lines.some((l) => l.role === "carry");
  const builds = !!open?.step.manipulative && open.step.manipulative.kind !== "number_line";

  // Read aloud (off by default; More): each new thing the tutor says, as it appears.
  const spoken = (lookAgain || problem.subMark === "ring") && !tutorLine ? KEYS_COPY.lookAgain : done ? KEYS_COPY.gotIt : tutorLine;
  useEffect(() => {
    if (spoken) speakLine(spoken);
  }, [spoken]);

  return (
    <div ref={surface} className={styles.surface}>
      <h2 className={styles.srOnly}>{item.words}</h2>
      <p className={styles.eyebrow}>{KEYS_COPY.prompt[item.kind]}</p>

      <div className={styles.stage}>
        <span aria-hidden="true" />
        {kind === "columns" ? (
          <ColumnCells
            item={item}
            values={values}
            marks={problem.marks}
            ringed={problem.ringed}
            readOnly={done}
            carried={problem.carried?.cellId ?? null}
            point={problem.help?.kind === "nudge" ? problem.help.point : null}
            onKey={onCellKey}
            onInput={(id, v) => setCell(id, v)}
          />
        ) : kind === "fraction" ? (
          <FractionCells
            item={item}
            values={values}
            marks={problem.marks}
            ringed={problem.ringed}
            readOnly={done}
            carried={problem.carried?.cellId ?? null}
            onKey={onCellKey}
            onInput={(id, v) => setCell(id, v)}
          />
        ) : (
          <ProblemText item={item} />
        )}
        <div className={styles.side}>
          {done && outcome === "first_try" && (
            <span className={styles.cheer} data-cheer>
              {KEYS_COPY.nailedIt}
            </span>
          )}
          {done && outcome !== "first_try" && (
            <span className={`${styles.status} ${styles.statusRight}`} data-cheer>
              <i aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24">
                  <path d="M5 12.5 L9.5 17 L19 7.5" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </i>
              <span>
                {KEYS_COPY.gotIt}
                <small>{outcome === "with_help" ? KEYS_COPY.withHelp : KEYS_COPY.onYourOwn}</small>
              </span>
            </span>
          )}
          {lookAgain && (
            <span className={`${styles.status} ${styles.statusLook}`}>
              <i aria-hidden="true">
                <Eye />
              </i>
              <span>
                {KEYS_COPY.lookAgain}
                {!problem.help && <small>{KEYS_COPY.lookHint}</small>}
              </span>
            </span>
          )}
          {problem.notice === "write_first" && <span className={styles.notice}>{KEYS_COPY.writeFirst}</span>}
        </div>
      </div>

      <div className={styles.helpZone}>
        {showSteps ? (
          <div className={styles.steps} role="group" aria-label="Your steps">
            <span className={styles.stepsHead} aria-hidden="true">
              {KEYS_COPY.stepsHead}
            </span>
            {problem.steps.map((text, i) => (
              <div key={i} className={styles.stepRow}>
                <span className={styles.stepWrap}>
                  <input
                    data-slot={stepLine(i)}
                    className={styles.stepInput}
                    value={text}
                    placeholder={i === 0 ? KEYS_COPY.stepPlaceholder : ""}
                    autoComplete="off"
                    spellCheck={false}
                    readOnly={done}
                    aria-label={`Step ${i + 1}${problem.marks[stepLine(i)] === "ring" ? `. ${KEYS_COPY.lookAgain}` : ""}`}
                    onKeyDown={(e) => onStepKey(i, e)}
                    onChange={(e) => dispatch({ type: "step", index: i, value: e.target.value.replace(/\?/g, "") })}
                  />
                  {problem.marks[stepLine(i)] === "ring" && (
                    // the ring goes round what was typed, not the whole line
                    <span className={styles.stepRing} style={{ width: `calc(${Math.max(3, text.length)}ch + 20px)` }}>
                      <Ring wide />
                    </span>
                  )}
                </span>
                <span className={styles.markSlot}>{problem.marks[stepLine(i)] === "tick" && <Tick label={`Step ${i + 1} is right`} />}</span>
              </div>
            ))}
          </div>
        ) : (
          !done && (
            <button type="button" className={styles.stepsToggle} onClick={() => openSteps(0)}>
              + {KEYS_COPY.showSteps}
            </button>
          )
        )}

        {answerRow && (
          <div className={styles.answerSpot}>
            <label htmlFor="keys-answer" className={styles.answerLabel}>
              {KEYS_COPY.answer}
            </label>
            <span className={`${styles.answerInputWrap} ${problem.carried?.cellId === ANSWER_LINE ? styles.arrived : ""}`}>
              {item.kind === "fraction_sum" ? (
                <FractionAnswer value={problem.answer} readOnly={done} onKey={onAnswerKey} onChange={(v) => dispatch({ type: "answer", value: v })} />
              ) : (
                <input
                  id="keys-answer"
                  data-slot={ANSWER_LINE}
                  className={styles.answerInput}
                  // as wide as the answer, so the tutor's ring fits it
                  style={{ width: `calc(${Math.max(2, problem.answer.length) + 1}ch + 16px)` }}
                  value={problem.answer}
                  placeholder={item.math?.kind === "equation" ? `${item.math.letter} = ` : undefined}
                  inputMode={item.math?.kind === "equation" ? "text" : "numeric"}
                  autoComplete="off"
                  spellCheck={false}
                  readOnly={done}
                  aria-describedby="keys-feedback"
                  onKeyDown={(e) => onAnswerKey(e)}
                  onChange={(e) => dispatch({ type: "answer", value: answerText(item, e.target.value) })}
                />
              )}
              {problem.marks[ANSWER_LINE] === "ring" && <Ring wide />}
            </span>
            {problem.marks[ANSWER_LINE] === "tick" && <Tick label="Your answer is right" />}
          </div>
        )}

        <TutorWriting
          solved={problem.solvedSteps}
          open={open}
          subMark={problem.subMark}
          help={problem.help}
          line={tutorLine}
          pending={said.pending}
          onBoxKey={onBoxKey}
          onBoxInput={(id, v) => dispatch({ type: "sub_cell", id, value: v })}
        />
      </div>

      <div className={styles.foot}>
        <Legend carry={hasCarry && !open} over={kind === "fraction" && !open} blocks={builds} done={done ? (onNowYouTry ? "one more" : "next") : null} />
        {done ? (
          <span className={styles.footActions}>
            {onNowYouTry && (
              <button data-slot="next" type="button" className={`${styles.btn} ${styles.ink} ${styles.large}`} onClick={onNowYouTry} aria-label={KEYS_COPY.nowYouTryLabel}>
                {KEYS_COPY.nowYouTryGo}
              </button>
            )}
            <button data-slot={onNowYouTry ? "skip" : "next"} type="button" className={`${styles.btn} ${onNowYouTry ? styles.chalk : styles.ink} ${styles.large}`} onClick={onNext}>
              <span className={styles.badge} aria-hidden="true">
                ›
              </span>
              {last ? KEYS_COPY.finish : KEYS_COPY.next}
              {!onNowYouTry && (
                <span className={styles.kbd} aria-hidden="true">
                  Enter
                </span>
              )}
            </button>
          </span>
        ) : (
          <button type="button" className={`${styles.btn} ${styles.ink} ${styles.large}`} onClick={check}>
            <span className={styles.badge} aria-hidden="true">
              ✓
            </span>
            {KEYS_COPY.check}
            <span className={styles.kbd} aria-hidden="true">
              Enter
            </span>
          </button>
        )}
      </div>

      <p id="keys-feedback" className={styles.srOnly} aria-live="polite">
        {message}
      </p>
      {done && <Burst key={item.id} />}
    </div>
  );
}
