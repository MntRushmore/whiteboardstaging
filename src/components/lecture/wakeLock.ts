/**
 * Keeps the screen on while a lecture is listening. An iPad left on a desk through a lecture locks
 * itself after its auto-lock delay (2 minutes by default) and Safari suspends the page: the
 * microphone and the transcriber's connection stop with it, mid-lecture, and nothing on the
 * screen says so until the student unlocks it. Capturing audio does not keep an iPad awake;
 * the Screen Wake Lock API (Safari 16.4+, Chrome, Edge) does. Where it is missing or refused,
 * nothing changes. The browser drops the lock whenever the page is hidden, so it is asked for
 * again when the page is back in view.
 */

interface SentinelLike {
  release(): Promise<void>;
  addEventListener?(type: "release", listener: () => void): void;
}

export interface WakeLockEnv {
  /** `navigator.wakeLock` (undefined where the browser has none) */
  wakeLock?: { request(type: "screen"): Promise<SentinelLike> } | null;
  /** the document, for its visibility */
  doc?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> | null;
}

export interface ScreenWakeLock {
  /** keep the screen on (again) until `release` */
  hold(): void;
  release(): void;
}

export function createScreenWakeLock(env: WakeLockEnv = browserWakeLockEnv()): ScreenWakeLock {
  const api = env.wakeLock;
  const doc = env.doc;
  let wanted = false;
  let sentinel: SentinelLike | null = null;
  let pending = false;

  const acquire = () => {
    if (!api || !wanted || sentinel || pending) return;
    if (doc && doc.visibilityState !== "visible") return;
    pending = true;
    api.request("screen").then(
      (s) => {
        pending = false;
        if (!wanted) {
          void s.release().catch(() => undefined);
          return;
        }
        sentinel = s;
        // the browser lets go when the page is hidden; asked for again when it is back
        s.addEventListener?.("release", () => {
          if (sentinel === s) sentinel = null;
        });
      },
      () => {
        pending = false; // refused (low battery, a policy): the lecture goes on without it
      },
    );
  };
  const onVisibility = () => {
    if (doc?.visibilityState === "visible") acquire();
  };

  return {
    hold() {
      if (!api) return;
      if (!wanted) {
        wanted = true;
        doc?.addEventListener("visibilitychange", onVisibility);
      }
      acquire();
    },
    release() {
      if (!wanted) return;
      wanted = false;
      doc?.removeEventListener("visibilitychange", onVisibility);
      const s = sentinel;
      sentinel = null;
      if (s) void s.release().catch(() => undefined);
    },
  };
}

function browserWakeLockEnv(): WakeLockEnv {
  if (typeof navigator === "undefined" || typeof document === "undefined") return {};
  const wl = (navigator as Navigator & { wakeLock?: WakeLockEnv["wakeLock"] }).wakeLock;
  return { wakeLock: wl ?? null, doc: document };
}
