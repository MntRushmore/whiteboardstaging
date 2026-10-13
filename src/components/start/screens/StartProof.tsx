"use client";

import type { Ref } from "react";
import Image from "next/image";
import type { FlowCopy } from "@/lib/start/flow";
import styles from "../start.module.css";

export interface StartProofProps {
  copy: FlowCopy["proof"];
  onNext: () => void;
  titleRef: Ref<HTMLHeadingElement>;
}

/**
 * The grown-up's one look at what they get: the real Progress page of a 3rd grader (the landing
 * page's picture), not a mock and not a testimonial. On a phone, its path card alone.
 */
export function StartProof({ copy, onNext, titleRef }: StartProofProps) {
  return (
    <>
      <div className={styles.head}>
        <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
          {copy.title}
        </h1>
        <p className={styles.lede}>{copy.lede}</p>
      </div>
      <figure className={styles.shot}>
        <Image className={styles.wideOnly} src="/landing/progress-week.webp" alt={copy.alt} width={2937} height={1836} sizes="(max-width: 767px) 100vw, 720px" priority />
        {/* the landing page's phone picture, its own frame cropped away (public/start/) */}
        <Image className={styles.phoneOnly} src="/start/path-3rd-grade-phone.webp" alt={copy.alt} width={1062} height={816} sizes="calc(100vw - 32px)" priority />
      </figure>
      <p className={styles.caption}>{copy.caption}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onNext}>
          {copy.next}
        </button>
      </div>
    </>
  );
}
