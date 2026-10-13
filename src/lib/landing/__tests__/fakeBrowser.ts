/**
 * A small fake browser and server for the root page's tests (links.test.ts, root.test.ts,
 * sessionCookie.test.ts): a cookie jar that behaves like `document.cookie`, tab storage, and the
 * server's choice for `/` made by Next's own matcher with the real rewrite rule. Not a test file
 * itself (vitest collects `*.test.ts` only).
 */
import { vi } from "vitest";
import { matchHas } from "next/dist/shared/lib/router/utils/prepare-destination";
import { leaveSignedOut, LANDING_ROUTE, ROOT_LANDING_REWRITE, SESSION_HOP_SCRIPT, SIGNED_OUT_GATE_SCRIPT } from "../links";
import { syncSessionCookie } from "../sessionCookie";

/**
 * `document.cookie`, enough of it: `name=value` with `Max-Age=0` deleting. Modes: `blocked` keeps
 * nothing; `stuck` has a copy on another Domain the page can see and never clear; `invisible` has an
 * HttpOnly copy the server receives and the page never sees.
 */
export class CookieJar {
  private readonly store = new Map<string, string>();
  lastWrite = "";
  constructor(readonly mode: "ok" | "blocked" | "stuck" | "invisible" = "ok") {}

  get cookie(): string {
    const pairs = [...this.store].map(([k, v]) => `${k}=${v}`);
    if (this.mode === "stuck") pairs.push("agathon_session=1");
    return pairs.join("; ");
  }

  set cookie(value: string) {
    this.lastWrite = value;
    if (this.mode === "blocked") return;
    const [pair, ...attrs] = value.split(";").map((part) => part.trim());
    const at = pair.indexOf("=");
    const name = pair.slice(0, at);
    const gone = attrs.some((attr) => /^max-age=0$/i.test(attr));
    if (gone) this.store.delete(name);
    else this.store.set(name, pair.slice(at + 1));
  }

  /** The `Cookie` header the server gets. */
  get header(): string {
    return [this.cookie, this.mode === "invisible" ? "agathon_session=1" : ""].filter(Boolean).join("; ");
  }
}

/** sessionStorage, Map-backed. */
export class TabStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** What the server answers `/` with: Next's matcher over the real rule (all `missing` items absent → the landing page). */
export function serveRoot(cookieHeader: string, search: string): "landing" | "app" {
  const query: Record<string, string | string[]> = {};
  new URLSearchParams(search).forEach((value, key) => {
    const had = query[key];
    query[key] = had === undefined ? value : ([] as string[]).concat(had, value);
  });
  return matchHas({ headers: { cookie: cookieHeader } } as never, query as never, [], ROOT_LANDING_REWRITE.missing) ? "landing" : "app";
}

export interface World {
  jar: CookieJar;
  /** localStorage keys */
  local: string[];
  /** null: the tab's storage throws */
  tab: TabStorage | null;
  protocol: "https:" | "http:";
  /** What answers `/`: the real rule, or a cache that ignores it. */
  server: "rewrite" | "always-app" | "always-landing";
  /** What supabase-js concludes once auth loads (with a stored session). */
  sessionValid: boolean;
  now: number;
}

export function world(over: Partial<World> = {}): World {
  return { jar: new CookieJar(), local: [], tab: new TabStorage(), protocol: "https:", server: "rewrite", sessionValid: true, now: 1_800_000_000_000, ...over };
}

interface Page {
  window: Record<string, unknown>;
  document: { cookie: string; documentElement: { style: { visibility?: string } } };
  location: { pathname: string; search: string; hash: string; protocol: string; href: string; reload: () => void; replace: (to: string) => void };
  went: () => { reload: boolean; to: string | null; hidden: boolean };
}

/** A fresh document at `url` in this world. */
export function page(w: World, url: string): Page {
  const u = new URL(url, "https://www.agathon.app");
  let reload = false;
  let to: string | null = null;
  const style: { visibility?: string } = {};
  const location = {
    pathname: u.pathname,
    search: u.search,
    hash: u.hash,
    protocol: w.protocol,
    href: u.href,
    reload: () => {
      reload = true;
    },
    replace: (dest: string) => {
      to ??= dest;
    },
  };
  const document = {
    get cookie() {
      return w.jar.cookie;
    },
    set cookie(value: string) {
      w.jar.cookie = value;
    },
    documentElement: { style },
  };
  const local = { get length() { return w.local.length; }, key: (i: number) => w.local[i] ?? null };
  const window: Record<string, unknown> = { location };
  Object.defineProperty(window, "localStorage", { get: () => local, configurable: true });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    get: () => {
      if (!w.tab) throw new Error("SecurityError");
      return w.tab;
    },
  });
  return { window, document, location, went: () => ({ reload, to, hidden: style.visibility === "hidden" }) };
}

/** Runs one of the inline scripts in `p`. */
export function runScript(script: string, p: Page, now: number): void {
  const date = { now: () => now };
  new Function("window", "document", "location", "URLSearchParams", "Date", script)(p.window, p.document, p.location, URLSearchParams, date);
}

/** Runs `fn` with `p` as the browser's globals (for the TS side: leaveSignedOut, syncSessionCookie). */
export function withGlobals<T>(p: Page, fn: () => T): T {
  vi.stubGlobal("window", p.window);
  vi.stubGlobal("document", p.document);
  try {
    return fn();
  } finally {
    vi.unstubAllGlobals();
  }
}

export interface Visit {
  /** every page load, as `landing <url>`, `app <url>`, `login <url>` */
  loads: string[];
  /** where it settled */
  end: string;
}

/**
 * A visit to `url` until the browser stops navigating (or 25 loads, which the tests treat as a loop):
 * the server picks the page, the landing page runs SessionHop, the boards home runs its gate and,
 * after auth loads, AuthProvider's cookie sync and `leaveSignedOut`.
 */
export function visit(w: World, url: string): Visit {
  const loads: string[] = [];
  let next: string | null = url;
  while (next && loads.length < 25) {
    const at: string = next;
    next = null;
    const p = page(w, at);
    const path = p.location.pathname;
    if (path === "/login") {
      loads.push(`login ${at}`);
      break;
    }
    const kind = path === LANDING_ROUTE ? "landing" : w.server === "always-app" ? "app" : w.server === "always-landing" ? "landing" : serveRoot(w.jar.header, p.location.search);
    loads.push(`${kind} ${at}`);
    if (kind === "landing") {
      runScript(SESSION_HOP_SCRIPT, p, w.now);
    } else {
      runScript(SIGNED_OUT_GATE_SCRIPT, p, w.now);
      const gate = p.went();
      if (!gate.reload && !gate.to) {
        // auth loads (AuthProvider), then the page's own check
        const signedIn = w.local.some((k) => /^sb-.+-auth-token$/.test(k)) && w.sessionValid;
        withGlobals(p, () => {
          syncSessionCookie(signedIn);
          if (!signedIn) leaveSignedOut((dest) => p.location.replace(dest));
        });
      }
    }
    const went = p.went();
    if (went.reload) next = at;
    else if (went.to) next = went.to;
    w.now += 1500;
  }
  return { loads, end: loads[loads.length - 1] ?? "" };
}
