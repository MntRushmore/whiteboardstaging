"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { ButtonLink } from "@/components/app/ButtonLink";
import { Alert } from "@/registry/components/alert/alert";
import { Button } from "@/registry/components/button/button";
import { PasswordField } from "@/registry/components/password-field/password-field";
import { Skeleton } from "@/registry/components/skeleton/skeleton";
import { loginErrorField, loginErrorMessage } from "@/lib/loginErrorMessage";
import { AUTH_FORM_METHOD, FORM_COPY, RESET_LINK_COPY, hashHasAuthError, validateNewPassword } from "@/lib/loginForm";
import styles from "./auth.module.css";

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * Second half of "Forgot your password?". The email link signs the user in
 * with a recovery session (supabase-js reads it from the URL hash and emits
 * PASSWORD_RECOVERY), so by the time AuthProvider settles there is a user and
 * all that is left is updateUser({ password }).
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const { user, loading: authLoading, authError } = useAuth();
  const linkFailed = useSyncExternalStore(
    subscribeToHash,
    () => hashHasAuthError(window.location.hash),
    () => false,
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || done) return;
    const invalid = validateNewPassword(password);
    setFormError(null);
    setFieldError(invalid);
    if (invalid) {
      passwordRef.current?.focus();
      return;
    }
    setShowPassword(false);
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      toast.success("Password updated");
      router.replace("/");
    } catch (error) {
      console.warn("Password update failed:", error);
      const message = loginErrorMessage(error);
      if (loginErrorField(error) === "password") setFieldError(message);
      else setFormError(message);
      passwordRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading && !authError) {
    return <Skeleton className={styles.checking} label="Checking your reset link" lines={3} />;
  }

  if (!user) {
    return (
      <div data-state={linkFailed ? "link-expired" : "link-missing"} className={styles.state}>
        <AuthErrorBanner className="mb-6" />
        {linkFailed ? (
          <TriangleAlert className={styles.stateIcon} size={24} strokeWidth={1.75} aria-hidden />
        ) : (
          <KeyRound className={styles.stateIcon} size={24} strokeWidth={1.75} aria-hidden />
        )}
        <div className={styles.heading}>
          <h1 className={styles.title}>{linkFailed ? RESET_LINK_COPY.expiredTitle : RESET_LINK_COPY.missingTitle}</h1>
          <p className={styles.lede}>{linkFailed ? RESET_LINK_COPY.expired : RESET_LINK_COPY.missing}</p>
        </div>
        <ButtonLink href="/login" size="lg" className={styles.wide}>
          Back to sign in
        </ButtonLink>
      </div>
    );
  }

  const busy = submitting || done;

  return (
    <div data-state="reset-form">
      <AuthErrorBanner className="mb-6" />
      <div className={styles.heading}>
        <h1 className={styles.title}>Choose a new password</h1>
        <p className={styles.lede}>
          For <strong>{user.email}</strong>. You&rsquo;ll use it the next time you sign in.
        </p>
      </div>
      {/* Rendered only once auth has loaded (after hydration); posts anyway, so a password can never land in a URL. */}
      <form {...AUTH_FORM_METHOD} onSubmit={handleSubmit} noValidate aria-busy={busy} className={styles.form}>
        {/* Tells password managers which saved login this new password belongs to. */}
        <input type="email" name="email" autoComplete="username" value={user.email ?? ""} readOnly hidden />
        <PasswordField
          ref={passwordRef}
          id="reset-password"
          label="New password"
          name="password"
          autoComplete="new-password"
          value={password}
          visible={showPassword}
          onVisibleChange={setShowPassword}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldError) setFieldError(undefined);
            if (formError) setFormError(null);
          }}
          readOnly={busy}
          description={fieldError ? undefined : FORM_COPY.newPasswordHint}
          error={fieldError}
          aria-invalid={formError ? true : undefined}
          aria-describedby={formError ? "reset-error" : undefined}
        />
        {formError && <Alert id="reset-error" data-state="error" tone="danger" title={formError} />}
        <Button type="submit" size="lg" className={styles.submit} loading={busy}>
          {done ? "Opening your boards…" : submitting ? "Saving…" : "Save password"}
        </Button>
      </form>
    </div>
  );
}
