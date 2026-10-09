import type { Metadata } from "next";
import { FamilyScreen } from "@/components/family/FamilyScreen";

export const metadata: Metadata = {
  title: "Family",
  description: "Your kids' profiles: one plan for everyone, each kid with their own boards and progress.",
};

// Server component for the title; the page reads the family in the browser with the grown-up's own
// session (GET /api/family), like /account and /progress.
export default function FamilyPage() {
  return <FamilyScreen />;
}
