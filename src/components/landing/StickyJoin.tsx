import type { ReactNode } from "react";
import { LANDING_COPY } from "./copy";
import { JoinLink } from "./JoinLink";
import { TrialWords } from "./TrialWords";
import styles from "./landing.module.css";

/**
 * A phone's bottom bar: the free trial and the Join button, one thumb away. No script and no
 * scroll timeline, just `position: sticky` (landing.module.css .sticky), so it works in every
 * browser and the server's HTML is already right (nothing flashes):
 *
 * - it wraps the page's middle (How it works to Questions) and sits at the end of it, stuck to the
 *   bottom of the screen; a sticky box never leaves its parent, so it is not there while the hero
 *   (and its own Join button) is on screen, and slides up into place as How it works comes in;
 * - its own place is the end of Questions (it takes no room there), so as the Join band comes up it
 *   scrolls away with the page: it never sits over the Join band nor the legal footer under it;
 * - in the tab order it comes where it sits, after the last question.
 *
 * Phones only (under 768 px): wider screens have the top bar's button.
 */
export function StickyJoin({ children }: { children: ReactNode }) {
  const copy = LANDING_COPY.sticky;
  const invited = LANDING_COPY.invited;
  return (
    <div className={styles.stickyScope}>
      {children}
      <div className={styles.sticky}>
        <div className={styles.stickyBar}>
          <p className={styles.stickyNote}>
            <TrialWords usual={copy.note} invited={invited.sticky} />
          </p>
          {/* the page's one name for the way in; the note beside it already says a friend's month */}
          <JoinLink className={`${styles.pill} ${styles.stickyCta}`}>
            {copy.start}
          </JoinLink>
        </div>
      </div>
    </div>
  );
}
