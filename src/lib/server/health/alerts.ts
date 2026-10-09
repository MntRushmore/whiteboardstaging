/**
 * When the owner is emailed (ALERT_RULES in src/lib/admin/contracts.ts), as pure decisions plus the
 * one function that carries them out.
 *
 * Three rules, each a small state machine kept in alert_state (one row per key):
 *
 *   down:<service>      ok ──fail×downAfterFailures──► firing ──pass──► ok
 *                       email "<service> is down: <detail>" on the way in, "still down" every
 *                       repeatAfterMin while it lasts, "back up (down N min)" on the way out.
 *   spike:errors        ok ──≥minErrors from ≥minUsers in windowMin──► firing ──under──► ok
 *                       email the top 3 error groups on the way in and every repeatAfterMin,
 *                       "back to normal" on the way out. Not counted: noise (a browser's or an
 *                       extension's own script, eventIsNoise) and the issues an admin muted
 *                       (admin_issues; issueFingerprint). An issue marked fixed still counts: if
 *                       it spikes again, that is a regression.
 *   credits:openrouter  ok ──credit < lowCreditsUsd──► firing ──credit ≥ lowCreditsUsd──► ok
 *                       one email per episode (the owner tops up by hand); re-armed by a top-up.
 *
 * Throttle. A firing email (down, still down, spike, low credit) goes at most once per
 * `repeatAfterMin` per rule, measured from the last one sent (`lastSentAt`), even across a quick
 * recovery and relapse. A recovery email goes only for an episode the owner was told about.
 *
 * Failures on the way out. A firing email that could not be sent (no ALERT_EMAIL, no Resend key,
 * Resend refused) leaves `lastSentAt` where it was, so the next run (5 minutes later) tries again.
 * Every email carries an Idempotency-Key per alert and time bucket: if alert_state cannot be saved
 * after a send, the next run decides the same email again and Resend answers with the first one
 * (a 409 for a changed body counts as sent too).
 *
 * Held checks. A failure marked `needsDatabase` (the app's own DB probe, the Stripe check's reads)
 * neither counts nor recovers while the database check fails too: one outage, one email.
 *
 * No memory. If alert_state cannot be read at all, the database is the likely cause: an email
 * "The database is down" goes out (one per repeatAfterMin bucket, by its idempotency key) when the
 * database check failed, and nothing else is decided this run.
 */
import type pino from "pino";
import { ALERT_RULES, issueFingerprint, SERVICES, type Service } from "@/lib/admin/contracts";
import { eventIsNoise } from "@/lib/server/adminConsole/noise";
import { alertEmail, type AlertEmailInput, type AlertErrorGroup } from "@/lib/email/alerts";
import type { ResendConfig, SendEmailInput, SendEmailResult } from "@/lib/email/resend";
import type { CheckResult } from "@/lib/server/health/checks";
import { loadAlertStates, mutedFingerprints, recentErrorEvents, saveAlertStates, SPIKE_READ_LIMIT, type AlertState, type ErrorEventRow, type Rest } from "@/lib/server/health/store";

export type { AlertState } from "@/lib/server/health/store";

export type AlertRules = {
  downAfterFailures: number;
  errorSpike: { windowMin: number; minErrors: number; minUsers: number };
  repeatAfterMin: number;
  lowCreditsUsd: number;
};

export const ALERT_KEYS = {
  down: (service: Service) => `down:${service}`,
  spike: "spike:errors",
  lowCredits: "credits:openrouter",
} as const;

export type AlertEmailDecision = {
  input: AlertEmailInput;
  /** Resend's Idempotency-Key: per alert and time bucket (or episode). */
  idempotencyKey: string;
  /** A firing email (moves `lastSentAt`, so it is throttled); false for a recovery. */
  firing: boolean;
};

export type Decision = { prev: AlertState; next: AlertState; email: AlertEmailDecision | null };

/** A key with no row yet: up, never alerted. */
export function idleState(key: string): AlertState {
  return { key, status: "ok", since: null, lastSentAt: null, failures: 0 };
}

const MIN = 60_000;

/** May a firing email go now? Never sent, or the last one is at least repeatAfterMin old. */
export function throttleOpen(lastSentAt: string | null, now: Date, rules: AlertRules): boolean {
  if (!lastSentAt) return true;
  const last = Date.parse(lastSentAt);
  return Number.isNaN(last) || now.getTime() - last >= rules.repeatAfterMin * MIN;
}

/** Was a firing email sent during the episode that began at `since`? */
export function notifiedSince(lastSentAt: string | null, since: string | null): boolean {
  if (!lastSentAt || !since) return false;
  return Date.parse(lastSentAt) >= Date.parse(since);
}

