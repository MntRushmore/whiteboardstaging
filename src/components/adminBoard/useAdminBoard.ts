"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ADMIN_API, ADMIN_LIMITS, AdminBoardDocSchema, AdminBoardUnchangedSchema, type AdminBoardDoc } from "@/lib/admin/contracts";
import { apiErrorFromResponse, authedFetch, isApiError } from "@/lib/api-client";
import { describeError } from "@/lib/errorMessage";
import { ADMIN_BOARD_COPY, shouldAutoFollow } from "./view";

export interface AdminBoardData {
  doc: AdminBoardDoc | null;
  loading: boolean;
  error: string | null;
  /** the server says this page does not exist for this user (not an admin, or no such board) */
  notFound: boolean;
  signedOut: boolean;
  /** the last follow-live check failed (the board on screen stays) */
  followError: string | null;
}

type Read = { doc?: AdminBoardDoc; unchanged?: true; notFound?: true; signedOut?: true; error?: string };

/** One read: the board, or (with `since`) word that it has not changed. */
async function readBoard(id: string, since: number | null, fixture: string | null): Promise<Read> {
  if (fixture && process.env.NODE_ENV !== "production") return readFixture(fixture, since);
  try {
    const url = since === null ? ADMIN_API.board(id) : `${ADMIN_API.board(id)}?since=${since}`;
    const res = await authedFetch(url, { cache: "no-store" });
    if (res.status === 404) return { notFound: true };
    if (res.status === 401) return { signedOut: true };
    if (!res.ok) throw await apiErrorFromResponse(res);
    const body: unknown = await res.json();
    if (since !== null && AdminBoardUnchangedSchema.safeParse(body).success) return { unchanged: true };
    const parsed = AdminBoardDocSchema.safeParse(body);
    if (!parsed.success) return { error: ADMIN_BOARD_COPY.badShape };
    return { doc: parsed.data };
  } catch (err) {
    if (isApiError(err, "unauthorized")) return { signedOut: true };
    return { error: describeError(err, ADMIN_BOARD_COPY.loadFallback) };
  }
}

/** Development only (see src/lib/replay/devFixture.ts): the same answers, made up in the browser. */
async function readFixture(name: string, since: number | null): Promise<Read> {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  const { DEV_FIXTURE_NAMES, devFixtureDoc } = await import("@/lib/replay/devFixture");
  const [fixture, strokes, perPage] = name.split(":");
  if (!(DEV_FIXTURE_NAMES as readonly string[]).includes(fixture)) return { notFound: true };
  let snapshot: unknown;
  if (fixture === "file") {
    const res = await fetch("/dev-fixtures/board.json", { cache: "no-store" });
    if (!res.ok) return { error: "Put a board export at public/dev-fixtures/board.json (never committed)." };
    const raw = (await res.json()) as { data?: unknown };
    snapshot = raw && typeof raw === "object" && "data" in raw ? raw.data : raw;
  }
  const doc = devFixtureDoc(fixture as Parameters<typeof devFixtureDoc>[0], { strokes: Number(strokes) || undefined, perPage: Number(perPage) || undefined, snapshot });
  if (since !== null && since === doc.board.version) return { unchanged: true };
  const parsed = AdminBoardDocSchema.safeParse(doc);
  return parsed.success ? { doc: parsed.data } : { error: ADMIN_BOARD_COPY.badShape };
}

/**
 * One board for the admin's viewer: read when the page opens, then, while "Follow live" is on and
 * the tab is visible, asked again every ADMIN_LIMITS.followPollMs with `?since=<version>` (an
 * unchanged board answers in a few bytes). Following starts by itself for a board saved in the last
 * two minutes, unless the admin has switched it themselves.
 */
export function useAdminBoard(
  id: string,
  userId: string | undefined,
  fixture: string | null,
): { data: AdminBoardData; follow: boolean; setFollow: (on: boolean) => void; retry: () => void } {
  const [data, setData] = useState<AdminBoardData>({ doc: null, loading: true, error: null, notFound: false, signedOut: false, followError: null });
  const [follow, setFollowState] = useState(false);
  const chosen = useRef(false);
  const version = useRef<number | null>(null);
  const inFlight = useRef(false);
  const [attempt, setAttempt] = useState(0);

  const setFollow = useCallback((on: boolean) => {
    chosen.current = true;
    setFollowState(on);
  }, []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // the first read
  useEffect(() => {
    if (!userId && !fixture) return;
    let cancelled = false;
    void (async () => {
      setData((d) => ({ ...d, loading: true }));
      const r = await readBoard(id, null, fixture);
      if (cancelled) return;
      if (r.doc) {
        version.current = r.doc.board.version;
        if (!chosen.current && shouldAutoFollow(r.doc.board.updatedAt, Date.now())) setFollowState(true);
      }
      setData((d) => ({ ...d, loading: false, doc: r.doc ?? d.doc, error: r.error ?? null, notFound: !!r.notFound, signedOut: !!r.signedOut }));
    })();
    return () => {
      cancelled = true;
    };
  }, [id, userId, fixture, attempt]);

  // following
  useEffect(() => {
    if (!follow || (!userId && !fixture)) return;
    const poll = async () => {
      if (document.visibilityState !== "visible" || inFlight.current || version.current === null) return;
      inFlight.current = true;
      try {
        const r = await readBoard(id, version.current, fixture);
        if (r.doc) {
          version.current = r.doc.board.version;
          const doc = r.doc;
          setData((d) => ({ ...d, doc, followError: null }));
        } else if (r.unchanged) setData((d) => (d.followError ? { ...d, followError: null } : d));
        else if (r.notFound || r.signedOut) setData((d) => ({ ...d, notFound: !!r.notFound, signedOut: !!r.signedOut }));
        else setData((d) => ({ ...d, followError: ADMIN_BOARD_COPY.followFailed }));
      } finally {
        inFlight.current = false;
      }
    };
    const timer = window.setInterval(() => void poll(), ADMIN_LIMITS.followPollMs);
    const onVisible = () => void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [follow, id, userId, fixture]);

  return { data, follow, setFollow, retry };
}
