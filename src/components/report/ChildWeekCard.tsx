"use client";

import { Flame, Lightbulb, Play } from "lucide-react";
import { FamilyAvatar } from "@/components/family/FamilyAvatar";
import type { ChildWeek } from "@/lib/report/contracts";
import { REPORT_COPY } from "@/lib/report/copy";
import { DAY_LETTERS, DAY_NAMES, dayLevel, gradeText, joinNames, practisedBars } from "@/lib/report/view";
import { Button } from "@/registry/components/button/button";
import styles from "./report.module.css";

export interface ChildWeekCardProps {
  week: ChildWeek;
  /** the grown-up's own section, or a kid/solo student reading their own week */
  self: boolean;
  /** this week (a quiet week then nudges to Today's practice; a past one just says so) */
  current: boolean;
  /** 0..6, today's place in the week strip (this week only) */
  todayIndex: number | null;
  /** "Watch them solve it": open the replay of the highlight board */
  onWatch: (boardId: string) => void;
  /** the quiet week's nudge: open Today's practice (switching to the kid first, for a grown-up) */
  onPractice: () => void;
  practiceBusy: boolean;
}

function Stat({ id, value, label, hint }: { id: string; value: number; label: string; hint?: string }) {
  return (
    <li className={styles.stat} data-stat={id} data-zero={value === 0 ? "" : undefined}>
      <p className={styles.statValue}>{value}</p>
      <p className={styles.statLabel}>{label}</p>
      {hint && <p className={styles.statHint}>{hint}</p>}
    </li>
  );
}

/** "Next week, try": the skill and one thing a grown-up can do about it. */
function NextWeek({ focus }: { focus: NonNullable<ChildWeek["focus"]> }) {
  return (
    <section className={styles.next} aria-label={REPORT_COPY.nextWeekTitle}>
      <span className={styles.nextHead}>
        <Lightbulb size={15} strokeWidth={2} aria-hidden />
        {REPORT_COPY.nextWeekTitle}
      </span>
      <p className={styles.nextSkill}>{focus.name}</p>
      <p className={styles.nextTip}>{focus.tip}</p>
    </section>
  );
}

/**
 * One child's week on the report: who (picture, name, grade, streak), anything mastered, the big
 * numbers, the seven days, what they practiced as bars (solved alone in green), next week's skill
 * with a tip, and the replay of the board they worked hardest on. A week with nothing in it says so
 * kindly and offers Today's practice instead of a page of zeros.
 */