/** The repeatAfterMin bucket `now` falls in (a firing email's idempotency key). */
export function timeBucket(now: Date, rules: AlertRules): number {
  return Math.floor(now.getTime() / (rules.repeatAfterMin * MIN));
}

function unchanged(prev: AlertState): Decision {
  return { prev, next: prev, email: null };
}

/** The decision with a firing email if the throttle allows it (else the same state, silent). */
function fire(prev: AlertState, next: AlertState, now: Date, rules: AlertRules, email: (repeat: boolean) => Omit<AlertEmailDecision, "firing">): Decision {
  if (!throttleOpen(prev.lastSentAt, now, rules)) return { prev, next, email: null };
  const repeat = prev.status === "firing" && notifiedSince(prev.lastSentAt, next.since);
  return { prev, next: { ...next, lastSentAt: now.toISOString() }, email: { ...email(repeat), firing: true } };
}

/**
 * down:<service>. `held`: a failure that may only be the database being down (see the module
 * comment) leaves the state as it is.
 */
export function decideDown(service: Service, prev: AlertState, check: { ok: boolean; detail: string; held?: boolean }, now: Date, rules: AlertRules = ALERT_RULES): Decision {
  const nowIso = now.toISOString();
  if (check.held) return unchanged(prev);

  if (check.ok) {
    if (prev.status === "firing") {
      const downSince = prev.since ?? nowIso;
      const next: AlertState = { ...prev, status: "ok", since: nowIso, failures: 0 };
      if (!notifiedSince(prev.lastSentAt, prev.since)) return { prev, next, email: null };
      return { prev, next, email: { input: { type: "up", service, downSince }, idempotencyKey: `alert/${prev.key}/up/${Date.parse(downSince)}`, firing: false } };
    }
    if (prev.failures > 0) return { prev, next: { ...prev, failures: 0, since: nowIso }, email: null };
    return unchanged(prev);
  }

  const failures = prev.failures + 1;
  const streaking = prev.status === "firing" || prev.failures > 0;
  const since = streaking ? (prev.since ?? nowIso) : nowIso;
  if (prev.status === "ok" && failures < rules.downAfterFailures) return { prev, next: { ...prev, failures, since }, email: null };
  const next: AlertState = { ...prev, status: "firing", failures, since };
  return fire(prev, next, now, rules, (repeat) => ({
    input: { type: "down", service, detail: check.detail, since, repeat },
    idempotencyKey: `alert/${prev.key}/${repeat ? "still" : "down"}/${timeBucket(now, rules)}`,
  }));
}

export type SpikeSummary = {
  errors: number;
  users: number;
  /** most frequent first */
  groups: AlertErrorGroup[];
  /** the read hit SPIKE_READ_LIMIT: `errors` is a floor */
  capped: boolean;
};

/** Count, distinct users and the groups (kind + code + message) of the error events read. */
export function summarizeErrors(rows: ErrorEventRow[], limit = SPIKE_READ_LIMIT): SpikeSummary {
  const users = new Set<string>();
  const groups = new Map<string, AlertErrorGroup>();
  for (const r of rows) {
    if (r.user_id) users.add(r.user_id);
    const message = (r.message ?? "").trim();
    const id = JSON.stringify([r.kind, r.code ?? null, message]);
    const g = groups.get(id);
    if (g) g.count += 1;
    else groups.set(id, { kind: r.kind, code: r.code ?? null, message, count: 1 });
  }
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  return { errors: rows.length, users: users.size, groups: sorted, capped: rows.length >= limit };
}

/** The errors the spike counts: not noise, not a muted issue. */
export function spikeEvents(rows: readonly ErrorEventRow[], muted: ReadonlySet<string>): ErrorEventRow[] {
  return rows.filter((r) => !eventIsNoise(r) && !muted.has(issueFingerprint(r.kind, r.code, r.message ?? "")));
}

/** Is it a spike? At least minErrors errors from at least minUsers distinct users. */
export function isSpike(summary: SpikeSummary, rules: AlertRules = ALERT_RULES): boolean {
  return summary.errors >= rules.errorSpike.minErrors && summary.users >= rules.errorSpike.minUsers;
}

