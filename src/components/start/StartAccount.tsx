"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ConsentField } from "@/components/login/LoginForm";
import { HEARD_FROM, type HeardFrom } from "@/lib/funnel/contracts";
import { SIGN_IN_HREF } from "@/lib/landing/links";
import { clientMetric } from "@/lib/logger";
import { AUTH_FORM_METHOD, FORM_COPY, type FieldErrors } from "@/lib/loginForm";
import { reportUserError } from "@/lib/reportAppError";
import { START_ACCOUNT_COPY as COPY, copyStartLink, handoffMailto, roleMeta, shareStartLink, submitStartAccount } from "@/lib/start/account";
import type { StartAnswers } from "@/lib/start/contracts";
import { asStartClient, finishStart } from "@/lib/start/finish";
import { startAnswersLink } from "@/lib/start/link";
import { clearStartPending, startStorage, writeStartPending } from "@/lib/start/pending";
import { linkStartJourney, recordStartStep } from "@/lib/start/record";
import { supabase } from "@/lib/supabase";
import { Alert } from "@/registry/components/alert/alert";
import { Button } from "@/registry/components/button/button";
import { Input } from "@/registry/components/input/input";
import { PasswordField } from "@/registry/components/password-field/password-field";
import styles from "./startAccount.module.css";

const client = asStartClient(supabase);

/**
 * - `form`: the grown-up's email, password, consent and "How did you hear about Agathon?"
 * - `ask`: a kid on their own: "My grown-up is here" or "Send it to my grown-up"
 * - `share`: the link to copy or email (no share sheet on this device)
 * - `sent`: the share sheet sent it
 * - `confirm`: sign-up came back without a session: check your email
 */
type View = "form" | "ask" | "share" | "sent" | "confirm";
type FocusTarget = "email" | "password" | "consent" | "heading";

const subscribeNever = () => () => {};

export interface StartAccountProps {
  answers: StartAnswers;
  /** the answers are saved: go on to `next` (the first board, or the plan screen) */
  onDone: (next: string) => void;
  /** back to the plan */
  onBack: () => void;
  /**
   * Inside /start's flow (StartFlow), whose bar already has Back: no second Back to the plan here
   * (the kid's own steps, ask → share, keep theirs).
   */
  inFlow?: boolean;
  /** a line about the plan being saved, under the title (StartFlow: "3rd grade · Times tables, …") */
  summary?: React.ReactNode;
  /**
   * Where a kid's screen starts: "ask" (fetch a grown-up, the default for a kid) or "form" (the
   * grown-up is here: they opened the kid's link). A parent always starts on the form.
   */
  startIn?: "ask" | "form";
}

/**
 * /start's last screen (docs/START-FLOW.md): save the plan. A parent gets the account form at once;
 * a kid on their own is asked to fetch a grown-up ("My grown-up is here": the same form, worded for
 * the grown-up) or to send them a link that reopens /start with the answers.
 *
 * The form is sign-up's (LoginForm's helpers and consent box, `submitStartAccount`). A sign-up that
 * comes back with a session saves the answers (`finishStart`) and moves on; one that does not
 * (email confirmation on) says to check the email, and the first sign-in on this device saves them
 * (`StartResume`). "Already have an account? Sign in" keeps the answers on the device for the same.
 */
