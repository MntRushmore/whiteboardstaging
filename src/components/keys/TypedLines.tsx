"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ANSWER_LINE, stepLine } from "@/lib/keys/check";
import { KEYS_COPY } from "@/lib/keys/copy";
import { cellById, lineOfCell, placeName } from "@/lib/keys/item";
import { afterDigit, carryFor, firstCell, gridMove, intentFor } from "@/lib/keys/keymap";
import { openStep, outcomeOf, rootValues, type ProblemAction, type ProblemState } from "@/lib/keys/session";
import { ColumnCells } from "./ColumnCells";
import { play, pop } from "./feel";
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

/** The keys that work right now, under the page. */
function Legend({ carry, blocks, done }: { carry: boolean; blocks: boolean; done: boolean }) {
  const keys: [string, string][] = done
    ? [["Enter", "next"]]
    : [
        ["0–9", "type"],
        ["⌫", "erase"],
        ...(carry ? ([["c", "carry"]] as [string, string][]) : []),
        ...(blocks ? ([["Space", "add a ten"]] as [string, string][]) : []),
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
 * into its boxes, the tutor's feedback beside it and the tutor's writing right under it. Typed steps
 * open on request. Intents come from `src/lib/keys/keymap.ts`; this carries them out and moves focus.
 */
export function TypedLines({ problem, dispatch, last, onNext }: TypedLinesProps) {
  const { item, phase } = problem;
  const values = rootValues(problem);
  const open = openStep(problem);
  const done = phase === "done";
  const columns = item.layout.kind === "columns";
  // In a column the work's own result row is the answer; the answer row is for other layouts.
  const answerRow = !columns;
  const [showSteps, setShowSteps] = useState(() => problem.steps.some((s) => s.trim() !== ""));

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
      if (bad && (bad !== ANSWER_LINE || answerRow)) focus(bad);
    }
    seen.current = {
      item: item.id,
      checks: problem.counts.checks,
      open: isOpen,
      phase,
    };
  }, [item, phase, open, problem.counts.checks, problem.ringed, problem.result, focus, answerRow]);

  // The sounds answer what the page just did: a check, the smaller problem, the end.
  const heard = useRef({
    checks: problem.counts.checks,
    subMark: problem.subMark,
    solved: problem.solvedSteps.length,
    phase,
  });
  useEffect(() => {
    const was = heard.current;
    if (phase === "done" && was.phase !== "done") play("right");
    else if (problem.solvedSteps.length > was.solved) play("small");
    else if (problem.counts.checks > was.checks && problem.ringed.length + Object.values(problem.marks).filter((m) => m === "ring").length > 0) play("look");
    else if (problem.subMark === "ring" && was.subMark !== "ring") play("look");
    heard.current = {
      checks: problem.counts.checks,
      subMark: problem.subMark,
      solved: problem.solvedSteps.length,
      phase,
    };
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
    setShowSteps(true);
    focus(stepLine(index));
  };

  function onCellKey(id: string, e: KeyboardEvent<HTMLInputElement>) {
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
      case "enter":
        if (done) return onNext();
        if (!answerRow) return check();
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
        return openSteps(problem.steps.length - 1);
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
        pop(e.currentTarget);
        play("key");
        return dispatch({ type: "sub_cell", id, value: intent.digit });
      case "add_block":
        pop(e.currentTarget);
        play("block");
        return dispatch({
          type: "sub_cell",
          id,
          value: String(Math.min(9, n + 1)),
        });
      case "erase":
        play("key");
        return dispatch({
          type: "sub_cell",
          id,
          value: n > 1 ? String(n - 1) : "",
        });
      case "enter":
      case "check":
        return dispatch({ type: "sub_check" });
      default:
        return;
    }
  }

  const outcome = outcomeOf(problem);
  // "Look again." stays while a ring is on the page, but steps aside while the tutor's smaller problem is open
  const ringOnPage = problem.ringed.length > 0 || Object.values(problem.marks).includes("ring");
  const lookAgain = !open && (phase === "look_again" || (phase === "helping" && ringOnPage));
  const message = announce(problem);
  const hasCarry = columns && item.layout.kind === "columns" && item.layout.lines.some((l) => l.role === "carry");

  return (
    <div ref={surface} className={styles.surface}>
      <h2 className={styles.srOnly}>{item.words}</h2>
      <p className={styles.eyebrow}>{KEYS_COPY.prompt[item.kind]}</p>

      <div className={styles.stage}>
        <span aria-hidden="true" />
        {columns ? (
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
        ) : (
          <p className={styles.problem} aria-hidden="true">
            {item.text.split("?").map((part, i) => (
              <span key={i}>
                {i > 0 && "□"}
                {part}
              </span>
            ))}
          </p>
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
        <TutorWriting
          solved={problem.solvedSteps}
          open={open}
          subMark={problem.subMark}
          help={problem.help}
          onBoxKey={onBoxKey}
          onBoxInput={(id, v) => dispatch({ type: "sub_cell", id, value: v })}
        />

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
                    onChange={(e) =>
                      dispatch({
                        type: "step",
                        index: i,
                        value: e.target.value.replace(/\?/g, ""),
                      })
                    }
                  />
                  {problem.marks[stepLine(i)] === "ring" && <Ring wide />}
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
      </div>

      {answerRow && (
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
              style={{
                width: `calc(${Math.max(2, problem.answer.length) + 1}ch + 16px)`,
              }}
              value={problem.answer}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              readOnly={done}
              aria-describedby="keys-feedback"
              onKeyDown={onAnswerKey}
              onChange={(e) =>
                dispatch({
                  type: "answer",
                  value: e.target.value.replace(/[^\d\s]/g, "").slice(0, 6),
                })
              }
            />
            {problem.marks[ANSWER_LINE] === "ring" && <Ring wide />}
          </span>
          {problem.marks[ANSWER_LINE] === "tick" && <Tick label="Your answer is right" />}
        </div>
      )}

      <div className={styles.foot}>
        <Legend carry={hasCarry && !open} blocks={!!open?.step.manipulative} done={done} />
        {done ? (
          <button data-slot="next" type="button" className={`${styles.btn} ${styles.ink} ${styles.large}`} onClick={onNext}>
            <span className={styles.badge} aria-hidden="true">
              ›
            </span>
            {last ? KEYS_COPY.finish : KEYS_COPY.next}
            <span className={styles.kbd} aria-hidden="true">
              Enter
            </span>
          </button>
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
