"use client";

import { useMemo } from "react";
import { REPORT_COPY } from "@/lib/report/copy";
import { earlierWeekOptions, weekChoice, weekForChoice, type WeekChoice } from "@/lib/report/view";
import SegmentedControl from "@/registry/components/segmented-control/segmented-control";
import { Select } from "@/registry/components/select/select";
import styles from "./report.module.css";

/**
 * Which week the report shows: this week, last week, or an earlier one picked from a list (the last
 * EARLIER_WEEKS weeks by their dates, and the shown week when a link opened an older one). Weeks are
 * the family's own (`timeZone`), Monday to Sunday.
 */
export function WeekPicker({ weekStart, now, timeZone, onChange }: { weekStart: string; now: number; timeZone: string; onChange: (weekStart: string) => void }) {
  const choice = weekChoice(weekStart, now, timeZone);
  const earlier = useMemo(() => earlierWeekOptions(weekStart, now, timeZone), [weekStart, now, timeZone]);
  const options = [
    { value: "this", label: REPORT_COPY.thisWeek },
    { value: "last", label: REPORT_COPY.lastWeek },
    { value: "earlier", label: REPORT_COPY.earlier },
  ];
  return (
    <div className={styles.picker}>
      <SegmentedControl options={options} value={choice} onValueChange={(v) => onChange(weekForChoice(v as WeekChoice, now, timeZone))} label={REPORT_COPY.pickerLabel} />
      {choice === "earlier" && (
        <div className={styles.pickerEarlier}>
          <Select label={REPORT_COPY.earlierLabel} options={earlier} value={weekStart} onValueChange={onChange} />
        </div>
      )}
    </div>
  );
}
