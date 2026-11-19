/**
 * A streamed `application/x-ndjson` answer: one JSON object a line, enqueued (so flushed) the moment
 * it is emitted. `run(emit, signal)` produces the lines; `signal` aborts when the client goes away
 * (the request's own signal) or the stream is cancelled. The stream closes when `run` settles.
 *
 * KEEPALIVE (`pingMs`): a `{"type":"ping"}` line whenever nothing else has been written for that
 * long. The picture tutor's painter (and its check and repaint) can sit silent for 20 s and more, and
 * the iPad's URLSession gives up after 30 s with no byte (URLSessionTransport.makeSession). The iPad
 * reads a line of a type it doesn't know as nothing (BoardDrawDecoding.event → nil) but still counts
 * its bytes as activity, so a ping keeps the connection open and changes nothing else.
 */
export const PING_LINE = '{"type":"ping"}\n';

export type NdjsonOptions = { pingMs?: number };
export const NDJSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  "X-Accel-Buffering": "no",
};

export function ndjsonResponse<E>(
  req: Request,
  run: (emit: (event: E) => void, signal: AbortSignal) => Promise<void>,
  headers: Record<string, string> = {},
  options: NdjsonOptions = {},
): Response {
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  req.signal?.addEventListener("abort", onAbort, { once: true });
  if (req.signal?.aborted) controller.abort();
  let closed = false;

  let pinger: ReturnType<typeof setInterval> | undefined;
  const stopPinging = () => {
    if (pinger !== undefined) clearInterval(pinger);
    pinger = undefined;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      let lastWrite = Date.now();
      const write = (line: string) => {
        if (closed || controller.signal.aborted) return;
        try {
          ctrl.enqueue(encoder.encode(line));
          lastWrite = Date.now();
        } catch {
          closed = true;
        }
      };
      const emit = (event: E) => write(`${JSON.stringify(event)}\n`);
      const pingMs = options.pingMs;
      if (pingMs && pingMs > 0) {
        // checked a few times a ping period: a ping goes out only after pingMs of silence
        pinger = setInterval(() => {
          if (closed || controller.signal.aborted) return stopPinging();
          if (Date.now() - lastWrite >= pingMs) write(PING_LINE);
        }, Math.max(5, Math.floor(pingMs / 4)));
      }
      const close = () => {
        stopPinging();
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
      stopPinging();
      controller.abort();
    },
  });
  return new Response(stream, { status: 200, headers: { ...NDJSON_HEADERS, ...headers } });
}
