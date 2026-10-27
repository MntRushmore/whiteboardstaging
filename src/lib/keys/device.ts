/**
 * Is this a laptop (docs/KEYS.md, Phase 4)? Home's Today's practice opens Keys instead of a board
 * when the main pointer is fine (a trackpad or a mouse) and nothing on the device is touch: a
 * Chromebook or a laptop, not an iPad, a phone or a touch-screen laptop (that one has a pen-friendly
 * board already). Server rendering and a browser without `matchMedia` say no.
 */
export interface PointerEnv {
  matchMedia?: (query: string) => { matches: boolean };
  maxTouchPoints?: number;
}

export function isKeyboardDevice(env: PointerEnv | null = typeof window === "undefined" ? null : { matchMedia: window.matchMedia?.bind(window), maxTouchPoints: navigator.maxTouchPoints }): boolean {
  if (!env?.matchMedia) return false;
  try {
    const fine = env.matchMedia("(pointer: fine)").matches;
    const touch = env.matchMedia("(any-pointer: coarse)").matches || (env.maxTouchPoints ?? 0) > 0;
    return fine && !touch;
  } catch {
    return false;
  }
}
