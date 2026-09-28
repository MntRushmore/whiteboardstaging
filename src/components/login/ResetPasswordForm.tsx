"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/login/PasswordInput";
import { FieldError, FormError, INVALID_INPUT } from "@/components/login/formParts";
import { loginErrorField, loginErrorMessage } from "@/lib/loginErrorMessage";
import { FORM_COPY, RESET_LINK_COPY, hashHasAuthError, validateNewPassword } from "@/lib/loginForm";

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
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Checking your reset link">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (!user) {
    return (
      <div data-state={linkFailed ? "link-expired" : "link-missing"}>
        <AuthErrorBanner className="mb-6" />
        <div className="mb-5 flex size-11 items-center justify-center rounded-full border bg-muted">
          {linkFailed ? <TriangleAlert className="size-5" aria-hidden /> : <KeyRound className="size-5" aria-hidden />}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {linkFailed ? RESET_LINK_COPY.expiredTitle : RESET_LINK_COPY.missingTitle}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {linkFailed ? RESET_LINK_COPY.expired : RESET_LINK_COPY.missing}
        </p>
        <Button asChild size="lg" className="mt-6 w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  const busy = submitting || done;
  const describedBy = [fieldError ? "reset-password-error" : "reset-password-hint", formError ? "reset-error" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div data-state="reset-form">
      <AuthErrorBanner className="mb-6" />
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          For <span className="font-medium text-foreground">{user.email}</span>. You&rsquo;ll use it the next
          time you sign in.
        </p>
      </div>
      <form onSubmit={handleSubmit} noValidate aria-busy={busy} className="grid gap-4">
        {/* Tells password managers which saved login this new password belongs to. */}
        <input type="email" name="email" autoComplete="username" value={user.email ?? ""} readOnly hidden />
        <div className="grid gap-2">
          <Label htmlFor="reset-password">New password</Label>
          <PasswordInput
            ref={passwordRef}
            id="reset-password"
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
            aria-invalid={fieldError || formError ? true : undefined}
            aria-describedby={describedBy}
            className={fieldError ? INVALID_INPUT : undefined}
          />
          {fieldError ? (
            <FieldError id="reset-password-error" message={fieldError} />
          ) : (
            <p id="reset-password-hint" className="text-sm text-muted-foreground">
              {FORM_COPY.newPasswordHint}
            </p>
          )}
        </div>
        <FormError id="reset-error" message={formError} />
        <Button type="submit" size="lg" className="mt-1 w-full disabled:opacity-80" disabled={busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {done ? "Opening your boards…" : submitting ? "Saving…" : "Save password"}
        </Button>
      </form>
    </div>
  );
}
