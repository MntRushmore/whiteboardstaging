import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ token: "jwt-token" as string | null }));
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: session.token ? { access_token: session.token } : null } }) } },
}));

import { fetchSpeech, SPEAK_PATH } from "../speakClient";
import { SpeechFetchError } from "../speaker";

const signal = () => new AbortController().signal;
const jsonReply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

async function failure(promise: Promise<unknown>): Promise<SpeechFetchError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof SpeechFetchError) return err;
    throw err;
  }
  throw new Error("expected a SpeechFetchError");
}

beforeEach(() => {
  session.token = "jwt-token";
});

describe("fetchSpeech: the speak route, as the speaker needs it", () => {
  it("POSTs the words with the bearer token and returns the MP3", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "audio/mpeg" } }));
    const blob = await fetchSpeech("one half", signal(), fetchImpl as unknown as typeof fetch);
    expect(blob.size).toBe(3);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SPEAK_PATH);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer jwt-token");
    expect(JSON.parse(String(init.body))).toEqual({ text: "one half" });
  });

  it("maps the route's refusals", async () => {
    const reply = (res: Response) => vi.fn(async () => res) as unknown as typeof fetch;
    expect((await failure(fetchSpeech("x", signal(), reply(jsonReply(503, { error: "feature_unavailable" }))))).kind).toBe("unavailable");
    const limited = await failure(fetchSpeech("x", signal(), reply(jsonReply(429, { error: "rate_limited", retryAfterMs: 4200 }))));
    expect(limited).toMatchObject({ kind: "limited", retryAfterMs: 4200 });
    expect((await failure(fetchSpeech("x", signal(), reply(jsonReply(429, { error: "rate_limited" }, { "Retry-After": "7" }))))).retryAfterMs).toBe(7000);
    expect((await failure(fetchSpeech("x", signal(), reply(jsonReply(401, { error: "unauthorized" }))))).kind).toBe("auth");
    expect((await failure(fetchSpeech("x", signal(), reply(jsonReply(502, { error: "upstream_error" }))))).kind).toBe("failed");
    // a 200 that is not audio (a proxy's error page)
    expect((await failure(fetchSpeech("x", signal(), reply(new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } }))))).kind).toBe("failed");
  });

  it("signed out: auth, without a request; offline: failed", async () => {
    session.token = null;
    const fetchImpl = vi.fn();
    expect((await failure(fetchSpeech("x", signal(), fetchImpl as unknown as typeof fetch))).kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
    session.token = "jwt-token";
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect((await failure(fetchSpeech("x", signal(), offline))).kind).toBe("failed");
  });

  it("an aborted request rejects with the abort itself (the speaker cancelled it)", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const aborted = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    await expect(fetchSpeech("x", ctl.signal, aborted)).rejects.toMatchObject({ name: "AbortError" });
  });
});
