/**
 * Issues: the app_events of the last 1, 7 or 30 days that are the same problem, grouped by
 * `issueFingerprint(kind, code, message)` (src/lib/admin/contracts.ts), with what the admin decided
 * about each (admin_issues: open, muted, fixed, a note).
 *
 * Read: errors and warnings of the window (health checks aside: they have their own section),
 * newest first, at most ISSUE_ROW_CAP, without `meta` (only the top of the stack, for the noise
 * rule); then the full rows of each issue's latest ISSUE_SAMPLES (their meta, in batches by id), the
 * samples' emails, and every admin_issues row (one per issue anyone touched: a small table).
 *
 * An issue reads as its latest event (kind, code, source, level, message). `perDay` is the window in
 * 24-hour steps ending now, oldest first. `regressed`: marked fixed, then seen after `fixedAt`.
 * `noise`: every event of it is noise (a browser's or an extension's script). Muted and noise issues
 * stay in the list (the page filters them); the error-spike alert leaves both out
 * (src/lib/server/health/alerts.ts).
 */
import { issueFingerprint, ISSUE_STATUSES, type AdminIssue, type AdminIssueList, type EventLevel, type EventSource, type IssueStatus } from "@/lib/admin/contracts";
import { auditChange } from "./audit";
import { DAY_MS, EVENT_SELECT, inList, toAdminEvent, type EventRow } from "./events";
import { eventIsNoise } from "./noise";
import { restClient, type ConsoleDeps, type Rest } from "./rest";

export const ISSUE_DAYS = [1, 7, 30] as const;
export type IssueDays = (typeof ISSUE_DAYS)[number];
/** Events read per list at most (30 days of errors and warnings). */
export const ISSUE_ROW_CAP = 10_000;
/** Samples per issue. */
export const ISSUE_SAMPLES = 5;
/** Sample rows fetched per request (ids in the query string). */
const SAMPLE_BATCH = 150;

/** An app_events row as the grouping reads it (no meta: the stack's top only). */
export interface IssueEventRow {
  id: number;
  at: string;
  source: string;
  level: string;
  kind: string;
  code: string | null;
  message: string | null;
  user_id: string | null;
  board_id: string | null;
  stack: string | null;
}

