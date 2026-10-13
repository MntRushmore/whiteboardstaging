/**
 * The browser's half of the steps before the account (/start, src/lib/start/contracts.ts
 * `START_EVENTS`): each step is one POST to `START_STEP_API` (the server's half,
 * src/app/api/start/step/route.ts), counted anonymously by journey, a random id this device keeps
 * in localStorage under `START_STORAGE_KEY` (the `journeyId` field of the flow's own object; the
 * other fields are left as they are). Once the account exists, `linkStartJourney` ties the journey
 * to it (`link_start_journey`, which also records `start_account`), and the account's own funnel
 * takes over (src/lib/funnel/record.ts).
 *
 * Fire and forget: the flow never waits on its own bookkeeping, so `recordStartStep` returns
 * nothing and never throws, and `linkStartJourney` never rejects. The request is `keepalive`, so a
 * step sent right before the page leaves still arrives. No storage (a private window, blocked site
 * data): the journey lives for this page load only.
 *
 * What the flow records when a screen shows (`REPEAT_SAFE`) goes at most once per journey per page
 * load: StrictMode runs effects twice in dev, and a re-render is not the step happening again. An
 * answer goes every time; the server counts it (`times`). `start_account` is never sent from here:
 * only linking records it, as the new account.
 *
 * Light on purpose: /start's first screens import it, so it brings nothing but the contract; the
 * Supabase client `linkStartJourney` needs is loaded when it is first called.
 */
import { START_EVENTS, START_STEP_API, START_STORAGE_KEY, type StartEvent } from "./contracts";

/** A step's small details, as START_EVENTS notes them ({ role }, { grade } or { course }, { count }, { solved }). */
export type StartStepMeta = Record<string, string | number | boolean | null>;

/** As much of localStorage as this needs (either call may throw). */
export type StartStorage = Pick<Storage, "getItem" | "setItem">;

/** The part of a Supabase client `linkStartJourney` uses, signed in as the new account. */
export interface StartRpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

/** The RPC the new account calls to link the journey to itself (supabase/migrations/20261013020000_start_steps.sql). */
export const LINK_START_JOURNEY = "link_start_journey";

/** The accounts this device has linked its journey to (a JSON list of user ids), so it links at most once per account. */
export const START_LINKED_KEY = `${START_STORAGE_KEY}.linked`;

