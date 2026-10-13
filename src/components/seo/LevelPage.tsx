import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { CalendarCheck, ChartColumn, Check, ChevronLeft, ChevronRight, Lightbulb } from "lucide-react";
import { BetaBadge } from "@/components/app/BetaBadge";
import { HOW_ID, PRICING_ID } from "@/components/landing/bands";
import { LANDING_COPY } from "@/components/landing/copy";
import { HandMath, handMathMs } from "@/components/landing/HandMath";
import { INK_START_SCRIPT } from "@/components/landing/inkStart";
import { InkCheck } from "@/components/landing/InkMark";
import { Join } from "@/components/landing/Join";
import { TrialWords } from "@/components/landing/TrialWords";
import landing from "@/components/landing/landing.module.css";
import { JsonLd } from "@/components/seo/JsonLd";
import { keepMathsTogether } from "@/lib/learning/topics";
import { LANDING_PATH, SIGN_IN_HREF, SIGN_UP_HREF } from "@/lib/landing/links";
import {
  LIBRARY_COPY,
  levelBoard,
  levelCopy,
  levelCrumbs,
  levelJsonLd,
  levelName,
  levelNeighbors,
  levelSkills,
  warmUpSkills,
  type LevelSkill,
  type SampleProblem,
} from "@/lib/seo/levels";
import { MATH_PATH, levelPath, type Level } from "@/lib/seo/routes";
import styles from "./levelPage.module.css";

/**
 * A grade's or a course's page in the math library (`/math/3rd-grade`, `/math/algebra-1`;
 * docs/SEO.md): what kids at that level work on, its skill path in teaching order with a sample
 * problem for each skill written in the board's hand (and as text beside it), what carries over from
 * the grade below, how practice works on Agathon, the questions parents ask, the grades on either
 * side, and the way in (the landing page's Join band). Every word and list is in
 * src/lib/seo/levels.ts. Static and server-rendered in the landing page's look (its tokens, its ink);
 * the only script is the landing page's ink holder, and the only island is the trial's words.
 *
 * The pieces the hub (`/math`) shares are exported: the bar, the breadcrumb, the board's dots, a
 * handwritten problem with its text, and the page frame.
 */

// ------------------------------------------------------------------ metadata

export function levelMetadata(level: Level): Metadata {
  const copy = levelCopy(level);
  const path = levelPath(level);
  return {
    title: copy.title,
    description: copy.description,
    alternates: { canonical: path },
    robots: { index: true, follow: true },
    openGraph: { type: "website", url: path, siteName: "Agathon", title: copy.title, description: copy.description, locale: "en_US" },
    twitter: { card: "summary_large_image", title: copy.title, description: copy.description },
  };
}

// ------------------------------------------------------------------ shared pieces

