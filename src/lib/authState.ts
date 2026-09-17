import { describeError } from "@/lib/errorMessage";

/**
 * Decides what AuthProvider does when `supabase.auth.getSession()` fails.
 * A rejected refresh token or a missing session means "you are signed out"
 * and must not block the app; anything else (offline, DNS, 5xx, clock skew)
 * is a reachability problem the pages surface with a Retry banner.
 */

export const AUTH_UNREACHABLE_MESSAGE =
  "Can't reach the sign-in service. Check your connection, then retry.";

export type AuthLoadOutcome =
  | { kind: "signed-out" }
  | { kind: "error"; message: string };

const SIGNED_OUT_PATTERNS = [
  "refresh token",
  "session missing",
  "auth session missing",
  "session_not_found",
  "not logged in",
];

export function classifyAuthLoadError(err: unknown): AuthLoadOutcome {
  if (err && typeof err === "object") {
    const { status, code, message } = err as {
      status?: unknown;
      code?: unknown;
      message?: unknown;
    };
    const msg = typeof message === "string" ? message.toLowerCase() : "";
    const codeStr = typeof code === "string" ? code.toLowerCase() : "";
    if (
      SIGNED_OUT_PATTERNS.some((p) => msg.includes(p) || codeStr.includes(p.replace(/ /g, "_")))
    ) {
      return { kind: "signed-out" };
    }
    // 4xx from Auth (other than rate limiting) means the stored session is
    // simply not valid any more.
    if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) {
      return { kind: "signed-out" };
    }
  }
  return { kind: "error", message: describeError(err, AUTH_UNREACHABLE_MESSAGE) };
}
