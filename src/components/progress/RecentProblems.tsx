"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PROGRESS_COPY, type RecentView } from "@/lib/learning/progressView";
import { ToneBadge } from "./ProgressSections";
import styles from "./progress.module.css";

type Render = (latex: string) => string;

/**
 * KaTeX, loaded after the page is up (only this page asks for it, and the list is at the bottom).
 * Its stylesheet is already global (`globals.css`). Until it arrives, and if it never does, each
 * problem shows as readable text.
 */
function useKatex(): Render | null {
  const [render, setRender] = useState<Render | null>(null);
  useEffect(() => {
    let live = true;
    import("@/shapes/math/katex")
      .then((m) => {
        if (live) setRender(() => m.renderLatex);
      })
      .catch(() => {
        // keep the plain text
      });
    return () => {
      live = false;
    };
  }, []);
  return render;
}

function Problem({ latex, plain, render }: { latex: string; plain: string; render: Render | null }) {
  const html = render ? render(latex) : "";
  if (!html) return <span className={styles.math}>{plain || latex}</span>;
  // KaTeX's HTML (trust off, the student's own record) is named by its plain text for screen readers
  return <span className={styles.math} role="img" aria-label={plain || latex} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The latest problems, newest first: the maths, its skill and day, how it went, and its board. */
export function RecentProblems({ items }: { items: readonly RecentView[] }) {
  const render = useKatex();
  return (
    <ol className={styles.recent}>
      {items.map((p) => (
        <li key={p.id} className={styles.problem}>
          <div className={styles.problemMain}>
            <Problem latex={p.latex} plain={p.plain} render={render} />
            <p className={styles.problemMeta}>
              {p.skillName} · {p.when}
            </p>
          </div>
          <div className={styles.problemEnd}>
            <ToneBadge tone={p.tone}>{p.outcomeLabel}</ToneBadge>
            {p.boardHref ? (
              <Link href={p.boardHref} className={styles.boardLink} aria-label={`${PROGRESS_COPY.openBoard}: ${p.plain || p.skillName}`}>
                {PROGRESS_COPY.openBoard}
                <ArrowUpRight size={15} strokeWidth={1.9} aria-hidden />
              </Link>
            ) : (
              <span aria-hidden />
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
