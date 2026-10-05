#!/usr/bin/env node
/**
 * Make an account an admin of the /admin page, or stop it being one: a row in `public.admins`
 * (supabase/migrations/20261005000000_admin.sql), which only the service role can write. The
 * migration names nobody on purpose (no user ids in the repo), so this is how the owner's account
 * becomes the admin, once per project.
 *
 *   node scripts/make-admin.mjs <email> [--remove]
 *
 *   <email>    the account's sign-in email (it must have signed up already)
 *   --remove   take admin away instead
 *
 * Env (read from .env.local when not already set; for the local stack, `npx supabase status`
 * fills in what is missing):
 *   NEXT_PUBLIC_SUPABASE_URL     the project URL
 *   SUPABASE_SERVICE_ROLE_KEY    REQUIRED: `admins` is the service role's alone
 *
 * Which project it acts on is whatever those name, printed first. For production, give both on the
 * command line, where they win over .env.local:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service role key> \
 *     node scripts/make-admin.mjs rushilchopra@gmail.com
 *
 * The admin routes cache each user's answer for 60 s per server instance (src/lib/server/admin.ts),
 * so a change takes effect within a minute. Safe to repeat: adding an admin twice, or removing one
 * who is not, changes nothing and says so.
 *
 * Exit codes: 0 done (or nothing to do), 1 no account with that email or a request failed, 2 usage
 * or config error.
 */
import { pathToFileURL } from "node:url";
import { isLoopbackUrl, loadDotEnvLocal, resolveSupabaseEnv, toResult } from "./lib/supabaseHttp.mjs";

export const USAGE = "usage: node scripts/make-admin.mjs <email> [--remove]";

/** Accounts per page of the Auth admin API's user list (its maximum). */
export const PER_PAGE = 1000;
/** Pages read at most (a million accounts): a guard against an API that never ends its list. */
const MAX_PAGES = 1000;

/**
 * Parse CLI arguments. Throws on an unknown flag, a missing email or more than one.
 * @param {string[]} argv
 * @returns {{ email: string, remove: boolean, help: boolean }}
 */
export function parseArgs(argv) {
  /** @type {string[]} */
  const emails = [];
  let remove = false;
  let help = false;
  for (const arg of argv) {
    if (arg === "--remove") remove = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg.startsWith("-")) throw new Error(`unknown argument: ${arg}`);
    else emails.push(arg);
  }
  if (help) return { email: "", remove, help };
  if (emails.length !== 1) throw new Error(emails.length ? "one email at a time" : "an email is required");
  const email = emails[0].trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`not an email: ${email}`);
  return { email, remove, help };
}

/** @param {string} serviceKey */
const serviceHeaders = (serviceKey) => ({ apikey: serviceKey, Authorization: `Bearer ${serviceKey}` });

/**
 * The Auth user with this email (any case), through the Auth admin API's paged user list (it has
 * no lookup by email). Null when there is none.
 * @param {{ url: string, serviceKey: string, email: string, fetchImpl?: typeof fetch }} cfg
 * @returns {Promise<{ id: string, email: string } | null>}
 */
export async function findUserByEmail({ url, serviceKey, email, fetchImpl = fetch }) {
  const base = url.replace(/\/+$/, "");
  const want = email.trim().toLowerCase();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetchImpl(`${base}/auth/v1/admin/users?page=${page}&per_page=${PER_PAGE}`, { headers: serviceHeaders(serviceKey) });
    const out = await toResult(res);
    if (out.status !== 200) throw new Error(`listing accounts failed (${out.status}): ${JSON.stringify(out.body).slice(0, 200)}`);
    const body = /** @type {{ users?: Array<{ id?: unknown, email?: unknown }> } | null} */ (out.body);
    const users = Array.isArray(body?.users) ? body.users : [];
    const hit = users.find((u) => typeof u?.email === "string" && u.email.toLowerCase() === want);
    if (hit && typeof hit.id === "string") return { id: hit.id, email: String(hit.email) };
    if (users.length < PER_PAGE) return null;
  }
  return null;
}

/**
 * Add `userId` to `admins`, or remove it (`remove`). `changed` is false when there was nothing to
 * do (already an admin; not an admin).
 * @param {{ url: string, serviceKey: string, userId: string, remove: boolean, fetchImpl?: typeof fetch }} cfg
 * @returns {Promise<{ changed: boolean }>}
 */
export async function setAdmin({ url, serviceKey, userId, remove, fetchImpl = fetch }) {
  const base = `${url.replace(/\/+$/, "")}/rest/v1/admins`;
  const headers = { ...serviceHeaders(serviceKey), "Content-Type": "application/json", Accept: "application/json" };
  const res = remove
    ? await fetchImpl(`${base}?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE", headers: { ...headers, Prefer: "return=representation" } })
    : // an existing row is left as it is (its added_at kept) and comes back as no rows
      await fetchImpl(`${base}?on_conflict=user_id`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify({ user_id: userId }),
      });
  const out = await toResult(res);
  if (out.status < 200 || out.status >= 300) {
    throw new Error(`${remove ? "removing" : "adding"} the admin failed (${out.status}): ${JSON.stringify(out.body).slice(0, 200)}`);
  }
  return { changed: Array.isArray(out.body) && out.body.length > 0 };
}

// ---------------------------------------------------------------- CLI

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  loadDotEnvLocal();

  /** @type {{ email: string, remove: boolean, help: boolean }} */
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
    process.exit(2);
  }
  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const { url, serviceKey } = resolveSupabaseEnv(process.env);
  if (!url || !serviceKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Set them in the environment or .env.local, or start the local stack with `npx supabase start`.",
    );
    process.exit(2);
  }
  console.log(`Target: ${url}${isLoopbackUrl(url) ? " (local)" : " (NOT local)"}`);

  try {
    const user = await findUserByEmail({ url, serviceKey, email: args.email });
    if (!user) {
      console.error(`No account with the email ${args.email} on this project: sign up first, then run this again.`);
      process.exit(1);
    }
    const { changed } = await setAdmin({ url, serviceKey, userId: user.id, remove: args.remove });
    if (args.remove) console.log(changed ? `${user.email} is no longer an admin.` : `${user.email} was not an admin: nothing changed.`);
    else console.log(changed ? `${user.email} is now an admin (user ${user.id}).` : `${user.email} was already an admin: nothing changed.`);
    if (changed) console.log("It takes effect within a minute (each server instance keeps the answer for 60 s).");
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
