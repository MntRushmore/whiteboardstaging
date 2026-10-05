"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ADMIN_ROUTES, AdminOverviewSchema, type AdminOverview, type HealthResult } from "@/lib/admin/contracts";
import { ADMIN_COPY, AUTO_REFRESH_MS, parseHealthResults } from "@/lib/admin/view";
import { apiErrorFromResponse, authedFetch, isApiError } from "@/lib/api-client";
import { describeError } from "@/lib/errorMessage";

export interface OverviewData {
  overview: AdminOverview | null;
  /** a read is in flight (the first, or a refresh: the last overview stays on screen) */
  loading: boolean;
  /** the last read failed (with an overview from before, the page keeps it and says so) */
  error: string | null;
  /** the server says this page does not exist for this user (not an admin) */
  notFound: boolean;
  /** signed out under us: the page goes to /login */
  signedOut: boolean;
}

export interface CheckState {
  running: boolean;
  error: string | null;
  /** what the checks found, when the health route said (shown while the overview cannot load) */
  results: HealthResult[] | null;
  /** when the last check finished */
  at: number | null;
}

const IDLE_CHECK: CheckState = { running: false, error: null, results: null, at: null };

/** One read of the overview, as the page sees it. */
async function readOverview(): Promise<Partial<OverviewData> & { overview?: AdminOverview }> {
  try {
    const res = await authedFetch(ADMIN_ROUTES.overview, { cache: "no-store" });
    if (res.status === 404) return { notFound: true, error: null };
    if (res.status === 401) return { signedOut: true, error: null };
    if (!res.ok) throw await apiErrorFromResponse(res);
    const parsed = AdminOverviewSchema.safeParse(await res.json());
    if (!parsed.success) return { error: ADMIN_COPY.badShape };
    return { overview: parsed.data, error: null, notFound: false };
  } catch (err) {
    if (isApiError(err, "unauthorized")) return { signedOut: true, error: null };
    return { error: describeError(err, ADMIN_COPY.loadFallback) };
  }
}

/**
 * The overview for the signed-in admin: read when the page opens, every AUTO_REFRESH_MS while the
 * tab is visible, at once when it comes back after longer than that, and on Refresh. One read at a
 * time; a failed refresh keeps the last overview. `checkNow` runs the health checks
 * (GET /api/admin/health with the admin's token), then reads the overview again.
 */
export function useAdminOverview(userId: string | undefined): {
  data: OverviewData;
  refresh: () => void;
  check: CheckState;
  checkNow: () => void;
} {
  const [data, setData] = useState<OverviewData>({ overview: null, loading: true, error: null, notFound: false, signedOut: false });
  const [check, setCheck] = useState<CheckState>(IDLE_CHECK);
  const inFlight = useRef<Promise<void> | null>(null);
  const lastReadAt = useRef(0);

  const load = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      setData((d) => ({ ...d, loading: true }));
      const next = await readOverview();
      lastReadAt.current = Date.now();
      setData((d) => ({ ...d, ...next, loading: false }));
    })().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = run;
    return run;
  }, []);

  useEffect(() => {
    if (!userId) return;
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, AUTO_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastReadAt.current >= AUTO_REFRESH_MS) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, load]);

  const refresh = useCallback(() => void load(), [load]);

  const checkNow = useCallback(() => {
    setCheck((c) => ({ ...c, running: true, error: null }));
    void (async () => {
      let next: CheckState;
      try {
        const res = await authedFetch(ADMIN_ROUTES.health, { cache: "no-store" });
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const message = body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string" ? (body as { message: string }).message : `the server answered ${res.status}`;
          next = { running: false, error: message, results: null, at: null };
        } else {
          next = { running: false, error: null, results: parseHealthResults(body), at: Date.now() };
        }
      } catch (err) {
        next = { running: false, error: describeError(err, "the request didn't go through"), results: null, at: null };
      }
      // a read already under way started before the check wrote its rows: read again after it
      if (inFlight.current) await inFlight.current;
      await load();
      setCheck(next);
    })();
  }, [load]);

  return { data, refresh, check, checkNow };
}
