import type { Metadata } from "next";
import { ProductLine } from "@/components/login/ProductPanel";
import { ResetPasswordForm } from "@/components/login/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Set a new password for your Agathon Classroom account.",
};

// Where the "Forgot your password?" email link lands (redirectTo in LoginForm).
// The Supabase project's Redirect URLs must allow it; the /** entries in
// docs/RUNBOOK-supabase.md section 3 already do.
export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center bg-background px-4 pt-12 pb-10 sm:justify-center sm:bg-muted/50 sm:px-6 sm:py-10">
      <div className="w-full max-w-sm sm:max-w-md">
        <ProductLine className="mb-10 sm:mb-6 sm:px-1" />
        <div className="sm:rounded-xl sm:border sm:bg-card sm:p-8 sm:shadow-sm">
          <ResetPasswordForm />
        </div>
      </div>
    </main>
  );
}