/** The steps that are a screen showing: sent at most once per journey per page load. */
export const REPEAT_SAFE: ReadonlySet<StartEvent> = new Set<StartEvent>(["start_shown", "start_try_shown", "start_plan", "start_account_shown", "start_handoff_opened"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const META_KEY = /^[a-z][a-zA-Z0-9_]{0,31}$/;
const MAX_META_KEYS = 8;
/** StartStepRequestSchema's limit on a string detail */
const MAX_META_TEXT = 40;
/** how many accounts the device remembers linking (a shared family computer) */
const MAX_LINKED = 20;

export function isStartEvent(value: unknown): value is StartEvent {
  return typeof value === "string" && (START_EVENTS as readonly string[]).includes(value);
}

/**
 * `meta` as the route takes it, or null when nothing is left: at most 8 keys named like
 * identifiers, finite numbers, booleans, null, and strings cut to 40 characters. Anything else is
 * dropped, not sent. (The server keeps only the keys each event may keep.)
 */
export function cleanStartStepMeta(meta: Record<string, unknown> | null | undefined): StartStepMeta | null {
  if (!meta || typeof meta !== "object") return null;
  const out: StartStepMeta = {};
  let n = 0;
  for (const [key, value] of Object.entries(meta)) {
    if (n >= MAX_META_KEYS) break;
    if (!META_KEY.test(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, MAX_META_TEXT);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean" || value === null) out[key] = value;
    else continue;
    n += 1;
  }
  return n > 0 ? out : null;
}

/** A random v4 uuid: crypto.randomUUID where the page is a secure context, else from getRandomValues. */
export function randomUuid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface StartRecorderDeps {
  /** the browser's fetch; undefined on the server, where nothing is sent */
  fetch: typeof fetch | undefined;
  /** localStorage, or null when there is none (it may also throw) */
  storage: () => StartStorage | null;
  /** the signed-in Supabase client, loaded when a journey is first linked; null when there is none */
  client: () => Promise<StartRpcClient | null>;
  uuid?: () => string;
  /** the route (START_STEP_API) */
  endpoint?: string;
}

export interface StartRecorder {
  recordStartStep: (event: StartEvent, meta?: StartStepMeta) => void;
  linkStartJourney: (userId: string) => Promise<void>;
  /** this device's journey, made (and kept) when there is none; null only when one cannot be made */
  journeyId: () => string | null;
}

function readObject(store: StartStorage | null, key: string): Record<string, unknown> | null {
  const raw = store?.getItem(key);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function createStartRecorder(deps: StartRecorderDeps): StartRecorder {
  const endpoint = deps.endpoint ?? START_STEP_API;
  const uuid = deps.uuid ?? randomUuid;
  /** the journey for this page load when storage cannot keep it (and the last one seen when it can) */
  let memory: string | null = null;
  /** `<journey>:<event>` of the screens sent this page load */
  const sent = new Set<string>();
  /** the accounts linked (or being linked) this page load */
  const linking = new Set<string>();

  function store(): StartStorage | null {
    try {
      return deps.storage();
    } catch {
      return null;
    }
  }

  /** The journey the device keeps, without making one. */
  function storedJourney(s: StartStorage | null): { id: string | null; state: Record<string, unknown> | null } {
    try {
      const state = readObject(s, START_STORAGE_KEY);
      const id = state?.journeyId;
      return { id: typeof id === "string" && UUID.test(id) ? id : null, state };
    } catch {
      return { id: null, state: null };
    }
  }

  function journeyId(): string | null {
    const s = store();
    const { id, state } = storedJourney(s);
    if (id) {
      memory = id;
      return id;
    }
    try {
      memory = memory ?? uuid();
    } catch {
      return null;
    }
    // keep it beside whatever else the flow keeps there
    try {
      s?.setItem(START_STORAGE_KEY, JSON.stringify({ ...(state ?? {}), journeyId: memory }));
    } catch {
      // no storage: the journey lasts this page load
    }
    return memory;
  }

  function recordStartStep(event: StartEvent, meta?: StartStepMeta): void {
    const send = deps.fetch;
    if (!send || !isStartEvent(event) || event === "start_account") return;
    try {
      const journey = journeyId();
      if (!journey) return;
      if (REPEAT_SAFE.has(event)) {
        const key = `${journey}:${event}`;
        if (sent.has(key)) return;
        sent.add(key);
      }
      const details = cleanStartStepMeta(meta);
      void send(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(details ? { journeyId: journey, event, meta: details } : { journeyId: journey, event }),
        keepalive: true,
        credentials: "same-origin",
      }).catch(() => undefined);
    } catch {
      // the step is not counted, and nothing else changes
    }
  }

  async function linkStartJourney(userId: string): Promise<void> {
    if (typeof userId !== "string" || !userId || linking.has(userId)) return;
    linking.add(userId);
    try {
      const s = store();
      let linked: string[] = [];
      try {
        const raw = s?.getItem(START_LINKED_KEY);
        const list: unknown = raw ? JSON.parse(raw) : [];
        linked = Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
      } catch {
        linked = [];
      }
      if (linked.includes(userId)) return;
      const journey = storedJourney(s).id ?? memory;
      if (!journey) {
        // nothing to link on this device (yet): a later call may find one
        linking.delete(userId);
        return;
      }
      const client = await deps.client();
      if (!client) {
        linking.delete(userId);
        return;
      }
      const { error } = await client.rpc(LINK_START_JOURNEY, { p_journey: journey });
      if (error) {
        // signed out, offline, or a database without it: a later call tries again
        linking.delete(userId);
        return;
      }
      try {
        s?.setItem(START_LINKED_KEY, JSON.stringify([...linked, userId].slice(-MAX_LINKED)));
      } catch {
        // linked; the device just cannot remember it past this page load
      }
    } catch {
      linking.delete(userId);
    }
  }

  return { recordStartStep, linkStartJourney, journeyId };
}

const recorder = createStartRecorder({
  fetch: typeof window === "undefined" ? undefined : (input, init) => window.fetch(input, init),
  storage: () => (typeof window === "undefined" ? null : window.localStorage),
  client: async () => {
    if (typeof window === "undefined") return null;
    const { supabase } = await import("@/lib/supabase");
    return supabase;
  },
});

/**
 * Counts one step of /start for this device's journey (fire and forget; see the file comment).
 * The flow calls it when a screen shows (`start_shown`, `start_try_shown`, `start_plan`,
 * `start_account_shown`, `start_handoff_opened`: once a page load) and on each answer, with the
 * details START_EVENTS notes and nothing else (never the name). `start_account` does nothing here:
 * call `linkStartJourney` once the account exists.
 */
export function recordStartStep(event: StartEvent, meta?: StartStepMeta): void {
  recorder.recordStartStep(event, meta);
}

/**
 * Ties this device's journey to the new account, as that account (the app's Supabase client must
 * be signed in as `userId`): its steps become the account's and `start_account` is recorded. At
 * most once per account per device (remembered under START_LINKED_KEY; a failed call is tried
 * again on the next one). Never rejects. Call it before the flow forgets the journey.
 */
export function linkStartJourney(userId: string): Promise<void> {
  return recorder.linkStartJourney(userId);
}
