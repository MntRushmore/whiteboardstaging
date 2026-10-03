/**
 * Which tabs of this browser are still open, through the Web Locks API: a board holds the lock
 * `agathon.tab.<tabId>` for as long as its save queue lives, and the browser releases it when the
 * tab closes, crashes or is discarded. A board opening elsewhere replays only the backups of
 * tabs whose lock is gone; an open tab saves (and backs up) its own work.
 */
const LOCK_PREFIX = "agathon.tab.";

type Locks = {
  request(name: string, callback: () => Promise<void>): Promise<unknown>;
  query(): Promise<{ held?: Array<{ name?: string }> }>;
};

function locks(): Locks | undefined {
  return (globalThis as { navigator?: { locks?: Locks } }).navigator?.locks;
}

/** Hold this tab's lock until the returned function is called (a no-op without Web Locks). */
export function holdTabLock(tabId: string): () => void {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  locks()
    ?.request(LOCK_PREFIX + tabId, () => held)
    .catch(() => {});
  return release;
}

/** Ids of the tabs that hold their lock (still open), or null when the browser cannot tell. */
export async function openTabIds(): Promise<Set<string> | null> {
  try {
    const held = (await locks()?.query())?.held;
    if (!held) return null;
    return new Set(held.flatMap((l) => (l.name?.startsWith(LOCK_PREFIX) ? [l.name.slice(LOCK_PREFIX.length)] : [])));
  } catch {
    return null;
  }
}
