import type { Metadata } from "next";
import { ProductLine } from "@/components/login/ProductPanel";
import { ResetPasswordForm } from "@/components/login/ResetPasswordForm";
import styles from "@/components/login/auth.module.css";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Set a new password for your Agathon account.",
};

// Where the "Forgot your password?" email link lands (redirectTo in LoginForm).
// The Supabase project's Redirect URLs must allow it; the /** entries in
// docs/RUNBOOK-supabase.md section 3 already do.
export default function ResetPasswordPage() {
  return (
    <main className={styles.centered}>
      <div className={styles.centeredInner}>
        <ProductLine />
        <div className={styles.card}>
          <ResetPasswordForm />
        </div>
      </div>
    </main>
  );
}
