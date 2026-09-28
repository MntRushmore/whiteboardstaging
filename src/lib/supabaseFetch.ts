/**
 * The fetch the browser's Supabase client uses. A session minted a moment ago can reach
 * PostgREST a fraction of a second "early" by its clock: the first request after sign-in is
 * then refused with 401 PGRST303 "JWT issued at future" — the boards list showed "your device
 * clock looks off" about one sign-in in four locally. The same request a second later goes
 * through; a device whose clock really is off still fails the one retry, and the page says so
 * (`CLOCK_SKEW_MESSAGE`).
 */
export const SKEW_RETRY_MS = 1100;

const SKEW_BODY = /PGRST303|issued at future/i;

export interface SkewFetchDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps = (): SkewFetchDeps => ({
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

export function createSkewRetryFetch(deps: SkewFetchDeps = defaultDeps()): typeof fetch {
  return async (input, init) => {
    const res = await deps.fetch(input, init);
    if (res.status !== 401) return res;
    let body = "";
    try {
      body = await res.clone().text();
    } catch {
      return res;
    }
    if (!SKEW_BODY.test(body)) return res;
    await deps.sleep(SKEW_RETRY_MS);
    return deps.fetch(input, init);
  };
}