export function StartAccount({ answers, onDone, onBack, startIn, inFlow = false, summary }: StartAccountProps) {
  const kid = answers.role === "kid";
  const name = answers.name;
  const [view, setView] = useState<View>(kid && startIn !== "form" ? "ask" : "form");
  // A kid who fetched a grown-up: the form, worded for the grown-up
  const grownUpHere = kid && view === "form";
  // The form is in the server HTML: submit stays disabled until hydration (as LoginForm's)
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [heardFrom, setHeardFrom] = useState<HeardFrom | null>(answers.heardFrom);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const shown = useRef(false);

  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    recordStartStep("start_account_shown", roleMeta(answers));
  }, [answers]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const el = { email: emailRef, password: passwordRef, consent: consentRef, heading: headingRef }[target].current;
    el?.focus();
  });

  function go(next: View) {
    setView(next);
    setFormError(null);
    setFieldErrors({});
    pendingFocus.current = "heading";
  }

  /** "Already have an account? Sign in": the answers wait on this device for that account. */
  function keepForSignIn() {
    writeStartPending(startStorage(), { ...answers, heardFrom }, Date.now(), null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    setFieldErrors({});
    setShowPassword(false);
    setBusy(true);
    const outcome = await submitStartAccount(
      { email, password, agreed, answers: { ...answers, heardFrom }, grownUpHere },
      {
        signUp: (request) => supabase.auth.signUp(request),
        finish: (userId, saved) => finishStart(client, userId, saved),
        linkJourney: linkStartJourney,
        record: recordStartStep,
        report: reportUserError,
        keep: (saved, userId) => writeStartPending(startStorage(), saved, Date.now(), userId),
        forget: () => clearStartPending(startStorage()),
      },
    );
    switch (outcome.kind) {
      case "invalid":
        setFieldErrors(outcome.errors);
        pendingFocus.current = outcome.errors.email ? "email" : outcome.errors.password ? "password" : "consent";
        setBusy(false);
        return;
      case "failed":
        if (outcome.field === "form") setFormError(outcome.message);
        else setFieldErrors({ [outcome.field]: outcome.message });
        pendingFocus.current = outcome.field === "email" ? "email" : "password";
        setBusy(false);
        return;
      case "confirm":
        setConfirmEmail(outcome.email);
        setPassword("");
        setBusy(false);
        go("confirm");
        return;
      case "done":
        clientMetric("start.account.done", { boardId: outcome.result.boardId !== null, saved: outcome.result.saved, failed: outcome.result.failed.join(",") });
        // busy stays set: the page is leaving
        onDone(outcome.next);
        return;
    }
  }

  async function sendToGrownUp() {
    const url = startAnswersLink(window.location.origin, answers);
    setLink(url);
    setCopied("idle");
    const sent = await shareStartLink(typeof navigator === "undefined" ? null : navigator, name, url);
    if (sent === "shared") {
      recordStartStep("start_handoff", { via: "share" });
      go("sent");
    } else if (sent === "unavailable") {
      go("share");
    }
  }

  async function copyLink() {
    const ok = await copyStartLink(typeof navigator === "undefined" ? null : navigator, link);
    setCopied(ok ? "copied" : "failed");
    if (ok) recordStartStep("start_handoff", { via: "copy" });
  }

  const heading = (title: string, lede: React.ReactNode) => (
    <div className={styles.heading}>
      <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
        {title}
      </h1>
      {lede && <p className={styles.lede}>{lede}</p>}
    </div>
  );

  if (view === "ask") {
    return (
      <section data-start="account" data-view="ask" className={styles.screen}>
        {heading(COPY.askTitle, COPY.askLede)}
        <div className={styles.choices}>
          <Button size="lg" className={`${styles.choice} ${styles.choicePrimary}`} onClick={() => go("form")}>
            {COPY.grownUpHere}
          </Button>
          <Button size="lg" variant="secondary" className={styles.choice} onClick={() => void sendToGrownUp()}>
            {COPY.sendIt}
          </Button>
        </div>
        {!inFlow && (
          <p className={styles.foot}>
            <button type="button" className={styles.textButton} onClick={onBack}>
              {COPY.back}
            </button>
          </p>
        )}
      </section>
    );
  }

  if (view === "share" || view === "sent") {
    const sent = view === "sent";
    return (
      <section data-start="account" data-view={view} className={styles.screen}>
        {heading(sent ? COPY.sentTitle : COPY.shareTitle, sent ? COPY.sentLede : COPY.shareLede)}
        {!sent && (
          <div className={styles.form}>
            <Input id="start-link" label={COPY.linkLabel} value={link} readOnly onFocus={(e) => e.currentTarget.select()} />
            <Button size="lg" className={styles.wide} onClick={() => void copyLink()}>
              {copied === "copied" ? COPY.copied : COPY.copy}
            </Button>
            <a href={handoffMailto(name, link)} className={styles.linkButton} onClick={() => recordStartStep("start_handoff", { via: "email" })}>
              {COPY.email}
            </a>
            <p role="status" className={styles.status}>
              {copied === "failed" ? COPY.copyFailed : ""}
            </p>
          </div>
        )}
        <p className={styles.foot}>
          <button type="button" className={styles.textButton} onClick={() => go("ask")}>
            {COPY.back}
          </button>
        </p>
      </section>
    );
  }

  if (view === "confirm") {
    return (
      <section data-start="account" data-view="confirm" className={styles.screen}>
        {heading(
          COPY.confirmTitle,
          <>
            {COPY.confirmLede}
            <span className={styles.address}>{confirmEmail}</span>
            {COPY.confirmNext(name)}
          </>,
        )}
        <p className={styles.foot}>
          <Link href={SIGN_IN_HREF} className={styles.textLink}>
            {COPY.signIn}
          </Link>
          <span>{COPY.confirmSpam}</span>
        </p>
      </section>
    );
  }

  const save = COPY.save(name);
  return (
    <section data-start="account" data-view="form" data-grown-up={grownUpHere || undefined} className={styles.screen}>
      {heading(save, grownUpHere ? COPY.grownUpLede(name) : COPY.parentLede)}
      {summary && <p className={styles.summary}>{summary}</p>}
      <form {...AUTH_FORM_METHOD} onSubmit={handleSubmit} noValidate aria-busy={busy} className={styles.form}>
        <Input
          ref={emailRef}
          id="start-email"
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
            if (formError) setFormError(null);
          }}
          readOnly={busy}
          error={fieldErrors.email}
          aria-invalid={formError ? true : undefined}
          aria-describedby={formError ? "start-error" : undefined}
        />
        <PasswordField
          ref={passwordRef}
          id="start-password"
          label="Password"
          name="password"
          autoComplete="new-password"
          value={password}
          visible={showPassword}
          onVisibleChange={setShowPassword}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
            if (formError) setFormError(null);
          }}
          readOnly={busy}
          description={fieldErrors.password ? undefined : FORM_COPY.newPasswordHint}
          error={fieldErrors.password}
          aria-invalid={formError ? true : undefined}
          aria-describedby={formError ? "start-error" : undefined}
        />
        <ConsentField
          inputRef={consentRef}
          checked={agreed}
          onChange={(next) => {
            setAgreed(next);
            if (fieldErrors.consent) setFieldErrors((f) => ({ ...f, consent: undefined }));
            if (formError) setFormError(null);
          }}
          error={fieldErrors.consent}
          disabled={busy}
        />
        <div className={styles.heard}>
          <label htmlFor="start-heard" className={styles.groupLabel}>
            {COPY.heardTitle} <span className={styles.groupHint}>{COPY.heardHint}</span>
          </label>
          <select
            id="start-heard"
            name="heard-from"
            className={styles.select}
            value={heardFrom ?? ""}
            disabled={busy}
            onChange={(e) => {
              const id = e.target.value;
              setHeardFrom(HEARD_FROM.some((h) => h.id === id) ? (id as HeardFrom) : null);
            }}
          >
            <option value="">{COPY.heardNone}</option>
            {HEARD_FROM.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </div>
        {formError && <Alert id="start-error" data-state="error" tone="danger" title={formError} />}
        <Button type="submit" size="lg" className={styles.wide} loading={busy} disabled={!hydrated}>
          {busy ? COPY.saving : save}
        </Button>
      </form>
      <div className={styles.foot}>
        <p className={styles.line}>
          {COPY.haveAccount}{" "}
          <Link href={SIGN_IN_HREF} className={styles.textLink} onClick={keepForSignIn}>
            {COPY.signIn}
          </Link>
        </p>
        {(grownUpHere || !inFlow) && (
          <button type="button" className={styles.textButton} onClick={grownUpHere ? () => go("ask") : onBack} disabled={busy}>
            {COPY.back}
          </button>
        )}
      </div>
    </section>
  );
}

export default StartAccount;