/** The library's top bar: the name (home), the library and the landing page's parts on a wide screen, Sign in and Join. */
export function LibraryNav() {
  const copy = LANDING_COPY.nav;
  const parts = [
    { label: "Math library", href: MATH_PATH },
    { label: "How Agathon works", href: `${LANDING_PATH}#${HOW_ID}` },
    { label: "Pricing", href: `${LANDING_PATH}#${PRICING_ID}` },
  ];
  return (
    <header className={landing.nav}>
      <nav aria-label="Agathon" className={`${landing.inner} ${landing.navInner}`}>
        <Link href={LANDING_PATH} className={landing.brand}>
          Agathon
          <BetaBadge className={landing.beta} />
        </Link>
        <ul className={landing.navParts}>
          {parts.map((part) => (
            <li key={part.href}>
              <Link href={part.href} className={landing.navPart}>
                {part.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className={landing.navLinks}>
          <Link href={SIGN_IN_HREF} className={landing.navSignIn}>
            {copy.signIn}
          </Link>
          <Link href={SIGN_UP_HREF} className={`${landing.pill} ${landing.navCta}`}>
            <TrialWords usual={copy.cta} invited={LANDING_COPY.invited.start} />
          </Link>
        </div>
      </nav>
    </header>
  );
}

/** Agathon › Math › 3rd grade: every step a link but the last, which is this page. */
export function Crumbs({ steps }: { steps: readonly { name: string; path: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className={styles.crumbs}>
      <ol>
        {steps.map((step, i) => (
          <li key={step.path}>
            {i > 0 && (
              <span className={styles.crumbSep} aria-hidden>
                ›
              </span>
            )}
            {i < steps.length - 1 ? (
              <Link href={step.path}>{step.name}</Link>
            ) : (
              <span aria-current="page">{step.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The board's dot grid, 24 px apart, as an SVG pattern (flat, no wash). Decorative. */
export function BoardDots({ id }: { id: string }) {
  return (
    <svg className={styles.dots} aria-hidden focusable="false">
      <defs>
        <pattern id={id} width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="12" cy="12" r="1.15" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * When each line of a problem starts and stops being written: one line after another, `gapMs`
 * apart (line `i` is written with seed `seed + i`, as HandMath draws it).
 */
export function writingStarts(lines: readonly string[], { size, seed, firstMs, gapMs }: { size: number; seed: number; firstMs: number; gapMs: number }) {
  const out: { startMs: number; endMs: number }[] = [];
  let at = firstMs;
  lines.forEach((line, i) => {
    const endMs = at + handMathMs(line, { size, seed: seed + i });
    out.push({ startMs: at, endMs });
    at = endMs + gapMs;
  });
  return out;
}

/**
 * A problem written in the board's hand, line by line, with the same problem as text under it: the
 * handwriting is a picture of the text (hidden from screen readers), the text is what a crawler and
 * a screen reader read.
 */
export function ProblemInk({ problem, draw, size = 32, label = LIBRARY_COPY.sample }: { problem: SampleProblem; draw: string; size?: number; label?: string }) {
  const starts = writingStarts(problem.latex, { size, seed: 2, firstMs: 120, gapMs: 200 });
  return (
    <div className={styles.problem}>
      <div className={styles.problemInk}>
        {problem.latex.map((line, i) => (
          <HandMath key={i} latex={line} size={size} seed={2 + i} ink="kid" draw={`${draw}-${i}`} startMs={starts[i].startMs} className={styles.problemLine} />
        ))}
      </div>
      <p className={styles.problemText}>
        <span className={styles.problemLabel}>{label}</span>
        {/* a problem of two lines (a system, a function and its input) reads as one: "x + y = 8; x − y = 2" */}
        <span className={styles.problemMath}>{problem.text.join("; ")}</span>
      </p>
    </div>
  );
}

/** The page frame every library page shares: the landing page's tokens, the bar, the Join band at the end, the ink holder. */
export function LibraryFrame({ children }: { children: ReactNode }) {
  return (
    <div className={`${landing.page} ${styles.library}`}>
      <LibraryNav />
      <main>
        {children}
        <Join />
      </main>
      {/* After every drawing on the page: holds each until it is in view (no hydration needed). */}
      <script dangerouslySetInnerHTML={{ __html: INK_START_SCRIPT }} />
    </div>
  );
}

// ------------------------------------------------------------------ a level's page

const PATH_ID = "path";

/** Cards in a row on a wide screen: a path of 4 in one row, of 2 side by side, else rows of 3. */
export function pathColumns(count: number): number {
  return count === 4 ? 4 : count <= 2 ? 2 : 3;
}

/** The level's first starter and its first step on a board, the step checked by the tutor's pen. */
function HeroBoard({ level }: { level: Level }) {
  const lines = levelBoard(level);
  const size = 58;
  const times = writingStarts(
    lines.map((l) => l.latex),
    { size, seed: 5, firstMs: 300, gapMs: 260 },
  );
  return (
    <figure className={styles.board}>
      <div className={styles.boardLines}>
        {lines.map((line, i) => (
          <div key={i} className={styles.boardLine}>
            <HandMath latex={line.latex} size={size} seed={5 + i} ink="kid" draw={`board-${i}`} startMs={times[i].startMs} className={styles.boardInk} />
            {line.checked && <InkCheck className={styles.boardCheck} draw={`board-check-${i}`} atMs={times[i].endMs + 180} forMs={300} />}
          </div>
        ))}
      </div>
      <figcaption className={styles.boardCaption}>
        <span className={styles.problemLabel}>{LIBRARY_COPY.boardLabel}</span>
        <span className={styles.problemMath}>{lines.map((line) => line.text).join(", then ")}</span>
        <span className={styles.boardNote}>{LIBRARY_COPY.boardNote}</span>
      </figcaption>
    </figure>
  );
}

function SkillCard({ skill, index }: { skill: LevelSkill; index: number }) {
  return (
    <li className={`${styles.skill} ${landing.reveal}`}>
      <div className={styles.skillHead}>
        <span className={styles.stepNo} aria-hidden>
          {index + 1}
        </span>
        <div>
          <h3 className={styles.skillName}>
            <Link href={skill.href} className={styles.cardLink}>
              {skill.name}
            </Link>
          </h3>
          {skill.blurb && <p className={styles.skillBlurb}>{skill.blurb}</p>}
        </div>
      </div>
      <ProblemInk problem={skill.problem} draw={`skill-${skill.id}`} />
      <span className={styles.more} aria-hidden>
        {LIBRARY_COPY.open}
        <ChevronRight size={16} strokeWidth={2} />
      </span>
    </li>
  );
}

const HOW_ICONS = [CalendarCheck, Check, Lightbulb, ChartColumn] as const;

/** How practice works on Agathon, for this level: the day's set, the checks, Help me, and what grown-ups see. */
export function HowPractice({ name, course }: { name: string; course: boolean }) {
  return (
    <section className={`${landing.band} ${landing.soft}`} aria-labelledby="lib-how-title">
      <div className={landing.inner}>
        <div className={`${styles.sectionHead} ${landing.reveal}`}>
          <p className={landing.eyebrow}>{LIBRARY_COPY.howEyebrow}</p>
          <h2 id="lib-how-title" className={`${landing.h2} ${styles.h2}`}>
            {LIBRARY_COPY.howTitle}
          </h2>
        </div>
        <ul className={styles.how}>
          {LIBRARY_COPY.how(name, course).map((item, i) => {
            const Icon = HOW_ICONS[i];
            return (
              <li key={item.title} className={`${styles.howItem} ${landing.reveal}`}>
                <span className={styles.howIcon} aria-hidden>
                  <Icon size={20} strokeWidth={2} />
                </span>
                <h3 className={styles.howTitle}>{item.title}</h3>
                <p className={styles.howBody}>{item.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function Neighbor({ level, dir }: { level: Level; dir: "prev" | "next" }) {
  const name = LIBRARY_COPY.levelLink(levelName(level), level.kind === "course");
  return (
    <Link href={levelPath(level)} className={`${styles.neighbor} ${dir === "next" ? styles.neighborNext : ""}`} rel={dir}>
      <span className={styles.neighborDir}>
        {dir === "prev" && <ChevronLeft size={16} strokeWidth={2} aria-hidden />}
        {dir === "prev" ? LIBRARY_COPY.prev : LIBRARY_COPY.next}
        {dir === "next" && <ChevronRight size={16} strokeWidth={2} aria-hidden />}
      </span>
      <span className={styles.neighborName}>{name}</span>
    </Link>
  );
}

export function LevelPage({ level }: { level: Level }) {
  const copy = levelCopy(level);
  const name = levelName(level);
  const course = level.kind === "course";
  const skills = levelSkills(level);
  const warm = warmUpSkills(level);
  const below = level.kind === "grade" && level.grade > 0 ? levelNeighbors(level).prev : null;
  const { prev, next } = levelNeighbors(level);
  return (
    <LibraryFrame>
      <JsonLd data={levelJsonLd(level)} />

      {/* the board: what this level is, and one of its problems, checked */}
      <section className={styles.hero} aria-labelledby="lib-title">
        <BoardDots id="lib-hero-dots" />
        <div className={`${landing.inner} ${styles.heroGrid}`}>
          <div className={styles.heroText}>
            <Crumbs steps={levelCrumbs(level)} />
            <h1 id="lib-title" className={styles.title}>
              {copy.h1}
            </h1>
            <p className={styles.intro}>{keepMathsTogether(copy.intro)}</p>
            <div className={styles.actions}>
              <Link href={SIGN_UP_HREF} className={`${landing.pill} ${landing.pillLarge}`}>
                <TrialWords usual={LANDING_COPY.hero.start} invited={LANDING_COPY.invited.start} />
              </Link>
              <a href={`#${PATH_ID}`} className={landing.textLink}>
                {LIBRARY_COPY.start}
                <ChevronRight size={18} strokeWidth={2} aria-hidden />
              </a>
            </div>
          </div>
          <HeroBoard level={level} />
        </div>
      </section>

      {/* the path, in teaching order: each skill, a sample problem, and its own page */}
      <section id={PATH_ID} className={landing.band} aria-labelledby="lib-path-title">
        <div className={landing.inner}>
          <div className={`${styles.sectionHead} ${landing.reveal}`}>
            <p className={landing.eyebrow}>{LIBRARY_COPY.pathEyebrow}</p>
            <h2 id="lib-path-title" className={`${landing.h2} ${styles.h2}`}>
              {LIBRARY_COPY.pathTitle(name, course)}
            </h2>
            <p className={`${landing.lede} ${styles.lede}`}>{LIBRARY_COPY.pathLede(skills.length, course)}</p>
          </div>
          <div className={styles.pathBoard}>
            <ol className={styles.skills} style={{ "--cols": pathColumns(skills.length) } as CSSProperties}>
              {skills.map((skill, i) => (
                <SkillCard key={skill.id} skill={skill} index={i} />
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* what carries over from the grade below */}
      {below && warm.length > 0 && (
        <section className={`${landing.band} ${styles.warm}`} aria-labelledby="lib-warm-title">
          <div className={`${landing.inner} ${styles.warmInner}`}>
            <div className={landing.reveal}>
              <p className={landing.eyebrow}>{LIBRARY_COPY.warmEyebrow}</p>
              <h2 id="lib-warm-title" className={`${landing.h3} ${styles.warmTitle}`}>
                {LIBRARY_COPY.warmTitle(levelName(below))}
              </h2>
              <p className={styles.warmBody}>{LIBRARY_COPY.warmBody(levelName(below), name)}</p>
            </div>
            <ul className={styles.chips}>
              {warm.map((skill) => (
                <li key={skill.id}>
                  <Link href={skill.href} className={styles.chip}>
                    {skill.name}
                    <ChevronRight size={16} strokeWidth={2} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <HowPractice name={name} course={course} />

      {/* the questions parents ask (the FAQPage data says the same words) */}
      <section className={landing.band} aria-labelledby="lib-faq-title">
        <div className={`${landing.inner} ${landing.faqLayout}`}>
          <div className={`${landing.faqHead} ${landing.reveal}`}>
            <p className={landing.eyebrow}>{LIBRARY_COPY.faqEyebrow}</p>
            <h2 id="lib-faq-title" className={`${landing.h2} ${styles.faqTitle}`}>
              {LIBRARY_COPY.faqTitle(name, course)}
            </h2>
          </div>
          <div className={styles.faq}>
            {copy.faq.map((item) => (
              <div key={item.q} className={styles.qa}>
                <h3 className={styles.question}>{keepMathsTogether(item.q)}</h3>
                <p className={styles.answer}>{keepMathsTogether(item.a)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* across: the grade below and the one after, and the whole library */}
      <nav className={styles.neighbors} aria-label="More grades and courses">
        <div className={`${landing.inner} ${styles.neighborsInner}`}>
          {prev ? <Neighbor level={prev} dir="prev" /> : <span />}
          <Link href={MATH_PATH} className={styles.allLevels}>
            {LIBRARY_COPY.allLevels}
          </Link>
          {next ? <Neighbor level={next} dir="next" /> : <span />}
        </div>
      </nav>
    </LibraryFrame>
  );
}
