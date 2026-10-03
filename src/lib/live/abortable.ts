/**
 * `promise`, or a rejection the moment `signal` aborts. For awaits an abort cannot reach on its own:
 * `authedFetch` reads the session (`supabase.auth.getSession()`) before `fetch` ever sees the
 * signal, so a session read that hangs (a token refresh stuck on a dead connection) left Live's and
 * the Ask panel's timeouts aborting a request that never started, and their spinners running.
 * The rejection is the signal's reason when it is an Error (a timeout's own error), else an
 * AbortError. `promise` is still handled when it settles later, so it never rejects unhandled.
 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new DOMException("aborted", "AbortError"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}
