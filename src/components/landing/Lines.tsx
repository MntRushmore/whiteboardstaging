import styles from "./landing.module.css";

/**
 * A heading written as short lines ("One plan.\nUp to 6 kids."): the copy marks where the lines
 * break, so a two-sentence headline never splits mid-sentence the way balancing alone would. Each
 * line is its own balanced block, so a long one wraps evenly instead of leaving one word alone.
 */
export function Lines({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <span key={i} className={styles.line}>
          {line}
        </span>
      ))}
    </>
  );
}
