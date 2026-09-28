import Image from "next/image";
import { PRODUCT_PICTURES } from "@/lib/onboarding/copy";
import styles from "./productPictures.module.css";

/**
 * The product in two pictures (`public/login/`): the tutor solving and graphing two lines, and a small
 * card of a student's steps with the tutor's ticks, overlapping its corner. Shown beside the sign-in
 * form and in the welcome. With `entrance`, the small card rises onto the big one once when it first
 * appears (CSS only; none with reduced motion).
 */
export function ProductPictures({
  sizes,
  preload = false,
  compact = false,
  entrance = false,
  className,
}: {
  /** `sizes` for the big and the small picture */
  sizes: { solved: string; checked: string };
  preload?: boolean;
  compact?: boolean;
  entrance?: boolean;
  className?: string;
}) {
  const { solved, checked } = PRODUCT_PICTURES;
  return (
    <figure className={[styles.figure, compact && styles.compact, entrance && styles.entrance, className].filter(Boolean).join(" ")}>
      <div className={styles.solved}>
        <Image src={solved.src} alt={solved.alt} width={solved.width} height={solved.height} sizes={sizes.solved} preload={preload} className={styles.image} />
      </div>
      <div className={styles.checked}>
        <Image src={checked.src} alt={checked.alt} width={checked.width} height={checked.height} sizes={sizes.checked} className={styles.image} />
      </div>
    </figure>
  );
}
