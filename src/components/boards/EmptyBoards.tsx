import type { ReactNode } from "react";
import { DASHBOARD_COPY } from "@/app/dashboardState";
import { PRODUCT_PICTURES } from "@/lib/onboarding/copy";
import styles from "./boards.module.css";

/**
 * The boards home with no boards (after the welcome, or for a student who skipped it or deleted
 * every board): the welcome's picture and words, and one next step — a new board. Arc's EmptyState
 * holds a 48 px icon, not a picture, so this is its layout and type with the picture in place.
 */
export function EmptyBoards({ action }: { action: ReactNode }) {
  const { checked } = PRODUCT_PICTURES;
  return (
    <section data-state="empty" aria-labelledby="empty-title" className={`${styles.panel} ${styles.empty}`}>
      <div className={styles.emptyPicture}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a 9 KB static webp: next/image would add its runtime to the home's first load for nothing */}
        <img src={checked.src} alt={checked.alt} width={checked.width} height={checked.height} decoding="async" />
      </div>
      <h2 id="empty-title" className={styles.emptyTitle}>
        {DASHBOARD_COPY.emptyTitle}
      </h2>
      <p className={styles.emptyHint}>{DASHBOARD_COPY.emptyHint}</p>
      <div className={styles.emptyAction}>{action}</div>
    </section>
  );
}
