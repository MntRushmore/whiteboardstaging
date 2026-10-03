"use client";

import { ArrowRight, CheckCheck, GraduationCap, HeartHandshake, Hourglass, Lightbulb, MessageSquare, Sparkles } from "lucide-react";
import { PLAN_COPY } from "@/lib/onboarding/plan";
import { Button } from "@/registry/components/button/button";
import styles from "./plan.module.css";

const PERK_ICONS = { help: Lightbulb, ask: MessageSquare, check: CheckCheck, courses: GraduationCap } as const;

export interface PlanOfferProps {
  /** `offer`: Start the free week opens checkout; `soon`: no checkout yet, Continue goes home */
  view: "offer" | "soon";
  /** the day the card is first charged, in words (`chargeDateText`) */
  chargeDate: string;
  /** checkout is opening (the button says so and stops taking taps) */
  starting?: boolean;
  onStart: () => void;
  /** Maybe later (`offer`) / Continue (`soon`): on to the home */
  onLater: () => void;
}

/**
 * The plan screen's card (the route is src/app/(platform)/welcome/plan): Agathon Unlimited, its
 * price crossed out under "Free for your beta week", what it gives in four pictures, and — because
 * the student is a child and the card is a grown-up's — "This part is for a grown-up"
 * above the one button, with the auto-renewal said plainly right under it. "Maybe later" is always
 * there and goes home. Without a checkout link the button says Coming soon and Continue goes home.
 *
 * Presentational: the route reads the session and the subscription and decides `view`.
 */
export function PlanOffer({ view, chargeDate, starting = false, onStart, onLater }: PlanOfferProps) {
  const soon = view === "soon";
  return (
    <section aria-labelledby="plan-title" data-onboarding="plan" data-view={view} className={styles.card}>
      <div className={styles.hero}>
        <p className={`${styles.kicker} ${styles.rise}`}>
          <Sparkles size={16} strokeWidth={2} aria-hidden />
          {PLAN_COPY.kicker}
        </p>
        <h1 id="plan-title" className={`${styles.title} ${styles.rise}`}>
          {PLAN_COPY.title}
        </h1>
        <p className={`${styles.price} ${styles.rise}`}>
          <span className={styles.was}>
            <span className={styles.srOnly}>{PLAN_COPY.priceWas} </span>
            <s>{PLAN_COPY.price}</s>
          </span>
          <span className={styles.free}>{PLAN_COPY.free}</span>
        </p>
        <p className={`${styles.then} ${styles.rise}`}>{PLAN_COPY.then}</p>
      </div>

      <div className={styles.body}>
        <h2 className={styles.srOnly}>{PLAN_COPY.perksTitle}</h2>
        <ul className={styles.perks}>
          {PLAN_COPY.perks.map((p) => {
            const Icon = PERK_ICONS[p.id];
            return (
              <li key={p.id} className={`${styles.perk} ${styles.rise}`}>
                <span aria-hidden className={styles.perkIcon}>
                  <Icon size={20} strokeWidth={1.9} />
                </span>
                {p.text}
              </li>
            );
          })}
        </ul>

        <div className={`${styles.grownUp} ${styles.rise}`}>
          <span aria-hidden className={styles.grownUpIcon}>
            {soon ? <Hourglass size={20} strokeWidth={1.8} /> : <HeartHandshake size={22} strokeWidth={1.8} />}
          </span>
          <div>
            <p className={styles.grownUpTitle}>{soon ? PLAN_COPY.soonTitle : PLAN_COPY.grownUp}</p>
            <p className={styles.grownUpHint}>{soon ? PLAN_COPY.soonNote : PLAN_COPY.grownUpHint}</p>
          </div>
        </div>

        <div className={`${styles.actions} ${styles.rise}`}>
          {soon ? (
            <Button size="lg" className={styles.cta} disabled>
              {PLAN_COPY.soon}
            </Button>
          ) : (
            // while checkout opens the label itself says so (Arc's loading state would hide it)
            <Button size="lg" className={styles.cta} onClick={() => !starting && onStart()} aria-busy={starting || undefined} aria-describedby="plan-disclosure">
              {starting ? PLAN_COPY.opening : PLAN_COPY.start}
              {!starting && <ArrowRight size={18} strokeWidth={2} aria-hidden />}
            </Button>
          )}
          {!soon && (
            <p id="plan-disclosure" className={styles.disclosure}>
              {PLAN_COPY.disclosure(chargeDate)}{" "}
              <a href={PLAN_COPY.termsLink.href} className="underline underline-offset-2">
                {PLAN_COPY.termsLink.text}
              </a>
              {" · "}
              <a href={PLAN_COPY.fairUseLink.href} className="underline underline-offset-2">
                {PLAN_COPY.fairUseLink.text}
              </a>
            </p>
          )}
          <Button size="lg" variant={soon ? "secondary" : "ghost"} className={styles.later} onClick={onLater} disabled={starting}>
            {soon ? PLAN_COPY.continue : PLAN_COPY.later}
          </Button>
        </div>
      </div>
    </section>
  );
}
