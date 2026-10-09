/**
 * The speaker's call to POST /api/live/speak: the words in, the MP3 out, and the route's refusals as
 * `SpeechFetchError`s the speaker acts on (unavailable: the browser's voice for a while; limited:
 * until Retry-After; anything else: this phrase only).
 *
 * Not `authedFetch`: that announces every POST to /api/live/* as ink spent (the ink meter re-reads
 * the balance), and speech spends none.
 */
import { supabase } from "@/lib/supabase";
import { SpeechFetchError } from "./speaker";

export const SPEAK_PATH = "/api/live/speak";

/** Retry-After (seconds) or the body's `retryAfterMs`, in ms. */
function retryAfterMs(res: Response, body: { retryAfterMs?: unknown } | null): number | undefined {
  if (typeof body?.retryAfterMs === "number" && body.retryAfterMs > 0) return body.retryAfterMs;
  const seconds = Number(res.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

/** POSTs the words with the student's bearer token; the MP3 as a Blob, or a SpeechFetchError. */
export async function fetchSpeech(text: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Blob> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new SpeechFetchError("auth");
  let res: Response;
  try {
    res = await fetchImpl(SPEAK_PATH, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new SpeechFetchError("failed");
  }
  if (res.ok) {
    if (!(res.headers.get("Content-Type") ?? "").startsWith("audio/")) throw new SpeechFetchError("failed");
    return await res.blob();
  }
  const body = (await res.json().catch(() => null)) as { error?: unknown; retryAfterMs?: unknown } | null;
  if (res.status === 503 && body?.error === "feature_unavailable") throw new SpeechFetchError("unavailable");
  if (res.status === 429) throw new SpeechFetchError("limited", retryAfterMs(res, body));
  if (res.status === 401) throw new SpeechFetchError("auth");
  throw new SpeechFetchError("failed");
}
