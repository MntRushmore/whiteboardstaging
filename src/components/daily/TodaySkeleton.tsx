import styles from "./todaySkeleton.module.css";

/**
 * Today's practice while it loads: the home's Suspense fallback (before the card's chunk arrives)
 * and the card's own loading state, one shape for both. As tall as the loaded card at each width
 * (`todaySkeleton.module.css`), so nothing under it moves when the card comes in.
 *
 * No imports but its styles: the home loads it with the page, so it must stay tiny.
 */
export function TodaySkeleton() {
  return (
    <div className={styles.card} data-today-card="" data-loading="" role="status" aria-label="Loading today's practice">
      <div className={styles.main}>
        <span className={`${styles.bar} ${styles.eyebrow}`} />
        <span className={`${styles.bar} ${styles.title}`} />
        <span className={`${styles.bar} ${styles.sub}`} />
        <span className={styles.go} />
      </div>
      <span className={styles.panel} />
    </div>
  );
}
