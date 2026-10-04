import type { Metadata } from "next";
import { ProgressScreen } from "@/components/progress/ProgressScreen";

export const metadata: Metadata = {
  title: "Your progress",
  description: "What you practiced this week, the skills you're growing and the slips to watch for.",
};

// Server component for the title; the page itself reads the student's own record in the browser
// (their Supabase session and RLS), like the boards home and /account.
export default function ProgressPage() {
  return <ProgressScreen />;
}
