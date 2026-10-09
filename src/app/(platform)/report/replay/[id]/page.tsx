import type { Metadata } from "next";
import { ReplayScreen } from "@/components/report/ReplayScreen";

export const metadata: Metadata = {
  title: "Watch them solve it",
  description: "A board from the weekly report, replayed stroke by stroke.",
};

// Server component for the title; the board is read in the browser through GET
// /api/report/boards/<id>, which opens it only for its owner or the owner's grown-up.
export default async function ReportReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReplayScreen boardId={id} />;
}