/** spike:errors. `summary` null: the events could not be read, nothing changes. */
export function decideSpike(prev: AlertState, summary: SpikeSummary | null, now: Date, rules: AlertRules = ALERT_RULES): Decision {
  if (!summary) return unchanged(prev);
  const nowIso = now.toISOString();
  if (!isSpike(summary, rules)) {
    if (prev.status !== "firing") return unchanged(prev);
    const started = prev.since ?? nowIso;
    const next: AlertState = { ...prev, status: "ok", since: nowIso, failures: 0 };
    if (!notifiedSince(prev.lastSentAt, prev.since)) return { prev, next, email: null };
    return { prev, next, email: { input: { type: "spike_over", since: started }, idempotencyKey: `alert/${prev.key}/over/${Date.parse(started)}`, firing: false } };
  }
  const since = prev.status === "firing" ? (prev.since ?? nowIso) : nowIso;
  const next: AlertState = { ...prev, status: "firing", since, failures: prev.status === "firing" ? prev.failures + 1 : 1 };
  return fire(prev, next, now, rules, (repeat) => ({
    input: { type: "spike", errors: summary.errors, users: summary.users, windowMin: rules.errorSpike.windowMin, groups: summary.groups.slice(0, 3), since, repeat, capped: summary.capped },
    idempotencyKey: `alert/${prev.key}/${repeat ? "still" : "spike"}/${timeBucket(now, rules)}`,
  }));
}

/**
 * credits:openrouter. `creditsLeftUsd` null or undefined (unknown, or the check failed): nothing
 * changes. Below the threshold: one email per episode (throttled like the rest); at or above it the
 * alert re-arms silently (the owner just topped up).
 */
export function decideLowCredits(prev: AlertState, creditsLeftUsd: number | null | undefined, now: Date, rules: AlertRules = ALERT_RULES): Decision {
  if (creditsLeftUsd === null || creditsLeftUsd === undefined || !Number.isFinite(creditsLeftUsd)) return unchanged(prev);
  const nowIso = now.toISOString();
  if (creditsLeftUsd >= rules.lowCreditsUsd) {
    if (prev.status !== "firing") return unchanged(prev);
    return { prev, next: { ...prev, status: "ok", since: nowIso, failures: 0 }, email: null };
  }
  const since = prev.status === "firing" ? (prev.since ?? nowIso) : nowIso;
  const next: AlertState = { ...prev, status: "firing", since, failures: 0 };
  if (prev.status === "firing" && notifiedSince(prev.lastSentAt, since)) return { prev, next, email: null };
  return fire(prev, next, now, rules, () => ({
    input: { type: "low_credits", creditsLeftUsd, thresholdUsd: rules.lowCreditsUsd },
    idempotencyKey: `alert/${prev.key}/low/${Date.parse(since)}`,
  }));
}

/** Every decision for one run, from the checks, the error summary and the stored states. */
export function decideAll(results: CheckResult[], summary: SpikeSummary | null, states: Map<string, AlertState>, now: Date, rules: AlertRules = ALERT_RULES): Decision[] {
  const state = (key: string) => states.get(key) ?? idleState(key);
  const databaseDown = results.some((r) => r.service === "database" && !r.ok);
  const decisions: Decision[] = [];
  for (const service of SERVICES) {
    const r = results.find((x) => x.service === service);
    if (!r) continue;
    const held = !r.ok && Boolean(r.needsDatabase) && databaseDown && service !== "database";
    decisions.push(decideDown(service, state(ALERT_KEYS.down(service)), { ok: r.ok, detail: r.detail ?? "", held }, now, rules));
  }
  decisions.push(decideSpike(state(ALERT_KEYS.spike), summary, now, rules));
  const openrouter = results.find((r) => r.service === "openrouter");
  decisions.push(decideLowCredits(state(ALERT_KEYS.lowCredits), openrouter?.creditsLeftUsd, now, rules));
  return decisions;
}

export function sameState(a: AlertState, b: AlertState): boolean {
  return a.status === b.status && a.since === b.since && a.lastSentAt === b.lastSentAt && a.failures === b.failures;
}

// ------------------------------------------------------------------ effects

export type AlertDeps = {
  rest: Rest;
  send: (message: SendEmailInput, config: ResendConfig) => Promise<SendEmailResult>;
  resend: ResendConfig;
  /** ALERT_EMAIL; null: alerts are decided and logged, never sent. */
  alertEmail: string | null;
  /** The site's origin, for the /admin link. */
  siteUrl: string;
  now: Date;
  log: pino.Logger;
  rules?: AlertRules;
};

export type AlertRunSummary = {
  /** alert_state could not be read: only the database fallback ran */
  stateless: boolean;
  /** keys firing after this run */
  firing: string[];
  sent: string[];
  skipped: string[];
  failed: string[];
};

type Delivery = "sent" | "skipped" | "failed";

