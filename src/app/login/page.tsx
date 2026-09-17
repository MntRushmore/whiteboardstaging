"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { loginErrorMessage } from "@/lib/loginErrorMessage";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading: authLoading, authError } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Inline error under the form; cleared when the user edits or switches tabs.
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && user) {
      router.replace("/");
    }
  }, [user, authLoading, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        toast.success("Signed in");
        router.replace("/");
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          toast.success("Account created");
          router.replace("/");
        } else {
          toast.success("Account created — check your email to confirm.");
          setMode("signin");
        }
      }
    } catch (error) {
      console.warn("Auth submit failed:", error);
      const message = loginErrorMessage(error);
      setFormError(message);
      // The toast is a secondary cue; the inline text is the source of truth.
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  // Spin only while the session lookup is in flight (or we are about to
  // redirect). A failed lookup falls through and shows the banner + form.
  if ((authLoading && !authError) || user) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">
            Agathon Classroom
          </h1>
          <p className="text-sm text-muted-foreground mt-3">
            Sign in to your AI whiteboard.
          </p>
        </div>

        <AuthErrorBanner className="mb-4" />

        <Tabs
          value={mode}
          onValueChange={(v) => {
            setMode(v as "signin" | "signup");
            setFormError(null);
          }}
          className="mb-6"
        >
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="signin">Sign In</TabsTrigger>
            <TabsTrigger value="signup">Sign Up</TabsTrigger>
          </TabsList>
          <TabsContent value="signin" />
          <TabsContent value="signup" />
        </Tabs>

        <form onSubmit={handleSubmit} className="space-y-4" aria-busy={submitting}>
          <div>
            <Label htmlFor="email" className="mb-1.5 block">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (formError) setFormError(null);
              }}
              placeholder="you@example.com"
              required
              autoComplete="email"
              disabled={submitting}
              aria-invalid={formError ? true : undefined}
            />
          </div>
          <div>
            <Label htmlFor="password" className="mb-1.5 block">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (formError) setFormError(null);
              }}
              placeholder="••••••••"
              required
              minLength={6}
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              disabled={submitting}
              aria-invalid={formError ? true : undefined}
              aria-describedby={formError ? "login-error" : undefined}
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {submitting
              ? mode === "signin"
                ? "Signing in…"
                : "Creating account…"
              : mode === "signin"
                ? "Sign In"
                : "Create Account"}
          </Button>
          {formError && (
            <p
              id="login-error"
              role="alert"
              data-state="error"
              className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2"
            >
              {formError}
            </p>
          )}
        </form>
      </Card>
    </div>
  );
}
