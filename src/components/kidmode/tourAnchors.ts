/**
 * Where the guided first board's coach marks (src/components/onboarding/BoardTour.tsx) find the
 * simple board's buttons. A K–3 kid's guided board is a simple board: tldraw's toolbar, and with it
 * its `tools.draw`, gives way to the kid dock, and the help dial waits behind More. Kept here, apart
 * from the lazy components that wear them, so the tour does not load the dock or More to find them.
 */

/** The kid dock's Pen (KidDock). */
export const KID_PEN_ATTR = "data-kid-pen";

/** The simple board's More button (GrownUpMore). */
export const GROWN_UP_MORE_ATTR = "data-grown-up-more";

/** The pen, in either bar: tldraw's toolbar on the grown-up board, the kid dock on the simple board. */
export const PEN_SELECTOR = `[data-testid="tools.draw"],[${KID_PEN_ATTR}]`;

/** More, where the simple board keeps the help dial (and the pill, with Live's switch). */
export const MORE_SELECTOR = `[${GROWN_UP_MORE_ATTR}]`;
