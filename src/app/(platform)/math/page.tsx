import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { ChevronRight, Lightbulb } from "lucide-react";
import { LANDING_COPY } from "@/components/landing/copy";
import { HandMath } from "@/components/landing/HandMath";
import { TrialWords } from "@/components/landing/TrialWords";
import landing from "@/components/landing/landing.module.css";
import { JsonLd } from "@/components/seo/JsonLd";
import { BoardDots, Crumbs, LibraryFrame, ProblemInk } from "@/components/seo/LevelPage";
import styles from "@/components/seo/levelPage.module.css";
import { GRADES } from "@/lib/learning/grades";
import { SIGN_UP_HREF } from "@/lib/landing/links";
import { HUB_COPY, HUB_CRUMBS, LIBRARY_COPY, hubJsonLd, levelCopy, levelName, levelSkillIds, sampleProblem } from "@/lib/seo/levels";
import { usEnglish } from "@/lib/landing/practice";
import { pathSkillName } from "@/lib/path/pathView";
import { LEVELS, MATH_PATH, levelPath, type Level } from "@/lib/seo/routes";

/**
 * The math library's hub (`/math`, docs/SEO.md): every grade, Kindergarten to 8th, as a card with
 * its headline skills and a sample problem in the board's hand (and as text), then the high-school
 * courses, a short How it works in the landing page's own words, and the way in. Every word is in
 * src/lib/seo/levels.ts (HUB_COPY) or the landing copy. Static and server-rendered.
 */

export const metadata: Metadata = {
  title: HUB_COPY.title,
  description: HUB_COPY.description,
  alternates: { canonical: MATH_PATH },
  robots: { index: true, follow: true },
  openGraph: { type: "website", url: MATH_PATH, siteName: "Agathon", title: HUB_COPY.title, description: HUB_COPY.description, locale: "en_US" },
  twitter: { card: "summary_large_image", title: HUB_COPY.title, description: HUB_COPY.description },
};

const GRADES_ID = "grades";

/** A grade's chip, as the landing page's picker shows it ("K", "3rd"); a course has none. */
function chipOf(level: Level): string | null {
  return level.kind === "grade" ? (GRADES.find((g) => g.id === level.grade)?.short ?? null) : null;
}

function LevelCard({ level }: { level: Level }) {
  const copy = levelCopy(level);
  const name = levelName(level);
  const course = level.kind === "course";
  const headline = copy.headline.filter((id) => levelSkillIds(level).includes(id));
  return (
    <li className={`${styles.skill} ${landing.reveal}`}>
      <div className={styles.levelHead}>
        {chipOf(level) && (
          <span className={styles.levelChip} aria-hidden>
            {chipOf(level)}
          </span>
        )}
        <h3 className={styles.levelName}>
          <Link href={levelPath(level)} className={styles.cardLink}>
            {LIBRARY_COPY.levelLink(name, course)}
          </Link>
        </h3>
      </div>
      <ul className={styles.headline} aria-label={`${name} skills`}>
        {headline.map((id) => (
          <li key={id}>{usEnglish(pathSkillName(id))}</li>
        ))}
      </ul>
      <ProblemInk problem={sampleProblem(headline[0])} draw={`hub-${level.slug}`} size={30} />
      <span className={styles.more} aria-hidden>
        {HUB_COPY.cardLink(name, course)}
        <ChevronRight size={16} strokeWidth={2} />
      </span>
    </li>
  );
}

export default function MathLibraryPage() {
  const how = LANDING_COPY.how;
  const [pick, write, help] = how.steps;
  const grades = LEVELS.filter((l) => l.kind === "grade");
  const courses = LEVELS.filter((l) => l.kind === "course");
  return (
    <LibraryFrame>
      <JsonLd data={hubJsonLd()} />

      <section className={`${styles.hero} ${styles.hubHero}`} aria-labelledby="lib-title">
        <BoardDots id="lib-hero-dots" />
        <div className={landing.inner}>
          <Crumbs steps={HUB_CRUMBS} />
          <h1 id="lib-title" className={`${styles.title} ${styles.hubTitle}`}>
            {HUB_COPY.h1}
          </h1>
          <p className={styles.intro}>{HUB_COPY.lede}</p>
          <div className={styles.actions}>
            <Link href={SIGN_UP_HREF} className={`${landing.pill} ${landing.pillLarge}`}>
              <TrialWords usual={LANDING_COPY.hero.start} invited={LANDING_COPY.invited.start} />
            </Link>
            <a href={`#${GRADES_ID}`} className={landing.textLink}>
              {HUB_COPY.start}
              <ChevronRight size={18} strokeWidth={2} aria-hidden />
            </a>
          </div>
        </div>
      </section>

      <section id={GRADES_ID} className={landing.band} aria-labelledby="lib-grades-title">
        <div className={landing.inner}>
          <div className={`${styles.sectionHead} ${landing.reveal}`}>
            <p className={landing.eyebrow}>{HUB_COPY.gradesEyebrow}</p>
            <h2 id="lib-grades-title" className={`${landing.h2} ${styles.h2}`}>
              {HUB_COPY.gradesTitle}
            </h2>
          </div>
          <div className={styles.pathBoard}>
            <ul className={styles.levels}>
              {grades.map((level) => (
                <LevelCard key={level.slug} level={level} />
              ))}
            </ul>
          </div>

          <div className={`${styles.sectionHead} ${styles.hubCourses} ${landing.reveal}`}>
            <p className={landing.eyebrow}>{HUB_COPY.coursesEyebrow}</p>
            <h2 id="lib-courses-title" className={`${landing.h2} ${styles.h2}`}>
              {HUB_COPY.coursesTitle}
            </h2>
            <p className={`${landing.lede} ${styles.lede}`}>{HUB_COPY.coursesLede}</p>
          </div>
          <div className={styles.pathBoard}>
            <ul className={styles.levels} aria-labelledby="lib-courses-title" style={{ "--cols": courses.length } as CSSProperties}>
              {courses.map((level) => (
                <LevelCard key={level.slug} level={level} />
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* How it works, in the landing page's words */}
      <section className={`${landing.band} ${landing.soft}`} aria-labelledby="lib-how-title">
        <div className={landing.inner}>
          <div className={`${styles.sectionHead} ${landing.reveal}`}>
            <p className={landing.eyebrow}>{HUB_COPY.howEyebrow}</p>
            <h2 id="lib-how-title" className={`${landing.h2} ${styles.h2}`}>
              {HUB_COPY.howTitle}
            </h2>
          </div>
          <ol className={styles.hubSteps}>
            {[pick, write, help].map((step, i) => (
              <li key={step.label} className={`${styles.hubStep} ${landing.reveal}`}>
                <HandMath latex={String(i + 1)} ink="kid" size={52} seed={3 + i} draw={`how-${i + 1}`} startMs={150} className={styles.hubNumeral} />
                <h3 className={styles.howTitle}>
                  <span className={landing.srOnly}>{step.label}: </span>
                  {step.title.replace("\n", " ")}
                </h3>
                <p className={styles.howBody}>
                  {"body" in step ? (
                    step.body
                  ) : (
                    <>
                      {help.bodyBefore}{" "}
                      <span className={styles.helpChip}>
                        <Lightbulb size="1em" strokeWidth={2.25} aria-hidden />
                        {help.helpButton}
                      </span>{" "}
                      {help.bodyAfter}
                    </>
                  )}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </LibraryFrame>
  );
}
