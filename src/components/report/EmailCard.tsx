"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { setReportEmailOptOut } from "@/lib/report/client";
import { REPORT_COPY } from "@/lib/report/copy";
import { reportUserError } from "@/lib/reportAppError";
import styles from "./report.module.css";

/**
 * "Email me this every Sunday": the grown-up's own switch for the weekly email
 * (profiles.weekly_report_opt_out, through the set_weekly_report_opt_out RPC). The page shows it only
 * where the email is actually sent (WEEKLY_REPORT_EMAILS=on), so nobody turns on an email that never
 * comes. The switch moves at once and moves back if the save fails.
 */
export function EmailCard({ optedOut }: { optedOut: boolean }) {
  const [on, setOn] = useState(!optedOut);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    if (saving) return;
    const next = !on;
    setOn(next);
    setSaving(true);
    try {
      const stored = await setReportEmailOptOut(!next);
      setOn(!stored);
      toast.success(REPORT_COPY.emailSaved(!stored));
    } catch (err) {
      setOn(!next);
      toast.error(REPORT_COPY.emailFailed);
      reportUserError({ kind: "live.account", code: "report_email_toggle", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.email} aria-labelledby="report-email-title">
      <span className={styles.emailIcon} aria-hidden>
        <Mail size={18} strokeWidth={1.9} />
      </span>
      <div>
        <p id="report-email-title" className={styles.emailTitle}>
          {REPORT_COPY.emailTitle}
        </p>
        <p className={styles.emailBody}>{on ? REPORT_COPY.emailOn : REPORT_COPY.emailOff}</p>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={REPORT_COPY.emailToggle} className={styles.switch} onClick={() => void toggle()} disabled={saving} data-testid="report-email-switch">
        <span className={styles.switchThumb} aria-hidden />
      </button>
    </section>
  );
}
