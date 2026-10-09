import { CircleCheck, GraduationCap, Users } from "lucide-react";
import { BetaBadge } from "@/components/app/BetaBadge";
import { MAX_KIDS } from "@/lib/family/contracts";
import { MiniBoard } from "./MiniBoard";
import styles from "./auth.module.css";

/**
 * What the product is, beside the sign-in form, in the landing page's words (/parents,
 * src/components/landing/copy.ts): math practice for kindergarten to 8th grade, checked line by line
 * as the kid writes, one plan for the family. Static and server-rendered: the full panel (with a
 * still board of the landing page's ink) from 1024 px up, and ProductLine, a two-line version,
 * above the form on phones and on /reset-password.
 */

export const PRODUCT_NAME = "Agathon";
/** The landing page's headline, in the two lines the panel sets it in. */
const HEADLINE_LINES = ["Math practice", "kids actually do."] as const;
export const PRODUCT_LINE = HEADLINE_LINES.join(" ");
export const PRODUCT_DESCRIPTION =
  "Kids work problems by hand on a whiteboard. A tutor checks every line as they write, and when they slip, it gives a hint instead of the answer.";

export const PRODUCT_POINTS = [
  { icon: GraduationCap, text: "Kindergarten to 8th grade, or a high school course" },
  { icon: CircleCheck, text: "A tutor that checks every line" },
  { icon: Users, text: `One plan for up to ${MAX_KIDS} kids, each with their own profile` },
] as const;

export function ProductPanel() {
  return (
    <aside aria-label={`About ${PRODUCT_NAME}`} className={styles.panel}>
      <div className={styles.panelInner}>
        <p className={`${styles.brand} ${styles.brandRow}`}>
          {PRODUCT_NAME}
          <BetaBadge />
        </p>
        <div className={styles.panelBody}>
          <h2 className={styles.headline}>
            {HEADLINE_LINES.map((line, i) => (
              <span key={line} className={styles.headlineLine}>
                {i > 0 && " "}
                {line}
              </span>
            ))}
          </h2>
          <p className={styles.description}>{PRODUCT_DESCRIPTION}</p>
          <ul className={styles.points}>
            {PRODUCT_POINTS.map(({ icon: Icon, text }) => (
              <li key={text}>
                <Icon size={18} strokeWidth={1.75} aria-hidden />
                {text}
              </li>
            ))}
          </ul>
          <MiniBoard className={styles.panelBoard} />
        </div>
      </div>
    </aside>
  );
}

/** Name and product line, compact: above the form where the panel does not fit. */
export function ProductLine({ className }: { className?: string }) {
  return (
    <div className={[styles.productLine, className].filter(Boolean).join(" ")}>
      <p className={`${styles.brand} ${styles.brandRow}`}>
        {PRODUCT_NAME}
        <BetaBadge />
      </p>
      <p className={styles.productLineText}>{PRODUCT_LINE}</p>
    </div>
  );
}