export function ChildWeekCard({ week, self, current, todayIndex, onWatch, onPractice, practiceBusy }: ChildWeekCardProps) {
  const quiet = week.problems === 0 && week.activeDays === 0 && week.dailySets === 0;
  const bars = practisedBars(week.practised);
  const days = week.days ?? [];
  const headingId = `report-child-${week.userId}`;

  return (
    <li className={styles.child} aria-labelledby={headingId} data-testid="report-child">
      <div className={styles.who}>
        <FamilyAvatar name={week.displayName} avatar={week.avatar} size="lg" />
        <div className={styles.whoText}>
          <h2 id={headingId} className={styles.name}>
            {week.displayName}
          </h2>
          <p className={styles.grade}>{gradeText(week.grade)}</p>
        </div>
        {/* the streak is a big number below; on a quiet week (no numbers) it stays up here */}
        {quiet && week.streak > 0 && (
          <span className={styles.streakChip}>
            <Flame size={16} strokeWidth={2.2} aria-hidden />
            {REPORT_COPY.streakChip(week.streak)}
          </span>
        )}
      </div>

      {quiet ? (
        <div className={styles.split}>
          <div className={styles.quiet}>
            <p className={styles.quietTitle}>{self ? REPORT_COPY.quietTitleSelf : REPORT_COPY.quietTitle(week.displayName)}</p>
            <p className={styles.quietBody}>{current ? REPORT_COPY.quietBody : REPORT_COPY.quietPastBody}</p>
            {current && (
              <Button size="sm" onClick={onPractice} loading={practiceBusy}>
                {self ? REPORT_COPY.quietAction : REPORT_COPY.quietSwitch(week.displayName)}
              </Button>
            )}
          </div>
          {week.focus && <NextWeek focus={week.focus} />}
        </div>
      ) : (
        <>
          {week.newlyMastered.length > 0 && (
            <div className={styles.mastered}>
              <span className={styles.masteredEmoji} aria-hidden>
                🎉
              </span>
              <div className={styles.masteredText}>
                <p className={styles.masteredLabel}>{REPORT_COPY.newThisWeek}</p>
                <p className={styles.masteredNames}>{REPORT_COPY.mastered(joinNames(week.newlyMastered))}</p>
              </div>
            </div>
          )}

          <ul className={styles.stats} aria-label={`${week.displayName}'s numbers`}>
            <Stat id="problems" value={week.problems} label={REPORT_COPY.stats.problems} />
            <Stat id="independent" value={week.independent} label={REPORT_COPY.stats.independent} hint={REPORT_COPY.ofProblems(week.independent, week.problems)} />
            <Stat id="minutes" value={week.minutes} label={REPORT_COPY.stats.minutes} />
            <Stat id="streak" value={week.streak} label={REPORT_COPY.stats.streak} hint={REPORT_COPY.streakHint(week.dailySets)} />
          </ul>

          <div className={styles.days}>
            <p className={styles.daysCount}>
              <span className={styles.daysValue}>
                {week.activeDays}
                <small>{REPORT_COPY.daysOf}</small>
              </span>
              <span className={styles.daysLabel}>{REPORT_COPY.stats.activeDays}</span>
            </p>
            {days.length === 7 && (
              <ul className={styles.strip} aria-label={REPORT_COPY.weekStripLabel(week.displayName)}>
                {days.map((n, i) => (
                  <li key={i} className={styles.day} data-today={todayIndex === i ? "" : undefined} title={REPORT_COPY.dayProblems(DAY_NAMES[i], n)}>
                    <span className={styles.dot} data-level={dayLevel(n)} aria-hidden />
                    <span aria-hidden>{DAY_LETTERS[i]}</span>
                    <span className={styles.srOnly}>{REPORT_COPY.dayProblems(DAY_NAMES[i], n)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.split}>
            <section aria-label={REPORT_COPY.practisedTitle}>
              <h3 className={styles.blockTitle}>{REPORT_COPY.practisedTitle}</h3>
              {week.practised.length === 0 ? (
                <p className={styles.noPractice}>{REPORT_COPY.streakHint(week.dailySets)}</p>
              ) : (
                <>
                  <ul className={styles.bars}>
                    {week.practised.map((p, i) => (
                      <li key={p.skill} className={styles.bar}>
                        <div className={styles.barHead}>
                          <span className={styles.barName}>{p.name}</span>
                          <span className={styles.barNumbers}>{REPORT_COPY.practisedLine(p.problems, p.independent)}</span>
                        </div>
                        <div className={styles.barTrack} aria-hidden>
                          <div className={styles.barFill} style={{ width: `${bars[i].width}%` }}>
                            <div className={styles.barAlone} style={{ width: `${bars[i].alone}%` }} />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <ul className={styles.legend} aria-hidden>
                    <li>
                      <span className={styles.swatch} />
                      {REPORT_COPY.practisedLegendAlone}
                    </li>
                    <li>
                      <span className={styles.swatch} data-kind="help" />
                      {REPORT_COPY.practisedLegendHelp}
                    </li>
                  </ul>
                </>
              )}
            </section>

            <div className={styles.side}>
              {week.focus && <NextWeek focus={week.focus} />}
              {week.highlightBoardId && (
                <div className={styles.watch}>
                  <Button onClick={() => onWatch(week.highlightBoardId!)} data-testid="report-watch">
                    <Play size={16} strokeWidth={2} aria-hidden />
                    {REPORT_COPY.watch}
                  </Button>
                  <p className={styles.watchHint}>{REPORT_COPY.watchHint}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </li>
  );
}
