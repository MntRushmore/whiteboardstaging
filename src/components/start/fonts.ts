import { Fraunces } from "next/font/google";

/**
 * /start's titles in the landing page's display face (landing v4, "warm it up": Fraunces set soft),
 * so a family who taps Join on the landing page lands in the same voice. The same face and axes as
 * the landing page's own loader (src/components/landing/fonts.ts on feat/landing-v4), loaded only
 * on /start; everything else stays in Arc's body face.
 */
export const startSerif = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
  variable: "--font-start-serif",
  display: "swap",
});
