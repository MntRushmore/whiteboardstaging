"use client";

import { useCallback, useState } from "react";
import { ADMIN_ROUTES, AdminOverviewSchema, type AdminOverview, type HealthResult } from "@/lib/admin/contracts";
import { AUTO_REFRESH_MS, parseHealthResults } from "@/lib/admin/view";
import { describeError } from "@/lib/errorMessage";
import { adminFetch } from "./adminData";
import { reloadResource, useAdminResource } from "./useAdminResource";

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

/**
 * The overview for the signed-in admin (useAdminResource: read when the page opens, every
 * AUTO_REFRESH_MS while the tab is visible, at once when it comes back after longer than that, and
 * on Refresh; one read at a time; a failed refresh keeps the last overview). `checkNow` runs the
 * health checks (GET /api/admin/health with the admin's token), then reads the overview again.
 */
export function useAdminOverview(userId: string | undefined): {
  data: OverviewData;
  refresh: () => void;
  check: CheckState;
  checkNow: () => void;
} {
  const resource = useAdminResource(userId ? ADMIN_ROUTES.overview : null, AdminOverviewSchema, { pollMs: AUTO_REFRESH_MS });
  const [check, setCheck] = useState<CheckState>(IDLE_CHECK);

  const checkNow = useCallback(() => {
    setCheck((c) => ({ ...c, running: true, error: null }));
    void (async () => {
      let next: CheckState;
      try {
        const res = await adminFetch(ADMIN_ROUTES.health, { cache: "no-store" });
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
      await reloadResource(ADMIN_ROUTES.overview, AdminOverviewSchema);
      setCheck(next);
    })();
  }, []);

  return {
    data: { overview: resource.data, loading: resource.loading, error: resource.error, notFound: resource.notFound, signedOut: resource.signedOut },
    refresh: resource.refresh,
    check,
    checkNow,
  };
}
