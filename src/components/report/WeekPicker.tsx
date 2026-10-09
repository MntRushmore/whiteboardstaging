"use client";

import { useMemo } from "react";
import { REPORT_COPY } from "@/lib/report/copy";
import { earlierWeekOptions, weekChoice, weekChoices, weekForChoice, type WeekChoice } from "@/lib/report/view";
import SegmentedControl from "@/registry/components/segmented-control/segmented-control";
import { Select } from "@/registry/components/select/select";
import styles from "./report.module.css";

/**
 * Which week the report shows: this week, last week, or an earlier one picked from a list (the last
 * EARLIER_WEEKS weeks by their dates, and the shown week when a link opened an older one). Nothing
 * before `oldest`, the week the account was made: an account from this week has no picker, one from
 * last week no "Earlier". Weeks are the family's own (`timeZone`), Monday to Sunday.
 */
export function WeekPicker({ weekStart, now, timeZone, oldest = null, onChange }: { weekStart: string; now: number; timeZone: string; oldest?: string | null; onChange: (weekStart: string) => void }) {
  const choice = weekChoice(weekStart, now, timeZone);
  const earlier = useMemo(() => earlierWeekOptions(weekStart, now, timeZone, undefined, oldest), [weekStart, now, timeZone, oldest]);
  const labels: Record<WeekChoice, string> = { this: REPORT_COPY.thisWeek, last: REPORT_COPY.lastWeek, earlier: REPORT_COPY.earlier };
  const options = weekChoices(now, timeZone, oldest).map((value) => ({ value, label: labels[value] }));
  if (options.length < 2) return null;
  return (
    <div className={styles.picker}>
      <SegmentedControl className={styles.weekTabs} options={options} value={choice} onValueChange={(v) => onChange(weekForChoice(v as WeekChoice, now, timeZone))} label={REPORT_COPY.pickerLabel} />
      {choice === "earlier" && (
        <div className={styles.pickerEarlier}>
          <Select label={REPORT_COPY.earlierLabel} options={earlier} value={weekStart} onValueChange={onChange} />
        </div>
      )}
    </div>
  );
}