export interface IssueStateRow {
  fingerprint: string;
  status: string;
  note: string | null;
  fixed_at: string | null;
  updated_at?: string | null;
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

type Acc = {
  issue: Omit<AdminIssue, "samples" | "status" | "note" | "fixedAt" | "regressed" | "users" | "boards">;
  users: Set<string>;
  boards: Set<string>;
  /** every event's id and time (the latest ISSUE_SAMPLES become the samples) */
  events: Array<{ id: number; t: number }>;
  latest: number;
};

/**
 * The grouping, pure: newest-first events of the window in, issues out (most recent first) with the
 * ids of their samples, which `buildIssueList` turns into full events.
 */
export function groupIssues(
  events: readonly IssueEventRow[],
  states: ReadonlyMap<string, IssueStateRow>,
  now: number,
  days: number,
): Array<Omit<AdminIssue, "samples"> & { sampleIds: number[] }> {
  const start = now - days * DAY_MS;
  const groups = new Map<string, Acc>();
  for (const e of events) {
    const t = time(e.at);
    if (!Number.isFinite(t) || t < start) continue;
    const fingerprint = issueFingerprint(e.kind, e.code, e.message ?? "");
    let acc = groups.get(fingerprint);
    if (!acc) {
      acc = {
        users: new Set(),
        boards: new Set(),
        events: [],
        latest: -Infinity,
        issue: {
          fingerprint,
          kind: e.kind,
          code: e.code ?? null,
          source: e.source as EventSource,
          level: e.level as EventLevel,
          message: e.message ?? "",
          count: 0,
          firstAt: e.at,
          lastAt: e.at,
          perDay: Array.from({ length: days }, () => 0),
          noise: true,
        },
      };
      groups.set(fingerprint, acc);
    }
    const g = acc.issue;
    g.count += 1;
    if (e.user_id) acc.users.add(e.user_id);
    if (e.board_id) acc.boards.add(e.board_id);
    if (!eventIsNoise(e)) g.noise = false;
    if (t < time(g.firstAt)) g.firstAt = e.at;
    if (t > acc.latest) {
      // the issue reads as its latest event
      acc.latest = t;
      g.lastAt = e.at;
      g.kind = e.kind;
      g.code = e.code ?? null;
      g.source = e.source as EventSource;
      g.level = e.level as EventLevel;
      g.message = e.message ?? "";
    }
    g.perDay[Math.min(days - 1, Math.max(0, Math.floor((t - start) / DAY_MS)))] += 1;
    acc.events.push({ id: Number(e.id), t });
  }

  return [...groups.values()]
    .map((acc) => {
      const state = states.get(acc.issue.fingerprint);
      const status: IssueStatus = state && (ISSUE_STATUSES as readonly string[]).includes(state.status) ? (state.status as IssueStatus) : "open";
      const fixedAt = status === "fixed" ? (state?.fixed_at ?? null) : null;
      const ids = acc.events
        .sort((a, b) => b.t - a.t || b.id - a.id)
        .slice(0, ISSUE_SAMPLES)
        .map((x) => x.id);
      return {
        ...acc.issue,
        users: acc.users.size,
        boards: acc.boards.size,
        status,
        note: state?.note ?? null,
        fixedAt,
        regressed: status === "fixed" && fixedAt !== null && time(acc.issue.lastAt) > time(fixedAt),
        sampleIds: ids,
      };
    })
    .sort((a, b) => time(b.lastAt) - time(a.lastAt) || b.count - a.count);
}

/** Every issue state anyone set (admin_issues: one row per touched issue). */
export async function issueStates(rest: Rest): Promise<Map<string, IssueStateRow>> {
  const { rows } = await rest.paged<IssueStateRow>({ table: "admin_issues", params: { select: "fingerprint,status,note,fixed_at,updated_at", order: "fingerprint.asc" } });
  return new Map(rows.map((r) => [r.fingerprint, r]));
}

/** The full rows of these events (their meta), in batches by id. */
async function eventsById(rest: Rest, ids: readonly number[]): Promise<Map<number, EventRow>> {
  const batches: number[][] = [];
  for (let i = 0; i < ids.length; i += SAMPLE_BATCH) batches.push(ids.slice(i, i + SAMPLE_BATCH) as number[]);
  const found = await Promise.all(batches.map((batch) => rest.rows<EventRow>({ table: "app_events", params: { select: EVENT_SELECT, id: inList(batch.map(String)) } })));
  return new Map(found.flat().map((e) => [Number(e.id), e]));
}

export async function buildIssueList(deps: ConsoleDeps, days: IssueDays): Promise<AdminIssueList> {
  const rest = restClient(deps);
  const now = rest.now;
  const [events, states] = await Promise.all([
    rest.paged<IssueEventRow>(
      {
        table: "app_events",
        params: {
          select: "id,at,source,level,kind,code,message,user_id,board_id,stack:meta->>stack",
          at: `gte.${new Date(now - days * DAY_MS).toISOString()}`,
          level: "in.(error,warn)",
          source: "neq.health",
          order: "at.desc,id.desc",
        },
      },
      ISSUE_ROW_CAP,
    ),
    issueStates(rest),
  ]);
  const grouped = groupIssues(events.rows, states, now, days);
  const full = await eventsById(rest, grouped.flatMap((g) => g.sampleIds));
  const emails = await rest.emails([...full.values()].map((e) => e.user_id));
  const issues: AdminIssue[] = grouped.map(({ sampleIds, ...issue }) => ({
    ...issue,
    samples: sampleIds.map((id) => full.get(id)).filter((e): e is EventRow => Boolean(e)).map((e) => toAdminEvent(e, emails)),
  }));
  return { generatedAt: new Date(now).toISOString(), days, issues };
}

export interface IssuePatch {
  fingerprint: string;
  status: IssueStatus;
  /** null clears it; absent leaves it */
  note?: string | null;
}

export interface IssueState {
  fingerprint: string;
  status: IssueStatus;
  note: string | null;
  fixedAt: string | null;
  updatedAt: string;
}

/**
 * Open, mute or mark fixed (fixedAt now: an event after it is a regression; marking it fixed again
 * starts over). The state as stored. Logged as `issue.update`.
 */
export async function patchIssue(deps: ConsoleDeps, patch: IssuePatch, adminId: string): Promise<IssueState> {
  const rest = restClient(deps);
  const nowIso = new Date(rest.now).toISOString();
  const row = await rest.upsert<IssueStateRow & { updated_at: string }>(
    "admin_issues",
    "fingerprint",
    {
      fingerprint: patch.fingerprint,
      status: patch.status,
      fixed_at: patch.status === "fixed" ? nowIso : null,
      updated_at: nowIso,
      updated_by: adminId,
      ...(patch.note !== undefined ? { note: patch.note === null || patch.note.trim() === "" ? null : patch.note } : {}),
    },
    "fingerprint,status,note,fixed_at,updated_at",
  );
  await auditChange(rest, {
    adminId,
    action: "issue.update",
    targetKind: "issue",
    targetId: patch.fingerprint,
    meta: { status: patch.status, ...(patch.note !== undefined ? { note: patch.note ? "set" : "cleared" } : {}) },
  });
  return {
    fingerprint: row.fingerprint,
    status: (ISSUE_STATUSES as readonly string[]).includes(row.status) ? (row.status as IssueStatus) : patch.status,
    note: row.note ?? null,
    fixedAt: row.fixed_at ?? null,
    updatedAt: row.updated_at ?? nowIso,
  };
}
