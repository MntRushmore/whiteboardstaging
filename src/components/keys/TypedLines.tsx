"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import { ANSWER_LINE, stepLine } from "@/lib/keys/check";
import { KEYS_COPY } from "@/lib/keys/copy";
import { cellById, lineOfCell, placeName } from "@/lib/keys/item";
import { afterDigit, carryFor, firstCell, gridMove, intentFor } from "@/lib/keys/keymap";
import { openStep, outcomeOf, rootValues, type ProblemAction, type ProblemState } from "@/lib/keys/session";
import { ColumnCells } from "./ColumnCells";
import styles from "./keys.module.css";
import { Burst, Eye, Ring, Tick } from "./TutorMarks";
import { TutorWriting } from "./TutorWriting";

export interface TypedLinesProps {
  problem: ProblemState;
  dispatch: (a: ProblemAction) => void;
  /** the last problem of the set: Next says "All done" */
  last: boolean;
  onNext: () => void;
}

/** The problem as the tutor writes it, a `?` drawn as an empty box. */
function ProblemText({ text, words }: { text: string; words: string }) {
  return (
    <h2 className={styles.problem} aria-label={words}>
      {text.split("?").map((part, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true">□</span>}
          {part}
        </span>
      ))}
    </h2>
  );
}

/** What the screen reader hears after a check or a help. */
function announce(p: ProblemState): string {
  if (p.notice === "write_first") return KEYS_COPY.writeFirst;
  if (p.phase === "done") return outcomeOf(p) === "first_try" ? `${KEYS_COPY.gotIt} ${KEYS_COPY.nailedIt}` : KEYS_COPY.gotIt;
  const open = openStep(p);
  if (open) {
    const ring = p.subMark === "ring" ? `${KEYS_COPY.lookAgain} ` : "";
    return `${ring}${KEYS_COPY.lead[open.step.lead]} ${open.step.item.words}.`;
  }
  if (p.help?.kind === "nudge") return p.help.text;
  if (p.phase === "look_again") {
    const cell = p.ringed.length ? cellById(p.item, p.ringed[0]) : undefined;
    return cell ? `${KEYS_COPY.lookAgain} The ${placeName(cell.place)}.` : KEYS_COPY.lookAgain;
  }
  return "";
}

/**
 * The work surface (docs/KEYS.md, "Keys"): the problem, the column, the typed steps, the tutor's
 * writing and the answer row, and the keyboard map that runs them all. Intents come from
 * `src/lib/keys/keymap.ts`; this carries them out and moves focus.
 */
