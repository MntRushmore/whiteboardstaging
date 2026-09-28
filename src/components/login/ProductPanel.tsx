import { ChartSpline, ListChecks, PenLine } from "lucide-react";
import { ProductPictures } from "@/components/app/ProductPictures";
import styles from "./auth.module.css";

/**
 * What the product is, beside the sign-in form. Static and server-rendered: the full panel (with
 * real board screenshots) from 1024 px up, and ProductLine, a two-line version, above the form on
 * phones and on /reset-password.
 */

export const PRODUCT_NAME = "Agathon Classroom";
export const PRODUCT_LINE = "The whiteboard that writes back.";
export const PRODUCT_DESCRIPTION =
  "Students write maths by hand. The tutor reads it, checks each step, and answers in its own handwriting.";

const POINTS = [
  { icon: ListChecks, text: "Checks every step" },
  { icon: PenLine, text: "Solves step by step, in its own hand" },
  { icon: ChartSpline, text: "Graphs, geometry and proofs" },
] as const;

export function ProductPanel() {
  return (
    <aside aria-label={`About ${PRODUCT_NAME}`} className={styles.panel}>
      <div className={styles.panelInner}>
        <p className={styles.brand}>{PRODUCT_NAME}</p>
        <div className={styles.panelBody}>
          <h2 className={styles.headline}>{PRODUCT_LINE}</h2>
          <p className={styles.description}>{PRODUCT_DESCRIPTION}</p>
          <ul className={styles.points}>
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text}>
                <Icon size={18} strokeWidth={1.75} aria-hidden />
                {text}
              </li>
            ))}
          </ul>
          <ProductPictures
            className={styles.panelPictures}
            preload
            // Hidden below 1024 px: the 1px slot makes phones fetch the smallest variant, not this one.
            sizes={{
              solved: "(min-width: 1536px) 44rem, (min-width: 1280px) 40rem, (min-width: 1024px) 36rem, 1px",
              checked: "(min-width: 1536px) 20rem, (min-width: 1280px) 18rem, (min-width: 1024px) 16rem, 1px",
            }}
          />
        </div>
      </div>
    </aside>
  );
}

/** Name and product line, compact: above the form where the panel does not fit. */
export function ProductLine({ className }: { className?: string }) {
  return (
    <div className={[styles.productLine, className].filter(Boolean).join(" ")}>
      <p className={styles.brand}>{PRODUCT_NAME}</p>
      <p className={styles.productLineText}>{PRODUCT_LINE}</p>
    </div>
  );
}
