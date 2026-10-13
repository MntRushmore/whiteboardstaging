import type { Metadata } from "next";
import Link from "next/link";
import { LANDING_COPY } from "@/components/landing/copy";
import { HandMath } from "@/components/landing/HandMath";
import { JoinLink } from "@/components/landing/JoinLink";
import { InkCheck } from "@/components/landing/InkMark";
import { TRY_COPY } from "@/components/try/copy";
import { TryBoard, type TryBoardProblemView } from "@/components/try/TryBoard";
import { TRY_HAND_SIZE } from "@/components/try/tryInk";
import { latexWords } from "@/components/try/words";
import { LANDING_PATH, SIGN_IN_HREF, siteOrigin } from "@/lib/landing/links";
import { DEFAULT_TRY_BAND, TRY_API, TRY_BANDS, TRY_MAX_LINES, TRY_PATH } from "@/lib/try/contracts";
import { TRY_PROBLEMS } from "@/lib/try/problems";
import styles from "@/components/try/try.module.css";

/**
 * "Try it free" (2026-10-13, docs/TRY-BOARD.md): a board anyone can write on, with no account, and
 * the one link every post, reply and ad points at. Pick a grade band, write a line under the
 * tutor's problem, and the tutor checks it the way the board does: the "aha" before the card.
 *
 * Server-rendered and static. Every problem of every band is written here, in the tutor's hand
 * (`HandMath`, from the hand engine, on the server), and handed to the board, so the browser never
 * loads the hand engine, the live engine or tldraw: the board's client JS is the pen, the tutor's
 * marks (src/lib/live/marks.ts) and two fetches (`TRY_API`). Its words are in
 * src/components/try/copy.ts; the trial's come from the plan (`planWords`) by the landing page's
 * copy.
 */

/** The tutor's pen on this page; its hand size is the board's (`TRY_HAND_SIZE`: a plain line about 37 px tall, a fraction about 80). */
const PROBLEM_PEN = 4.2;

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin(process.env.NEXT_PUBLIC_SITE_URL)),
  title: { absolute: TRY_COPY.meta.title },
  description: TRY_COPY.meta.description,
  alternates: { canonical: TRY_PATH },
  // The app's pages stay out of search (the root layout's noindex); this one is meant to be found
  // and shared, like the landing page.
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: TRY_PATH,
    siteName: "Agathon",
    title: TRY_COPY.meta.ogTitle,
    description: TRY_COPY.meta.description,
  },
  twitter: {
    card: "summary_large_image",
    title: TRY_COPY.meta.ogTitle,
    description: TRY_COPY.meta.description,
  },
};

/** Every problem, with its words for a screen reader and its ink, written once per build. */
function problemViews(): TryBoardProblemView[] {
  const seen = new Map<string, number>();
  return TRY_PROBLEMS.map((p) => {
    const n = (seen.get(p.band) ?? 0) + 1;
    seen.set(p.band, n);
    return {
      id: p.id,
      band: p.band,
      hint: p.hint,
      oneStep: p.oneStep,
      words: p.lines.map(latexWords).join(", "),
      ink: (
        <>
          {p.lines.map((line, i) => (
            // writes itself in when it mounts (no INK_START_SCRIPT here: the board is the first thing on the page)
            <HandMath key={i} latex={line} ink="tutor" size={TRY_HAND_SIZE} pen={PROBLEM_PEN} seed={n + i} draw={`try-${p.id}-${i}`} />
          ))}
        </>
      ),
    };
  });
}

export default function TryPage() {
  const problems = problemViews();
  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <nav aria-label="Agathon" className={styles.navInner}>
          <Link href={LANDING_PATH} className={styles.brand}>
            Agathon
          </Link>
          <div className={styles.navLinks}>
            <Link href={SIGN_IN_HREF} className={styles.signIn}>
              {TRY_COPY.nav.signIn}
            </Link>
            <JoinLink className={`${styles.pill} ${styles.navCta}`}>
              {TRY_COPY.nav.cta}
            </JoinLink>
          </div>
        </nav>
      </header>
      <main>
        <div className={styles.head}>
          <p className={styles.eyebrow}>{TRY_COPY.eyebrow}</p>
          <h1 className={styles.title}>
            {TRY_COPY.titleLines.map((line, i) => (
              <span key={i} className={styles.titleLine}>
                {i > 0 ? " " : ""}
                {line}
              </span>
            ))}
          </h1>
          <p className={styles.lede}>{TRY_COPY.lede}</p>
        </div>
        <TryBoard
          problems={problems}
          bands={TRY_BANDS.map((b) => ({ id: b.id, label: b.label }))}
          defaultBand={DEFAULT_TRY_BAND}
          api={{ check: TRY_API.check, help: TRY_API.help }}
          maxLines={TRY_MAX_LINES}
          terms={{ usual: LANDING_COPY.join.terms, invited: LANDING_COPY.invited.terms }}
          finishMark={<InkCheck className={styles.finishCheck} draw="try-finish" atMs={150} forMs={320} />}
        />
      </main>
    </div>
  );
}
