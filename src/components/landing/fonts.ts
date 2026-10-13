import { Fraunces } from "next/font/google";

/**
 * The landing page's display face (v4, "warm it up"): Fraunces, a warm old-style serif, set soft
 * (its SOFT axis at 100 rounds every terminal and serif) for the headlines, with Arc's body face for
 * everything else (landing.module.css: `.display`, `.h2`, `.h3`, the price, the bar's name). Chosen
 * over Newsreader (a newspaper's), Young Serif (one heavy weight) and Gloock (a fashion page's) with
 * the hero's headline set in each (docs/qa-screenshots/landing-v4/font-compare.png).
 *
 * Loaded only where it is imported: the landing page, and any page that reuses its pieces. Its two
 * extra axes (optical size and softness) make it a 121 KB file for Latin, preloaded on those pages.
 */
export const landingSerif = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
  variable: "--font-lp-serif",
  display: "swap",
});

/**
 * Put this class on a page's wrapper (the landing page puts it beside `.page`) and the landing
 * stylesheet's headings inside it are set in the serif: it defines `--font-lp-serif`, which
 * `.display`, `.h2`, `.h3` and `--lp-serif` read, falling back to Arc's display face without it.
 */
export const landingFontClass = landingSerif.variable;
