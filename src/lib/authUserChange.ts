import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

/**
 * What a tab does when the signed-in user changes under it. Every tab shares one session in
 * localStorage, and supabase-js tells every tab when it changes (a BroadcastChannel, and a re-read
 * from storage when a hidden tab comes back). So when one tab switches profile (a kid taps their
 * picture, the grown-up enters their PIN: src/lib/family/client.ts) or someone else signs in, every
 * other open tab is suddenly that other user, while its page still shows, and saves, the first
 * user's things: a board the new user cannot see, a learning record filed under the wrong kid.
 *
 * So a tab whose user changes from one person to another leaves for a fresh load of the home, as
 * the switching tab does. Nothing else leaves: signing in from signed out, a token refresh, the
 * same user updated, signing out (each page sends a signed-out user to /login itself). The tab
 * doing the switch is marked (`markProfileSwitch`): it is already loading its own destination.
 * Pure, apart from the one flag; no React.
 */

let switchingHere = false;

/** This tab is switching profile (set just before it takes the new session; cleared if that fails). */
export function markProfileSwitch(on: boolean): void {
  switchingHere = on;
}

export function isSwitchingProfileHere(): boolean {
  return switchingHere;
}

/** The page's user was one person and is now another (not a sign-in, a sign-out or a refresh). */
export function isOtherUser(pageUserId: string | null, nextUserId: string | null): boolean {
  return pageUserId !== null && nextUserId !== null && pageUserId !== nextUserId;
}

export interface AuthUserWatch {
  /** the session getSession() found when the page loaded */
  settle: (session: Session | null) => void;
  /** onAuthStateChange's callback: false once the page is leaving (take nothing into state) */
  change: (event: AuthChangeEvent, session: Session | null) => boolean;
}

/**
 * Keeps the user the page is showing, and calls `leave` (once) when another user's session arrives
 * from outside this tab. `switchingHere` is read when it happens (`isSwitchingProfileHere` in the app).
 */
export function watchAuthUser({ leave, switchingHere: isSwitching = isSwitchingProfileHere }: { leave: () => void; switchingHere?: () => boolean }): AuthUserWatch {
  let pageUserId: string | null = null;
  let left = false;
  return {
    settle(session) {
      if (left) return;
      pageUserId = session?.user?.id ?? null;
    },
    change(event, session) {
      if (left) return false;
      const next = event === "SIGNED_OUT" ? null : (session?.user?.id ?? null);
      if (isOtherUser(pageUserId, next) && !isSwitching()) {
        left = true;
        leave();
        return false;
      }
      pageUserId = next;
      return true;
    },
  };
}
