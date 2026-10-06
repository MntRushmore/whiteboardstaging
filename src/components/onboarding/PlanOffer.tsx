"use client";

import { Fragment, useId, type CSSProperties } from "react";
import { PLAN_COPY } from "@/lib/onboarding/plan";
import { planFace, planHand } from "./planFonts";
import styles from "./plan.module.css";

export interface PlanOfferProps {
  /**
   * `offer`: Start the free trial opens checkout; `restart`: a plan that ended, started again (no
   * free trial); `soon`: no checkout yet, Continue goes home
   */
  view: "offer" | "restart" | "soon";
  /** the day the card is first charged, in words (`chargeDateText`): the disclosure's date */
  chargeDate: string;
  /** the same day, short (`chargeDayText`): the bill's date column */
  chargeDay: string;
  /** checkout is opening (the button says so and stops taking taps) */
  starting?: boolean;
  onStart: () => void;
  /** Continue (`soon` only): on to the home */
  onContinue: () => void;
}

/**
 * The tutor's tick, as the board draws ink: a tapered pen stroke (thin start, heavy turn, flicked
 * tail), revealed along its centre line so it draws itself on (plan.module.css).
 */
function Tick({ className }: { className: string }) {
  const mask = useId();
  return (
    <svg className={className} viewBox="0 0 60 50" aria-hidden focusable="false">
      <mask id={mask} maskUnits="userSpaceOnUse">
        <path className={styles.tickPen} pathLength={1} d="M6 27 Q13 34 21 42 Q36 22 56 6" />
      </mask>
      <path
        className={styles.tickInk}
        mask={`url(#${mask})`}
        d="M7.24 25.76 Q14 31.5 21 37.5 Q34.4 20.5 55.82 5.83 Q56.3 5.7 56.18 6.17 Q37.6 23.5 21.5 46.2 Q12.5 37.5 4.76 28.24 A1.75 1.75 0 0 1 7.24 25.76 Z"
      />
    </svg>
  );
}

/** The tutor's note, one glyph at a time (each word kept whole, so lines only break between words). */
function Written({ text }: { text: string }) {
  const words = text.split(" ");
  // where each word's first glyph falls in the pen's order (a space counts as one beat)
  const starts = words.map((_, w) => words.slice(0, w).reduce((n, word) => n + word.length + 1, 0));
  return (
    <>
      {words.map((word, w) => (
        <Fragment key={w}>
          {w > 0 && " "}
          <span className={styles.word}>
            {Array.from(word).map((ch, c) => (
              <span key={c} className={styles.glyph} style={{ "--i": starts[w] + c } as CSSProperties}>
                {ch}
              </span>
            ))}
          </span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * The plan screen (the route is src/app/(platform)/welcome/plan): "the marked page". On the left, a
 * crop of the board as the student just saw it, running off the edge of the screen: their working in
 * the board's own handwriting face, the tutor's ticks drawing themselves on, and the tutor's note.
 * On the right, a tear-off slip for the grown-up: the offer in one plain sentence, the bill (today
 * $0, the first charge's day, then every month), the one action, and the auto-renewal said plainly
 * right under it. There is no free plan, so there is no "Maybe later" (the app header's menu still
 * has Account and Sign out). A plan that ended is offered again without the free trial. Without a
 * checkout link, the slip says so and Continue goes home.
 *
 * The DOM order is the phone's reading order (title, page, slip, what you get); the grid places
 * them side by side from an upright iPad up.
 *
 * Presentational: the route reads the session and the subscription and decides `view`.
 */
export function PlanOffer({ view, chargeDate, chargeDay, starting = false, onStart, onContinue }: PlanOfferProps) {
  const soon = view === "soon";
  const restart = view === "restart";
  const { sheet, bill } = PLAN_COPY;
  return (
    <section aria-labelledby="plan-title" data-onboarding="plan" data-view={view} className={`${styles.plan} ${planFace.variable} ${planHand.variable}`}>
      <header className={styles.head}>
        <h1 id="plan-title" className={styles.title}>
          {PLAN_COPY.title}
        </h1>
        <p className={styles.lede}>{restart ? PLAN_COPY.welcomeBack : PLAN_COPY.lede}</p>
      </header>

      <figure className={styles.sheet} aria-label={sheet.label}>
        <p className={styles.prompt} aria-hidden>
          {sheet.prompt}
        </p>
        <p className={styles.line} aria-hidden>
          {sheet.problem}
        </p>
        {sheet.steps.map((step, i) => (
          <p key={step} className={styles.line} aria-hidden>
            {step}
            <Tick className={`${styles.tick} ${i === 0 ? styles.tick1 : styles.tick2}`} />
          </p>
        ))}
        <figcaption className={styles.note} aria-hidden>
          <Written text={sheet.note} />
        </figcaption>
      </figure>

      <div className={styles.slipHead}>
        {!soon && <h2 className={styles.grownUpTitle}>{PLAN_COPY.grownUp}</h2>}
        <p className={styles.offer}>{soon ? PLAN_COPY.soonTitle : restart ? PLAN_COPY.restartOffer(chargeDay) : PLAN_COPY.offer}</p>
        <p className={styles.hint}>{soon ? PLAN_COPY.soonNote : PLAN_COPY.grownUpHint}</p>
      </div>

      <div className={styles.slipBody}>
        {!soon && (
          <dl className={styles.bill} aria-label={bill.label}>
            <div className={styles.billRow}>
              <dt>{bill.today}</dt>
              <dd>{restart ? bill.restartStarts : bill.starts}</dd>
              <dd className={styles.amount}>{bill.nothing}</dd>
            </div>
            <div className={styles.billRow}>
              <dt>{chargeDay}</dt>
              <dd>{restart ? bill.restartFirst : bill.first}</dd>
              <dd className={styles.amount}>{bill.price}</dd>
            </div>
            <div className={styles.billRow}>
              <dt>{bill.monthly}</dt>
              <dd>{bill.untilCancel}</dd>
              <dd className={styles.amount}>{bill.price}</dd>
            </div>
          </dl>
        )}

        <div className={styles.actions}>
          {soon ? (
            <button type="button" className={styles.cta} onClick={onContinue}>
              {PLAN_COPY.continue}
            </button>
          ) : (
            <>
              {/* while checkout opens the label itself says so */}
              <button
                type="button"
                className={styles.cta}
                onClick={() => !starting && onStart()}
                aria-busy={starting || undefined}
                aria-describedby="plan-disclosure"
              >
                {starting ? PLAN_COPY.opening : restart ? PLAN_COPY.restart : PLAN_COPY.start}
              </button>
              <p id="plan-disclosure" className={styles.disclosure}>
                {PLAN_COPY.disclosure(chargeDate)} {restart && `${PLAN_COPY.restartNote} `}
                {/* kept together, so "Fair use" never ends up alone on a line */}
                <span className={styles.links}>
                  <a href={PLAN_COPY.termsLink.href}>{PLAN_COPY.termsLink.text}</a>
                  {" · "}
                  <a href={PLAN_COPY.fairUseLink.href}>{PLAN_COPY.fairUseLink.text}</a>
                </span>
              </p>
            </>
          )}
        </div>
      </div>

      <div className={styles.gets}>
        <h2 className={styles.srOnly}>{PLAN_COPY.perksTitle}</h2>
        <ul className={styles.perks}>
          {PLAN_COPY.perks.map((p) => (
            <li key={p.id}>
              <strong>{p.text}</strong> <span>{p.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
