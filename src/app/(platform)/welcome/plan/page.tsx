import type { Metadata } from "next";
import { PlanScreen } from "@/components/onboarding/PlanScreen";

export const metadata: Metadata = {
  title: "Your free trial",
};

// The last screen of onboarding, after the guided board: a route of its own, so its code is its
// own chunk (never on the board's or the home's first load). Everything on it needs the session.
export default function PlanPage() {
  return <PlanScreen />;
}
