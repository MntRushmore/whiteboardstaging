import type { Metadata } from "next";
import { ReportsScreen } from "@/components/reports/ReportsScreen";

export const metadata: Metadata = {
  title: "Your bug reports",
  description: "The bug reports you sent, our replies, and a place to write back.",
};

// Server component for the title; the page reads the student's own reports in the browser (their
// Supabase session: my_bug_reports()), like /account and /progress. Not indexed (the root layout).
export default function ReportsPage() {
  return <ReportsScreen />;
}