export function TypedLines({ problem, dispatch, last, onNext }: TypedLinesProps) {
  const { item, phase } = problem;
  const values = rootValues(problem);
  const open = openStep(problem);
  const done = phase === "done";

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
      focus(first ? `cell:${first}` : ANSWER_LINE);
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
      if (bad) focus(bad);
    }
    seen.current = { item: item.id, checks: problem.counts.checks, open: isOpen, phase };
  }, [item, phase, open, problem.counts.checks, problem.ringed, problem.result, focus]);

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

  function onCellKey(id: string, e: KeyboardEvent<HTMLInputElement>) {
    const intent = intentFor(e, "cell");
    if (!intent) return;
    e.preventDefault();
    switch (intent.type) {
      case "digit": {
        if (done) return;
        setCell(id, intent.digit);
        const next = afterDigit(item, id);
        if (next) focus(`cell:${next}`);
        return;
      }
      case "erase": {
        if (done) return;
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
        else if (intent.dir === "down") focus(stepLine(0));
        return;
      }
      case "carry": {
        const to = carryFor(item, id);
        if (to) focus(`cell:${to}`);
        return;
      }
      case "enter":
        if (done) return onNext();
        dispatch({ type: "fill_answer" });
        focus(ANSWER_LINE);
        return;
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
        } else {
          focus(index < problem.steps.length - 1 ? stepLine(index + 1) : ANSWER_LINE);
        }
        return;
      case "check":
        return check();
      case "help":
        return help();
    }
  }

  function onAnswerKey(e: KeyboardEvent<HTMLInputElement>) {
    const intent = intentFor(e, "answer");
    if (!intent) return;
    e.preventDefault();
    switch (intent.type) {
      case "enter":
        if (done) return onNext();
        return dispatch({ type: "check" });
      case "check":
        return check();
      case "move":
        return focus(stepLine(problem.steps.length - 1));
      case "help":
        return help();
    }
  }

  function onBoxKey(id: string, e: KeyboardEvent<HTMLInputElement>) {
    const intent = intentFor(e, "box");
    if (!intent) return;
    e.preventDefault();
    const n = Number(open?.values[id] ?? "") || 0;
    switch (intent.type) {
      case "digit":
        return dispatch({ type: "sub_cell", id, value: intent.digit });
      case "add_block":
        return dispatch({ type: "sub_cell", id, value: String(Math.min(9, n + 1)) });
      case "erase":
        return dispatch({ type: "sub_cell", id, value: n > 1 ? String(n - 1) : "" });
      case "enter":
      case "check":
        return dispatch({ type: "sub_check" });
      default:
        return;
    }
  }

  const outcome = outcomeOf(problem);
  // "Look again." stays while a ring is on the page, through the tutor's help
  const ringOnPage = problem.ringed.length > 0 || Object.values(problem.marks).includes("ring");
  const lookAgain = phase === "look_again" || (phase === "helping" && ringOnPage) || problem.subMark === "ring";
  const message = announce(problem);

  return (
    <div ref={surface} className={styles.surface}>
      <ProblemText text={item.text} words={item.words} />
      <p className={styles.workLabel}>{KEYS_COPY.workHere}</p>

      <div className={styles.work}>
        {item.layout.kind === "columns" && (
          <ColumnCells
            item={item}
            values={values}
            marks={problem.marks}
            ringed={problem.ringed}
            readOnly={done}
            carried={problem.carried?.cellId ?? null}
            onKey={onCellKey}
            onInput={(id, v) => setCell(id, v)}
          />
        )}

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
                {problem.marks[stepLine(i)] === "ring" && <Ring wide />}
              </span>
              <span className={styles.markSlot}>{problem.marks[stepLine(i)] === "tick" && <Tick label={`Step ${i + 1} is right`} />}</span>
            </div>
          ))}
        </div>

        <TutorWriting
          solved={problem.solvedSteps}
          open={open}
          subMark={problem.subMark}
          help={problem.help}
          onBoxKey={onBoxKey}
          onBoxInput={(id, v) => dispatch({ type: "sub_cell", id, value: v })}
        />
      </div>

      <div className={styles.answerRow}>
        <div className={styles.answerSpot}>
          <label htmlFor="keys-answer" className={styles.answerLabel}>
            {KEYS_COPY.answer}
          </label>
          <span className={styles.answerInputWrap}>
            <input
              id="keys-answer"
              data-slot={ANSWER_LINE}
              className={styles.answerInput}
              // as wide as the answer, so the tutor's ring fits it
              style={{ width: `calc(${Math.max(2, problem.answer.length) + 1}ch + 16px)` }}
              value={problem.answer}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              readOnly={done}
              aria-describedby="keys-feedback"
              onKeyDown={onAnswerKey}
              onChange={(e) => dispatch({ type: "answer", value: e.target.value.replace(/[^\d\s]/g, "").slice(0, 6) })}
            />
            {problem.marks[ANSWER_LINE] === "ring" && <Ring wide />}
          </span>
          {problem.marks[ANSWER_LINE] === "tick" && <Tick label="Your answer is right" />}
        </div>

        <div className={styles.actions}>
          {done ? (
            <>
              <span className={`${styles.banner} ${styles.gotIt}`}>{KEYS_COPY.gotIt}</span>
              {outcome === "first_try" && <span className={`${styles.banner} ${styles.cheer}`}>{KEYS_COPY.nailedIt}</span>}
              <button data-slot="next" type="button" className={`${styles.btn} ${styles.ink} ${styles.large}`} onClick={onNext}>
                <span className={styles.badge} aria-hidden="true">
                  ›
                </span>
                {last ? KEYS_COPY.finish : KEYS_COPY.next}
              </button>
            </>
          ) : (
            <>
              {lookAgain && (
                <span className={`${styles.banner} ${styles.lookAgain}`}>
                  <Eye />
                  {KEYS_COPY.lookAgain}
                </span>
              )}
              {problem.notice === "write_first" && <span className={styles.notice}>{KEYS_COPY.writeFirst}</span>}
              <button type="button" className={`${styles.btn} ${styles.ink} ${styles.large}`} onClick={check}>
                <span className={styles.badge} aria-hidden="true">
                  ✓
                </span>
                {KEYS_COPY.check}
                <span className={styles.kbd} aria-hidden="true">
                  Enter
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      <p id="keys-feedback" className={styles.srOnly} aria-live="polite">
        {message}
      </p>
      {done && <Burst key={item.id} />}
    </div>
  );
}
