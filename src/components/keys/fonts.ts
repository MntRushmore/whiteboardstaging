import { Bricolage_Grotesque, Kalam, Lexend } from "next/font/google";

/**
 * Blocks' three faces on the web (docs/DESIGN-SYSTEM.md, "Type"), for the Keys page only: no other
 * page loads them. Bricolage Grotesque ExtraBold for headings, Lexend for the body and the kid's
 * numbers, Kalam Bold for the tutor's hand (in cobalt, and only the tutor's).
 */
export const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["800"],
  variable: "--k-font-display",
  display: "swap",
});

export const lexend = Lexend({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--k-font-body",
  display: "swap",
});

export const kalam = Kalam({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--k-font-hand",
  display: "swap",
});

export const KEYS_FONT_VARS = `${bricolage.variable} ${lexend.variable} ${kalam.variable}`;
