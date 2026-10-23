/**
 * A streamed `application/x-ndjson` answer: one JSON object a line, enqueued (so flushed) the moment
 * it is emitted. `run(emit, signal)` produces the lines; `signal` aborts when the client goes away
 * (the request's own signal) or the stream is cancelled. The stream closes when `run` settles.
 */
export const NDJSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  "X-Accel-Buffering": "no",
};

export function ndjsonResponse<E>(
  req: Request,
  run: (emit: (event: E) => void, signal: AbortSignal) => Promise<void>,
  headers: Record<string, string> = {},
): Response {
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  req.signal?.addEventListener("abort", onAbort, { once: true });
  if (req.signal?.aborted) controller.abort();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const emit = (event: E) => {
        if (closed || controller.signal.aborted) return;
        try {
          ctrl.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          ctrl.close();
        } catch {
          /* already closed */
        }
      };
      run(emit, controller.signal)
        .catch(() => undefined)
        .finally(() => {
          req.signal?.removeEventListener("abort", onAbort);
          close();
        });
    },
    cancel() {
      closed = true;
      controller.abort();
    },
  });
  return new Response(stream, { status: 200, headers: { ...NDJSON_HEADERS, ...headers } });
}
