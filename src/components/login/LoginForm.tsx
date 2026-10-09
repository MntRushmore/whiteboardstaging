"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Ref } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, MailCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { Alert } from "@/registry/components/alert/alert";
import { Button } from "@/registry/components/button/button";
import { Input } from "@/registry/components/input/input";
import { PasswordField } from "@/registry/components/password-field/password-field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/registry/components/tabs/tabs";
import { LANDING_PATH, wantsSignUp } from "@/lib/landing/links";
import { loginErrorField, loginErrorMessage, loginFailureReport } from "@/lib/loginErrorMessage";
import { reportUserError } from "@/lib/reportAppError";
import {
  AUTH_FORM_METHOD,
  FORM_COPY,
  afterSignInPath,
  hasFieldErrors,
  signUpRequest,
  validateLoginForm,
  type FieldErrors,
  type LoginMode,
} from "@/lib/loginForm";
import styles from "./auth.module.css";

const HEADINGS: Record<LoginMode, { title: string; lede: string }> = {
  signin: { title: "Welcome back", lede: "Sign in to open your boards." },
  signup: { title: "Create your account", lede: "All it takes is an email and a password." },
  forgot: {
    title: "Reset your password",
    lede: "Enter the email you signed up with and we'll send you a link to choose a new password.",
  },
};

const SUBMIT_LABEL: Record<LoginMode, { idle: string; busy: string }> = {
  signin: { idle: "Sign in", busy: "Signing in…" },
  signup: { idle: "Create account", busy: "Creating account…" },
  forgot: { idle: "Send reset link", busy: "Sending…" },
};

/** What was emailed, shown in place of the form until the user goes back. */
type Sent = { kind: "confirm-signup" | "reset"; email: string };

type FocusTarget = "email" | "password" | "consent" | "heading";

const CONSENT_ERROR_ID = "login-consent-error";

/**
 * Sign-up's consent: the Terms, the Privacy Policy and the age statement, in one box. Required
 * here (validateLoginForm) and by the database, which refuses an account whose sign-up does not
 * carry the Terms version (signUpRequest). The links open a new tab so the form keeps what was
 * typed.
 */
export function ConsentField({
  checked,
  onChange,
  error,
  disabled,
  inputRef,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div className={styles.consent}>
      <label className={styles.consentLabel}>
        <input
          ref={inputRef}
          type="checkbox"
          name="consent"
          required
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? CONSENT_ERROR_ID : undefined}
          className={styles.checkbox}
        />
        <span className={styles.consentText}>
          <span>
            I agree to the{" "}
            <Link href="/terms" target="_blank" rel="noopener" className={styles.consentLink}>
              Terms<span className={styles.srOnly}> (opens in a new tab)</span>
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank" rel="noopener" className={styles.consentLink}>
              Privacy Policy<span className={styles.srOnly}> (opens in a new tab)</span>
            </Link>
            .
          </span>
          <span>I&rsquo;m 13 or older, or I&rsquo;m a parent or guardian setting this up for my child.</span>
        </span>
      </label>
      {error && (
        <p id={CONSENT_ERROR_ID} className={styles.consentError}>
          {error}
        </p>
      )}
    </div>
  );
}

const subscribeNever = () => () => {};

