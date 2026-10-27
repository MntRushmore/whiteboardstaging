import type { Metadata } from "next";
import { ShareScreen } from "@/components/share/ShareScreen";

export const metadata: Metadata = {
  title: "Share a window to your iPad",
  description: "Show a window from this computer live beside your board on the iPad.",
};

// Signed in only (the page sends to the person's own private channel). Not indexed (the root layout).
export default function SharePage() {
  return <ShareScreen />;
}
