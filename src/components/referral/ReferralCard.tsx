"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Gift, Share2, UsersRound } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { referralLink } from "@/lib/billing/planChoice";
import { isKidEmail } from "@/lib/family/contracts";
import type { ReferralSummary } from "@/lib/referral/contracts";
import { readReferralSummary } from "@/lib/referral/client";
import { REFERRAL_CARD_COPY } from "@/lib/referral/copy";
import { referralCardView } from "@/lib/referral/summary";
import { Button } from "@/registry/components/button/button";
import { Skeleton } from "@/registry/components/skeleton/skeleton";
import styles from "./referral.module.css";

type CardState = { kind: "loading" } | { kind: "ready"; summary: ReferralSummary } | { kind: "hidden" };

/** The friend's free first month is on sale on this build (its Payment Link is set). */
const FRIEND_OFFER = referralLink() !== null;

/**
 * "Give a month, get a month" for a grown-up, on /family and /account: the pitch, their invite link
 * with Copy and Share (the phone's share sheet, where there is one), and how many friends joined
 * and free months they earned. Nothing for a kid profile, and nothing at all when the summary
 * cannot be read (a promotion is never worth an error box). Reads referral_summary() with the
 * grown-up's own session, which makes their code the first time.
 */
export function ReferralCard() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const kid = isKidEmail(user?.email);
  const [state, setState] = useState<CardState>({ kind: "loading" });
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [canShare, setCanShare] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!userId || kid) return;
    let cancelled = false;
    void import("@/lib/supabase").then(async ({ supabase }) => {
      const result = await readReferralSummary(supabase, window.location.origin);
      if (cancelled) return;
      if (result.kind === "ok") setState({ kind: "ready", summary: result.summary });
      else {
        if (result.kind === "error") console.warn("Referral summary not read:", result.message);
        setState({ kind: "hidden" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId, kid]);

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
    return () => void (timer.current && window.clearTimeout(timer.current));
  }, []);

  if (!userId || kid || state.kind === "hidden") return null;

  if (state.kind === "loading") {
    return (
      <section className={styles.card} aria-busy data-testid="referral-card" data-state="loading">
        <Skeleton lines={3} avatar label={REFERRAL_CARD_COPY.loading} />
      </section>
    );
  }

  const view = referralCardView(state.summary, FRIEND_OFFER);

  async function copy() {
    try {
      await navigator.clipboard.writeText(view.link);
      setCopied("copied");
    } catch {
      // the link stays selectable: select it, so a long-press or Ctrl+C finishes the job
      input.current?.select();
      setCopied("failed");
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied("idle"), 2200);
  }

  async function share() {
    try {
      await navigator.share({ title: REFERRAL_CARD_COPY.shareTitle, text: view.shareText, url: view.link });
    } catch {
      // dismissed, or the share sheet failed: Copy is right beside it
    }
  }

  return (
    <section className={styles.card} aria-labelledby="referral-card-title" data-testid="referral-card" data-state="ready">
      <div className={styles.head}>
        <span className={styles.badge} aria-hidden>
          <Gift size={20} strokeWidth={1.8} />
        </span>
        <div className={styles.headText}>
          <h2 id="referral-card-title" className={styles.title}>
            {view.title}
          </h2>
          <p className={styles.pitch}>{view.pitch}</p>
        </div>
      </div>

      <div className={styles.linkRow}>
        <label className={styles.linkField}>
          <span className={styles.srOnly}>{REFERRAL_CARD_COPY.linkLabel}</span>
          <input
            ref={input}
            className={styles.linkInput}
            readOnly
            value={view.shown}
            onFocus={(e) => e.currentTarget.select()}
            spellCheck={false}
            data-testid="referral-link"
            data-link={view.link}
          />
        </label>
        <div className={styles.linkActions}>
          <Button onClick={() => void copy()} data-testid="referral-copy" aria-live="polite">
            {copied === "copied" ? <Check size={16} strokeWidth={2.2} aria-hidden /> : <Copy size={16} strokeWidth={1.9} aria-hidden />}
            {copied === "copied" ? REFERRAL_CARD_COPY.copied : REFERRAL_CARD_COPY.copy}
          </Button>
          {canShare && (
            <Button variant="secondary" onClick={() => void share()} data-testid="referral-share">
              <Share2 size={16} strokeWidth={1.9} aria-hidden />
              {REFERRAL_CARD_COPY.share}
            </Button>
          )}
        </div>
      </div>
      {copied === "failed" && (
        <p className={styles.copyFailed} role="status">
          {REFERRAL_CARD_COPY.copyFailed}
        </p>
      )}

      <div className={styles.foot}>
        <p className={styles.counts} data-testid="referral-counts">
          <UsersRound size={16} strokeWidth={1.9} aria-hidden className={styles.countsIcon} />
          <span>{view.line}</span>
        </p>
        <p className={styles.fine}>{REFERRAL_CARD_COPY.howItWorks}</p>
      </div>
    </section>
  );
}
