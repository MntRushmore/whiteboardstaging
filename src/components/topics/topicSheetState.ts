import { atom } from "tldraw";

/**
 * The board's New topic sheet: opened from the screen strip (a tldraw slot, no props), drawn by
 * the board page, which has the controller it writes with. Part of the board's first load: one atom.
 */
export const topicSheetOpen = atom<boolean>("topics.sheetOpen", false);
