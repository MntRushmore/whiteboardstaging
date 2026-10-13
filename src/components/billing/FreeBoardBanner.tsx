import { ButtonLink } from "@/components/app/ButtonLink";
import { FREE_BOARD_COPY } from "@/lib/billing/freeBoardCopy";
import { FREE_BOARD_PROBLEMS } from "@/lib/billing/freeBoard";
import { PLAN_PATH } from "@/lib/onboarding/planMarker";
import styles from "./freeBoardBanner.module.css";

export interface FreeBoardBannerProps {
  /** the free board */
  boardId: string;
  /** problems done on it; null when they could not be read (no count shown) */
  done: number | null;
  goal?: number;
}

/**
 * The home's slim banner for an account on its free board (`useFreeBoard`, gate `free`): how far
 * the free board is ("2 of 5 problems on your free board", a pip per problem), a way back to it,
 * and Start your free trial (the plan screen). Calm: one line on a laptop, two on a phone, flat
 * colours, no icon but the pips.
 */
export function FreeBoardBanner({ boardId, done, goal = FREE_BOARD_PROBLEMS }: FreeBoardBannerProps) {
  const shown = done === null ? null : Math.max(0, Math.min(done, goal));
  return (
    <section className={styles.banner} aria-label="Your free board" data-free-board-banner="">
      <div className={styles.text}>
        {shown !== null && (
          <span className={styles.pips} aria-hidden>
            {Array.from({ length: goal }, (_, i) => (
              <span key={i} className={styles.pip} data-done={i < shown ? "" : undefined} />
            ))}
          </span>
        )}
        <p className={styles.line}>
          <strong className={styles.progress}>{shown === null ? FREE_BOARD_COPY.progressUnknown : FREE_BOARD_COPY.progress(shown, goal)}</strong>
          <span className={styles.hint}>{FREE_BOARD_COPY.bannerHint}</span>
        </p>
      </div>
      <div className={styles.actions}>
        <ButtonLink href={`/board/${boardId}`} variant="secondary" className={styles.button}>
          {FREE_BOARD_COPY.openBoard}
        </ButtonLink>
        <ButtonLink href={PLAN_PATH} variant="primary" className={styles.button}>
          {FREE_BOARD_COPY.start}
        </ButtonLink>
      </div>
    </section>
  );
}
