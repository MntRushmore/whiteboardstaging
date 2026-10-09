import styles from "./pathSkeleton.module.css";

/** Where a path card sits: the home spaces it from what comes next; the Progress page's grid does that itself. */
export type PathPlace = "home" | "progress";

/**
 * The skill path while it loads, shaped like the card (a title and a row of stops) and as tall as
 * the loaded trail, so nothing jumps when the path arrives: the home's Suspense fallback and the
 * card's own loading state. No imports but its styles: the home loads it with the page.
 */
export function PathSkeleton({ place }: { place: PathPlace }) {
  return (
    <div className={styles.card} data-place={place} data-skill-path="loading" role="status" aria-label="Loading your path" aria-busy>
      <div className={`${styles.title} ${styles.pulse}`} />
      <div className={styles.row}>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={`${styles.dot} ${styles.pulse}`} />
        ))}
      </div>
    </div>
  );
}
