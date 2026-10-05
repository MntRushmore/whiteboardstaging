import { Bricolage_Grotesque, Shantell_Sans } from "next/font/google";

/**
 * The plan screen's two faces, loaded on that route only (PlanOffer imports this file).
 * - Bricolage Grotesque: a warm grotesque with an optical-size axis, friendly enough for a child and
 *   plain enough for the grown-up reading the renewal terms.
 * - Shantell Sans: the board's own handwriting face (tldraw's draw font), so the sheet on the screen
 *   is the product, not an illustration of it.
 */
export const planFace = Bricolage_Grotesque({
  variable: "--font-plan",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

export const planHand = Shantell_Sans({
  variable: "--font-plan-hand",
  subsets: ["latin"],
  display: "swap",
});
