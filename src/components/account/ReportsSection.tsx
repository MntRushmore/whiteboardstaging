"use client";

import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { SECTION_BODY, SectionHeader } from "@/components/account/SectionHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { REPORTS_PATH } from "@/lib/bugReports/paths";
import { REPORTS_COPY } from "@/lib/bugReports/view";

/**
 * Bug reports on the account page: one line and a link to /reports, where the reports this profile
 * sent and our replies are read and answered. For everyone, a kid profile included: their reports
 * are their own.
 */
export function ReportsSection() {
  return (
    <Card data-testid="reports-section">
      <SectionHeader title={REPORTS_COPY.accountTitle} description={REPORTS_COPY.accountHint} />
      <CardContent className={SECTION_BODY}>
        <Button asChild size="sm" variant="outline" className="pointer-coarse:h-11">
          <Link href={REPORTS_PATH}>
            <MessagesSquare className="size-4" aria-hidden />
            {REPORTS_COPY.link}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
