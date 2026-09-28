"use client";

import { useCallback, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionError } from "@/components/account/SectionError";
import { SECTION_BODY, SectionHeader } from "@/components/account/SectionHeader";
import { useSection } from "@/components/account/useSection";
import { describeError } from "@/lib/errorMessage";
import {
  ACCOUNT_COPY,
  DISPLAY_NAME_MAX,
  displayNameError,
  normalizeDisplayName,
} from "@/lib/billing/accountState";
import { cn } from "@/lib/utils";

type Profile = { display_name: string | null };

const PROFILE_MISSING = "Your profile isn't set up yet. Retry in a moment.";

/** Email (read-only) and an inline display-name editor backed by `profiles.display_name`. */
export function ProfileCard({ userId, email }: { userId: string; email: string }) {
  const read = useCallback(async (): Promise<Profile> => {
    const { data, error } = await supabase.from("profiles").select("display_name").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return { display_name: (data as Profile | null)?.display_name ?? null };
  }, [userId]);
  const { state, retry } = useSection<Profile>(read, true, ACCOUNT_COPY.profileFallback);

  // Inline edit state. `saved` overrides the loaded value after a successful save
  // so we do not need to re-fetch.
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);

  const displayName = saved !== undefined ? saved : state.data?.display_name ?? null;

  function startEdit() {
    setDraft(displayName ?? "");
    setValidation(null);
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    if (saving) return;
    setEditing(false);
    setSaveError(null);
    setValidation(null);
  }

  async function save() {
    if (saving) return;
    const problem = displayNameError(draft);
    setValidation(problem);
    if (problem) return;
    setSaving(true);
    setSaveError(null);
    const next = normalizeDisplayName(draft);
    try {
      // display_name is the only user-updatable column; RLS restricts the row to auth.uid().
      const { data, error } = await supabase
        .from("profiles")
        .update({ display_name: next })
        .eq("user_id", userId)
        .select("display_name")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(PROFILE_MISSING);
      setSaved((data as Profile).display_name ?? null);
      setEditing(false);
    } catch (err) {
      console.warn("Display name not saved:", err);
      setSaveError(describeError(err, ACCOUNT_COPY.saveNameFallback));
    } finally {
      setSaving(false);
    }
  }

  const row = "grid gap-1 px-3 py-3 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4";

  return (
    <Card>
      <SectionHeader
        title="Profile"
        description="How you appear in the app. Your email is your sign-in and can't be changed here."
      />
      <CardContent className={SECTION_BODY}>
        <dl className="divide-y rounded-lg border text-sm">
          <div className={cn(row, "sm:items-center")}>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium break-all" data-testid="profile-email">
              {email}
            </dd>
          </div>
          <div className={cn(row, editing ? "sm:items-start" : "sm:items-center")}>
            <dt className={cn("text-muted-foreground", editing && "sm:pt-2")}>Display name</dt>
            <dd className="min-w-0">
              {state.status === "loading" && !state.data && saved === undefined ? (
                <div className="h-8 w-40 animate-pulse rounded bg-muted/60" data-state="loading" />
              ) : state.status === "error" && !state.data && saved === undefined ? (
                <SectionError title={ACCOUNT_COPY.profileFailedTitle} message={state.error} onRetry={retry} />
              ) : editing ? (
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save();
                  }}
                >
                  <Label htmlFor="display-name" className="sr-only">
                    Display name
                  </Label>
                  <Input
                    id="display-name"
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      if (validation) setValidation(null);
                    }}
                    maxLength={DISPLAY_NAME_MAX + 20}
                    autoFocus
                    disabled={saving}
                    placeholder="Your name"
                    aria-invalid={validation || saveError ? true : undefined}
                    aria-describedby={validation ? "display-name-error" : undefined}
                  />
                  {validation && (
                    <p id="display-name-error" role="alert" className="text-sm text-red-700">
                      {validation}
                    </p>
                  )}
                  {saveError && (
                    <SectionError
                      title={ACCOUNT_COPY.saveNameFailedTitle}
                      message={saveError}
                      onRetry={() => void save()}
                      retrying={saving}
                    />
                  )}
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={saving}>
                      {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                      {saveError ? "Try again" : "Save"}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={cancelEdit} disabled={saving}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate font-medium" data-testid="profile-display-name">
                    {displayName ?? <span className="font-normal text-muted-foreground">Not set</span>}
                  </p>
                  <Button variant="ghost" size="sm" className="-my-1 -mr-2 shrink-0" onClick={startEdit} aria-label="Edit display name">
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </Button>
                </div>
              )}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
