import { LANDING_COPY } from "./copy";
import { Lines } from "./Lines";
import styles from "./landing.module.css";

/**
 * CONTRACT STUB (v3, owner: feat/lp3-devices). "Pencil, finger or keyboard.": three ways in, each
 * with a real moment of the product: a tablet being written on, a laptop where "3x+5=20" is typed in
 * the Type bar and then appears on the board in handwriting (HandMath, kid ink) and gets checked,
 * and a phone.
 */
export function Devices() {
  const copy = LANDING_COPY.devices;
  return (
    <section className={styles.band} aria-labelledby="lp-devices-title">
      <div className={`${styles.inner} ${styles.head}`}>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h2 id="lp-devices-title" className={styles.h2}>
          <Lines text={copy.title} />
        </h2>
        <p className={styles.lede}>{copy.lede}</p>
      </div>
    </section>
  );
}
