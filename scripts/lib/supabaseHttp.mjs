/**
 * Minimal Supabase HTTP helpers for scripts and integration tests.
 * Plain ESM, Node 22+, global fetch only (no supabase-js, no psql).
 *
 * The client returned by createSupabaseHttp() is the "tiny client abstraction"
 * consumed by scripts/lib/rlsChecks.mjs; anything that satisfies the same
 * shape (see the RlsClient typedef there) can be swapped in for unit tests.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------- env helpers

/**
 * Load KEY=VALUE pairs from .env.local into process.env without overriding
 * variables that are already set.
 * @param {string} [cwd]
 */
export function loadDotEnvLocal(cwd = process.cwd()) {
  try {
    const text = readFileSync(resolve(cwd, ".env.local"), "utf8");
    for (const [key, value] of Object.entries(parseEnvText(text))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* no .env.local */
  }
}

/**
 * Parse dotenv-style text (KEY=VALUE, optional quotes, # comments).
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnvText(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Read the local stack's connection details via `npx supabase status -o env`.
 * Returns null when the CLI is unavailable or the stack is not running.
 * @param {string} [cwd]
 * @returns {Record<string, string> | null}
 */
export function readLocalSupabaseStatus(cwd = process.cwd()) {
  try {
    const proc = spawnSync("npx", ["supabase", "status", "-o", "env"], {
      cwd,
      encoding: "utf8",
      timeout: 90_000,
      env: { ...process.env, NO_COLOR: "1" },
    });
    if (proc.status !== 0 || !proc.stdout) return null;
    const parsed = parseEnvText(proc.stdout);
    return parsed.API_URL && parsed.ANON_KEY ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Resolve URL / anon key / service key from env, falling back to the local
 * stack for anything missing. Never falls back for a non-local URL.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ allowLocalFallback?: boolean }} [opts]
 * @returns {{ url: string | undefined, anonKey: string | undefined, serviceKey: string | undefined, source: "env" | "local-status" | "none" }}
 */
export function resolveSupabaseEnv(env = process.env, opts = {}) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL || undefined;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || undefined;
  if (url && anonKey) return { url, anonKey, serviceKey, source: "env" };
  if (opts.allowLocalFallback === false) return { url, anonKey, serviceKey, source: "none" };
  const status = readLocalSupabaseStatus();
  if (!status) return { url, anonKey, serviceKey, source: "none" };
  return {
    url: url || status.API_URL,
    anonKey: anonKey || status.ANON_KEY,
    serviceKey: serviceKey || status.SERVICE_ROLE_KEY,
    source: "local-status",
  };
}

/**
 * True for URLs that point at this machine (the only place seed data may go).
 * @param {string} target
 */
