import { Suspense } from "react";
import type { Metadata } from "next";
import { ReportScreen } from "@/components/report/ReportScreen";

export const metadata: Metadata = {
  title: "Weekly report",
  description: "Each kid's week on Agathon: problems solved, skills mastered, what to try next, and a replay to watch.",
};

// Server component for the title; the page reads the report in the browser with the signed-in
// session (GET /api/report), like /family and /progress. Suspense: the week is in the URL
// (useSearchParams), which a prerendered page reads only once it is in the browser.
export default function ReportPage() {
  return (
    <Suspense fallback={null}>
      <ReportScreen />
    </Suspense>
  );
}
