import { Geist, Geist_Mono } from "next/font/google";

/** The app's Geist faces: the root layout sets their variables; the platform layout reuses Geist for Arc's display face. */
export const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