export function isLoopbackUrl(target) {
  try {
    const host = new URL(target).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- fetch plumbing

/**
 * @param {Response} res
 * @returns {Promise<{ status: number, body: unknown }>}
 */
export async function toResult(res) {
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text */
  }
  return { status: res.status, body };
}

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll GET {url}/auth/v1/health until it answers 200 or the timeout elapses.
 * @param {string} url
 * @param {{ timeoutMs?: number, intervalMs?: number, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<boolean>}
 */
export async function waitForHealth(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetchImpl(`${url}/auth/v1/health`, { signal: AbortSignal.timeout(5_000) });
      if (res.status === 200) return true;
    } catch {
      /* not up yet */
    }
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

/**
 * Build a client bound to one identity (anon when accessToken is omitted).
 * @param {{ url: string, anonKey: string, accessToken?: string | null, userId?: string | null, fetchImpl?: typeof fetch }} cfg
 */
export function createSupabaseHttp(cfg) {
  const base = cfg.url.replace(/\/$/, "");
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const token = cfg.accessToken ?? cfg.anonKey;
  /** @type {string[]} */
  const uploaded = [];

  /** @param {Record<string, string>} [extra] */
  const headers = (extra = {}) => ({
    apikey: cfg.anonKey,
    Authorization: `Bearer ${token}`,
    ...extra,
  });

  return {
    userId: cfg.userId ?? null,
    /** bucket/path of every successful upload, so a runner can garbage-collect. */
    uploaded,

    /**
     * PostgREST call. `query` values are passed through verbatim (e.g. { id: "eq.<uuid>" }).
     * @param {string} method
     * @param {string} table
     * @param {{ query?: Record<string, string>, body?: unknown, prefer?: string }} [opts]
     */
    async rest(method, table, opts = {}) {
      const qs = new URLSearchParams(opts.query ?? {}).toString();
      const res = await fetchImpl(`${base}/rest/v1/${table}${qs ? `?${qs}` : ""}`, {
        method,
        headers: headers({
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(opts.prefer ? { Prefer: opts.prefer } : {}),
        }),
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
      return toResult(res);
    },

    /**
     * @param {string} bucket
     * @param {string} path
     * @param {Uint8Array} bytes
     * @param {string} contentType
     */
    async upload(bucket, path, bytes, contentType) {
      const res = await fetchImpl(`${base}/storage/v1/object/${bucket}/${path}`, {
        method: "POST",
        headers: headers({ "Content-Type": contentType, "x-upsert": "false" }),
        body: bytes,
      });
      const out = await toResult(res);
      if (out.status >= 200 && out.status < 300) uploaded.push(`${bucket}/${path}`);
      return out;
    },

    /** Unauthenticated public-bucket read (no apikey, like an <img src>). */
    async publicRead(bucket, path) {
      const res = await fetchImpl(`${base}/storage/v1/object/public/${bucket}/${path}`);
      // Drain the body so the connection is reusable; content is irrelevant.
      await res.arrayBuffer();
      return { status: res.status, body: null };
    },

    /**
     * @param {string} bucket
     * @param {string} path
     */
    async storageDelete(bucket, path) {
      const res = await fetchImpl(`${base}/storage/v1/object/${bucket}/${path}`, {
        method: "DELETE",
        headers: headers(),
      });
      return toResult(res);
    },
  };
}

// ---------------------------------------------------------------- auth

/**
 * @typedef {{ accessToken: string, userId: string, email: string }} Session
 */

/**
 * @param {string} url
 * @param {string} anonKey
 * @param {string} email
 * @param {string} password
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function signInWithPassword(url, anonKey, email, password, fetchImpl = fetch) {
  const res = await fetchImpl(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return toResult(res);
}

/**
 * @param {string} url
 * @param {string} anonKey
 * @param {string} email
 * @param {string} password
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function signUp(url, anonKey, email, password, fetchImpl = fetch) {
  const res = await fetchImpl(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return toResult(res);
}

/**
 * Create a confirmed user with the service role key (GoTrue admin API).
 * @param {string} url
 * @param {string} serviceKey
 * @param {string} email
 * @param {string} password
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function adminCreateUser(url, serviceKey, email, password, fetchImpl = fetch) {
  const res = await fetchImpl(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  return toResult(res);
}

/**
 * @param {string} url
 * @param {string} serviceKey
 * @param {string} userId
 * @param {typeof fetch} [fetchImpl]
 */
export async function adminDeleteUser(url, serviceKey, userId, fetchImpl = fetch) {
  const res = await fetchImpl(`${url}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  return toResult(res);
}

/**
 * Obtain a usable session for a throwaway user. Prefers the admin API when a
 * service role key is available (works even when signups or confirmations are
 * on); otherwise signs up and requires the response to include a session.
 * Throws an Error whose message tells the operator exactly what to change.
 *
 * @param {{ url: string, anonKey: string, serviceKey?: string | null, email: string, password: string, fetchImpl?: typeof fetch }} cfg
 * @returns {Promise<Session>}
 */
export async function provisionUser(cfg) {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const { url, anonKey, email, password } = cfg;

  if (cfg.serviceKey) {
    const created = await adminCreateUser(url, cfg.serviceKey, email, password, fetchImpl);
    if (created.status >= 300 && !/already/i.test(JSON.stringify(created.body))) {
      throw new Error(`admin user creation failed (${created.status}): ${JSON.stringify(created.body)}`);
    }
    const signedIn = await signInWithPassword(url, anonKey, email, password, fetchImpl);
    if (signedIn.status >= 300 || !signedIn.body?.access_token) {
      throw new Error(`sign-in after admin create failed (${signedIn.status}): ${JSON.stringify(signedIn.body)}`);
    }
    return { accessToken: signedIn.body.access_token, userId: signedIn.body.user.id, email };
  }

  const res = await signUp(url, anonKey, email, password, fetchImpl);
  if (res.status >= 300) {
    const code = res.body?.error_code || res.body?.msg || res.body?.message || "";
    if (/signup_disabled|not allowed/i.test(String(code) + JSON.stringify(res.body))) {
      throw new Error(
        "Signups are disabled on this project. Either set SUPABASE_SERVICE_ROLE_KEY so verify-rls can " +
          "create confirmed throwaway users via the admin API, or temporarily enable " +
          "Authentication -> Providers -> Email -> 'Allow new users to sign up'.",
      );
    }
    throw new Error(`signup failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  if (!res.body?.access_token) {
    throw new Error(
      "Signup succeeded but returned no session: email confirmations are enabled. Either set " +
        "SUPABASE_SERVICE_ROLE_KEY (verify-rls will create pre-confirmed users) or disable " +
        "Authentication -> Providers -> Email -> 'Confirm email' for the duration of the check.",
    );
  }
  return { accessToken: res.body.access_token, userId: res.body.user.id, email };
}

/**
 * Sign in an existing user or create it when missing (for local seeding).
 * @param {{ url: string, anonKey: string, serviceKey?: string | null, email: string, password: string, fetchImpl?: typeof fetch }} cfg
 * @returns {Promise<Session & { created: boolean }>}
 */
export async function ensureUser(cfg) {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const existing = await signInWithPassword(cfg.url, cfg.anonKey, cfg.email, cfg.password, fetchImpl);
  if (existing.status < 300 && existing.body?.access_token) {
    return { accessToken: existing.body.access_token, userId: existing.body.user.id, email: cfg.email, created: false };
  }
  const session = await provisionUser(cfg);
  return { ...session, created: true };
}
