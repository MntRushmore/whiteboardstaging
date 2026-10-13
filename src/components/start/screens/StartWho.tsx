"use client";

import type { ReactNode, Ref } from "react";
import type { StartRole } from "@/lib/start/contracts";
import type { FlowCopy } from "@/lib/start/flow";
import { TutorCheck } from "../parts";
import styles from "../start.module.css";

export interface StartWhoProps {
  copy: FlowCopy["who"];
  role: StartRole | null;
  onPick: (role: StartRole) => void;
  /** each card's ink, server-rendered: the tutor's check for the grown-up, a kid's sum for the kid */
  motifs: { parent: ReactNode; kid: ReactNode };
  titleRef: Ref<HTMLHeadingElement>;
}

/** Who's getting started: two big cards, a grown-up or a kid. A tap answers and moves on. */
export function StartWho({ copy, role, onPick, motifs, titleRef }: StartWhoProps) {
  const card = (id: StartRole, words: { small: string; big: string; hint: string }) => (
    <button type="button" className={styles.role} data-role={id} aria-pressed={role === id} onClick={() => onPick(id)}>
      <span className={styles.roleSmall}>{words.small}</span>
      <span className={styles.roleBig}>{words.big}</span>
      <span className={styles.srOnly}>{words.hint}</span>
      <span className={styles.motif} aria-hidden>
        {motifs[id]}
      </span>
      {role === id && <TutorCheck className={styles.cornerCheck} seed={id === "parent" ? 3 : 11} />}
    </button>
  );
  return (
    <>
      <div className={styles.head}>
        <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
          {copy.title}
        </h1>
        <p className={styles.lede}>{copy.lede}</p>
      </div>
      <div className={styles.roles} role="group" aria-label={copy.title}>
        {card("parent", copy.parent)}
        {card("kid", copy.kid)}
      </div>
    </>
  );
}