/** One alert email to ALERT_EMAIL. Never throws. */
export async function deliver(deps: AlertDeps, email: Omit<AlertEmailDecision, "firing">): Promise<Delivery> {
  const rules = deps.rules ?? ALERT_RULES;
  let rendered;
  try {
    rendered = alertEmail(email.input, { siteUrl: deps.siteUrl, now: deps.now, repeatAfterMin: rules.repeatAfterMin });
  } catch (err) {
    deps.log.error({ alert: email.idempotencyKey, error: err instanceof Error ? err.message : String(err) }, "alert email could not be written");
    return "failed";
  }
  if (!deps.alertEmail) {
    deps.log.warn({ alert: email.idempotencyKey, subject: rendered.subject }, "ALERT_EMAIL is not set: alert not sent");
    return "skipped";
  }
  if (!deps.resend.apiKey?.trim()) {
    deps.log.warn({ alert: email.idempotencyKey, subject: rendered.subject }, "RESEND_API_KEY is not set: alert not sent");
    return "skipped";
  }
  const result = await deps.send(
    { to: deps.alertEmail, subject: rendered.subject, html: rendered.html, text: rendered.text, idempotencyKey: email.idempotencyKey, tags: { category: "alert", alert: email.input.type } },
    deps.resend,
  );
  if (result.ok) {
    deps.log.info({ alert: email.idempotencyKey, subject: rendered.subject, resendId: result.id }, "alert sent");
    return "sent";
  }
  // 409: this key already went out (or is going out right now) with this or an earlier body.
  if (result.status === 409) {
    deps.log.info({ alert: email.idempotencyKey, error: result.error }, "alert already sent under this key");
    return "sent";
  }
  deps.log.error({ alert: email.idempotencyKey, subject: rendered.subject, error: result.error, status: result.status }, "alert not sent");
  return "failed";
}

/**
 * Reads the alerts' memory and the recent errors, decides, sends, and saves what changed. Never
 * throws: a failure is logged and the run's summary says what happened.
 */
export async function evaluateAlerts(deps: AlertDeps, results: CheckResult[]): Promise<AlertRunSummary> {
  const rules = deps.rules ?? ALERT_RULES;
  const summary: AlertRunSummary = { stateless: false, firing: [], sent: [], skipped: [], failed: [] };
  const note = (key: string, d: Delivery) => summary[d].push(key);

  const spikeSince = new Date(deps.now.getTime() - rules.errorSpike.windowMin * MIN);
  const [statesRead, eventsRead, mutedRead] = await Promise.allSettled([loadAlertStates(deps.rest), recentErrorEvents(deps.rest, spikeSince), mutedFingerprints(deps.rest)]);

  if (statesRead.status === "rejected") {
    summary.stateless = true;
    const reason = statesRead.reason instanceof Error ? statesRead.reason.message : String(statesRead.reason);
    const database = results.find((r) => r.service === "database");
    deps.log.error({ error: reason, databaseOk: database?.ok ?? null }, "alert_state could not be read; only the database alert can go out this run");
    if (database && !database.ok) {
      const key = ALERT_KEYS.down("database");
      note(key, await deliver(deps, { input: { type: "down", service: "database", detail: database.detail ?? reason, since: deps.now.toISOString(), repeat: false }, idempotencyKey: `alert/${key}/stateless/${timeBucket(deps.now, rules)}` }));
      summary.firing.push(key);
    }
    return summary;
  }

  let spike: SpikeSummary | null = null;
  let muted = new Set<string>();
  if (mutedRead.status === "fulfilled") muted = mutedRead.value;
  else deps.log.warn({ error: mutedRead.reason instanceof Error ? mutedRead.reason.message : String(mutedRead.reason) }, "admin_issues could not be read; muted issues count towards the spike this run");
  // Capped is about the read (SPIKE_READ_LIMIT rows came back), whatever is left out of the count.
  if (eventsRead.status === "fulfilled") spike = { ...summarizeErrors(spikeEvents(eventsRead.value, muted)), capped: eventsRead.value.length >= SPIKE_READ_LIMIT };
  else deps.log.warn({ error: eventsRead.reason instanceof Error ? eventsRead.reason.message : String(eventsRead.reason) }, "app_events could not be read; the error spike is not judged this run");

  const decisions = decideAll(results, spike, statesRead.value, deps.now, rules);
  await Promise.all(
    decisions.map(async (d) => {
      if (!d.email) return;
      const outcome = await deliver(deps, d.email);
      note(d.next.key, outcome);
      // Not sent: the throttle must not count it, so the next run tries again.
      if (outcome !== "sent" && d.email.firing) d.next = { ...d.next, lastSentAt: d.prev.lastSentAt };
    }),
  );

  summary.firing = decisions.filter((d) => d.next.status === "firing").map((d) => d.next.key);
  const changed = decisions.filter((d) => !sameState(d.prev, d.next)).map((d) => d.next);
  if (changed.length) {
    try {
      await saveAlertStates(deps.rest, changed);
    } catch (err) {
      deps.log.error({ error: err instanceof Error ? err.message : String(err), keys: changed.map((s) => s.key) }, "alert_state could not be saved");
    }
  }
  return summary;
}
