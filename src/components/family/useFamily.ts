"use client";

import { useCallback, useEffect, useState } from "react";
import type { FamilyState } from "@/lib/family/contracts";
import { cachedFamily, FAMILY_CHANGED_EVENT, loadFamily } from "@/lib/family/client";

/**
 * The signed-in user's family for a component: the tab's kept copy at once when there is one, then
 * GET /api/family (src/lib/family/client.ts). `state` is null while unknown and when it could not be
 * read (never an error: the switcher just does not show). `fresh` skips the kept copy on the first
 * read (the Family page, whose numbers move); `reload` re-reads past it, and so does every write
 * the family client makes (FAMILY_CHANGED_EVENT).
 */
export function useFamily(userId: string | null | undefined, opts: { fresh?: boolean } = {}): { state: FamilyState | null; loading: boolean; failed: boolean; reload: () => void } {
  const [read, setRead] = useState<{ userId: string; state: FamilyState | null } | null>(null);
  const [version, setVersion] = useState(0);
  const fresh = Boolean(opts.fresh);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void loadFamily(userId, { force: fresh || version > 0 }).then((state) => {
      if (live) setRead({ userId, state });
    });
    return () => {
      live = false;
    };
  }, [userId, version, fresh]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  // a write anywhere on the page (the Family page) re-reads every reader (the app bar's switcher)
  useEffect(() => {
    window.addEventListener(FAMILY_CHANGED_EVENT, reload);
    return () => window.removeEventListener(FAMILY_CHANGED_EVENT, reload);
  }, [reload]);
  const current = read && read.userId === userId ? read : null;
  const state = current ? current.state : userId && !fresh ? cachedFamily(userId) : null;
  return { state, loading: Boolean(userId) && !current, failed: Boolean(current) && current?.state === null, reload };
}