export function LoginForm() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  // The form is in the server HTML, so it can be submitted before React attaches onSubmit (a
  // slow load, a quick Enter on an iPad). Submit stays disabled until hydration, which also stops
  // Enter (implicit submission does nothing while the default button is disabled); the form
  // posts (AUTH_FORM_METHOD) in case anything submits it anyway.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  // The landing page's "Start your free week" opens the form on Sign up (/login?mode=signup); a
  // tab the user picks wins from then on.
  const askedSignUp = useSyncExternalStore(subscribeNever, () => wantsSignUp(window.location.search), () => false);
  const [chosenMode, setMode] = useState<LoginMode | null>(null);
  const mode: LoginMode = chosenMode ?? (askedSignUp ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Sign-up's consent box; kept when switching tabs, like the email.
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Inline error about the attempt as a whole; cleared when the user edits or switches tabs.
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Set by handlers, applied after the next commit (the target may have just mounted).
  const pendingFocus = useRef<FocusTarget | null>(null);

  useEffect(() => {
    if (!authLoading && user) {
      router.replace(afterSignInPath(window.location.search));
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const el = { email: emailRef, password: passwordRef, consent: consentRef, heading: headingRef }[target].current;
    el?.focus();
    if (el instanceof HTMLInputElement && target === "password") el.select();
  });

  // A session exists (just signed in, or already signed in): the effect above is redirecting.
  const redirecting = Boolean(user) && !submitting;
  const busy = submitting || redirecting;

  /** `focus` null leaves focus where it is (arrow keys moving between the tabs). */
  function switchMode(next: LoginMode, focus: FocusTarget | null) {
    if (busy) return;
    setMode(next);
    setFieldErrors({});
    setFormError(null);
    setSent(null);
    pendingFocus.current = focus;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const address = email.trim();
    const errors = validateLoginForm(mode, address, password, agreed);
    setFormError(null);
    setFieldErrors(errors);
    if (hasFieldErrors(errors)) {
      pendingFocus.current = errors.email ? "email" : errors.password ? "password" : "consent";
      return;
    }
    setShowPassword(false);
    setSubmitting(true);

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: address,
          password,
        });
        if (error) throw error;
        // no toast: the boards opening is the confirmation (a toast lingered over the cards)
        router.replace(afterSignInPath(window.location.search));
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp(signUpRequest(address, password));
        if (error) throw error;
        if (data.session) {
          router.replace(afterSignInPath(window.location.search));
        } else {
          // Email confirmation is on: there is no session until the link is opened.
          setSent({ kind: "confirm-signup", email: address });
          setPassword("");
          pendingFocus.current = "heading";
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(address, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setSent({ kind: "reset", email: address });
        pendingFocus.current = "heading";
      }
    } catch (error) {
      console.warn("Auth submit failed:", error);
      const message = loginErrorMessage(error);
      const field = loginErrorField(error);
      // Our failures (the network, a rate limit, the sign-in service) go to the admin page — never
      // the student's own mistakes (a wrong password, a weak one), never the address.
      const failure = loginFailureReport(error, mode);
      if (failure) reportUserError(failure);
      if (field === "form") setFormError(message);
      else setFieldErrors({ [field]: message });
      // Inline only: a toast repeating the same sentence read as noise, on phones especially.
      pendingFocus.current = field === "email" || mode === "forgot" ? "email" : "password";
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div data-state={`sent-${sent.kind}`} className={styles.state}>
        <AuthErrorBanner className="mb-6" />
        <MailCheck className={styles.stateIcon} size={24} strokeWidth={1.75} aria-hidden />
        <div className={styles.heading}>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            Check your email
          </h1>
          {/* The address gets its own line so a long or hyphenated one never breaks mid-word. */}
          <p className={styles.lede}>
            {sent.kind === "confirm-signup"
              ? "We sent a confirmation link to:"
              : "If this email has an account, a link to choose a new password is on its way to:"}
            <span className={styles.address}>{sent.email}</span>
            {sent.kind === "confirm-signup" && "Open it, then come back here to sign in."}
          </p>
        </div>
        <Button variant="secondary" size="lg" className={styles.wide} onClick={() => switchMode("signin", "password")}>
          Back to sign in
        </Button>
        <p className={styles.note}>Nothing after a few minutes? Check your spam folder, or go back and try again.</p>
      </div>
    );
  }

  const label = SUBMIT_LABEL[mode];

  const form = (
    <form {...AUTH_FORM_METHOD} onSubmit={handleSubmit} noValidate aria-busy={busy} className={styles.form}>
      <Input
        ref={emailRef}
        id="login-email"
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
        aria-describedby={formError ? "login-error" : undefined}
      />

      {mode !== "forgot" && (
        <PasswordField
          ref={passwordRef}
          id="login-password"
          label="Password"
          name="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          visible={showPassword}
          onVisibleChange={setShowPassword}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
            if (formError) setFormError(null);
          }}
          readOnly={busy}
          description={mode === "signup" && !fieldErrors.password ? FORM_COPY.newPasswordHint : undefined}
          error={fieldErrors.password}
          aria-invalid={formError ? true : undefined}
          aria-describedby={formError ? "login-error" : undefined}
        />
      )}

      {mode === "signup" && (
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
      )}

      {formError && <Alert id="login-error" data-state="error" tone="danger" title={formError} />}

      <Button type="submit" size="lg" className={styles.submit} loading={busy} disabled={!hydrated}>
        {redirecting ? "Opening your boards…" : busy ? label.busy : label.idle}
      </Button>

      {mode === "signin" && (
        <button type="button" onClick={() => switchMode("forgot", "email")} className={styles.textButton}>
          Forgot your password?
        </button>
      )}
      {mode === "forgot" && (
        <button type="button" onClick={() => switchMode("signin", "password")} className={styles.textButton}>
          <ArrowLeft size={14} strokeWidth={1.75} aria-hidden />
          Back to sign in
        </button>
      )}
    </form>
  );

  return (
    <div data-state={mode}>
      <AuthErrorBanner className="mb-6" />
      <div className={styles.heading}>
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          {HEADINGS[mode].title}
        </h1>
        <p className={styles.lede}>{HEADINGS[mode].lede}</p>
      </div>

      {mode === "forgot" ? (
        form
      ) : (
        <Tabs value={mode} onValueChange={(v) => switchMode(v as LoginMode, null)}>
          <TabsList aria-label="Sign in or create an account">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Sign up</TabsTrigger>
          </TabsList>
          {/* One panel, always the active tab's, so there is only ever one form (and one "Email" field);
              forceMount keeps it in place while the tab changes. tabIndex -1: Tab goes from the tabs to Email. */}
          <TabsContent value={mode} forceMount tabIndex={-1}>
            {form}
          </TabsContent>
        </Tabs>
      )}
      {mode !== "forgot" && (
        <p className={styles.newHere}>
          New to Agathon?{" "}
          <Link href={LANDING_PATH} className={styles.newHereLink}>
            See how it works
          </Link>
        </p>
      )}
    </div>
  );
}
