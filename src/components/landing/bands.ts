/**
 * Anchors the landing page's parts share, kept out of the client islands so the server components can
 * read them as values (an import from a "use client" file is a client reference, not the string).
 */

/** A band the sticky bar turns dark over (`NavTone`); GrownUps marks its section with it. */
export const DARK_BAND_ATTR = "data-lp-dark";

/** How it works, which the hero's "See how it works" link and the bar jump to. */
export const HOW_ID = "how-it-works";
/** The bar's other jumps (v3). */
export const ASK_ID = "ask";
export const GROWN_UPS_ID = "grown-ups";
export const PRICING_ID = "pricing";
/** The last band, the way in. */
export const JOIN_ID = "join";
