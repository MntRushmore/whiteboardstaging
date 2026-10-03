/**
 * The board while the on-screen keyboard is up for the Ask panel (iPadOS Safari; Android Chrome
 * does the same). The keyboard shrinks only the visual viewport: the board's `position: fixed;
 * inset: 0` root stays as tall as the screen and Safari pans the page to bring the text box into
 * view, which slides the board's top bar, the panel's header and the top of the board (where the
 * tutor writes its answer) up out of sight. While a field in the panel has focus and the keyboard
 * hides part of the screen, the root is laid over the part that is still visible instead: the
 * board refits to the room left (useScreenCamera) and the panel's box and replies stay in view.
 *
 * Only while the panel is docked beside the board (an iPad held sideways: the page's
 * `md:landscape:` layout) and enough stays visible: there the board keeps its width and the whole
 * screen stays in view, smaller. Upright, the panel is a bottom sheet and the room the keyboard
 * leaves would go to the sheet and the board's own bars, so Safari's panning (to the text box) is
 * the better trade; on a phone the keyboard leaves too little either way. Nothing changes while
 * the page is pinch-zoomed, or when the keyboard hides nothing (a floating or hardware keyboard).
 */

export interface VisualViewportLike {
  readonly height: number;
  readonly offsetTop: number;
  readonly scale: number;
}

/** Less hidden than this is not a keyboard (rounding, a thin system bar). */
export const KEYBOARD_MIN_HIDDEN_PX = 40;
/** Fit only while this much stays visible above the keyboard (an iPad's; a phone's is less). */
export const KEYBOARD_FIT_MIN_VISIBLE_PX = 360;
/** The board page's `md:landscape:` layout: the Ask panel docked beside the board. */
export const PANEL_DOCKED_QUERY = "(min-width: 768px) and (orientation: landscape)";

export interface FitBox {
  top: number;
  height: number;
}

/**
 * Where to lay the board's root, given the visual viewport and the layout viewport's size:
 * the visible box, or null for "as laid out" (inset: 0).
 */
export function keyboardFitBox(vv: VisualViewportLike | null | undefined, layout: { height: number }): FitBox | null {
  if (!vv || !(layout.height > 0)) return null;
  if (Math.abs(vv.scale - 1) > 0.01) return null;
  const height = Math.round(vv.height);
  const top = Math.max(0, Math.round(vv.offsetTop));
  if (layout.height - height < KEYBOARD_MIN_HIDDEN_PX) return null;
  if (height < KEYBOARD_FIT_MIN_VISIBLE_PX) return null;
  return { top, height };
}

export interface KeyboardFitEnv {
  /** `window.visualViewport` (missing in very old browsers: then nothing is done) */
  viewport: (VisualViewportLike & Pick<EventTarget, "addEventListener" | "removeEventListener">) | null | undefined;
  /** where focus moves (the document) */
  focusEvents: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  /** the layout viewport's height: `document.documentElement.clientHeight` */
  layoutHeight(): number;
  /** a field inside the Ask panel has focus */
  focusInPanel(): boolean;
  /** the panel is docked beside the board (`PANEL_DOCKED_QUERY`), not a bottom sheet */
  panelDocked(): boolean;
  /** the page was left scrolled by the keyboard: put it back (`window.scrollTo(0, 0)` when scrolled) */
  resetScroll(): void;
}

type RootStyle = Pick<CSSStyleDeclaration, "top" | "height" | "bottom">;

/** Keeps `root` over the visible part of the screen while the keyboard is up for the panel. Returns the cleanup. */
export function attachKeyboardFit(root: { style: RootStyle }, env: KeyboardFitEnv): () => void {
  const vv = env.viewport;
  if (!vv) return () => {};
  let fitted: FitBox | null = null;
  const clear = () => {
    root.style.top = "";
    root.style.height = "";
    root.style.bottom = "";
  };
  const apply = () => {
    const box = env.focusInPanel() && env.panelDocked() ? keyboardFitBox(vv, { height: env.layoutHeight() }) : null;
    if (box) {
      if (fitted && fitted.top === box.top && fitted.height === box.height) return;
      root.style.top = `${box.top}px`;
      root.style.height = `${box.height}px`;
      root.style.bottom = "auto";
      fitted = box;
    } else if (fitted) {
      clear();
      fitted = null;
      env.resetScroll();
    }
  };
  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);
  env.focusEvents.addEventListener("focusin", apply);
  env.focusEvents.addEventListener("focusout", apply);
  return () => {
    vv.removeEventListener("resize", apply);
    vv.removeEventListener("scroll", apply);
    env.focusEvents.removeEventListener("focusin", apply);
    env.focusEvents.removeEventListener("focusout", apply);
    if (fitted) clear();
  };
}

/** The browser's environment for `attachKeyboardFit`, around the Ask panel's host element. */
export function browserKeyboardFitEnv(panel: HTMLElement): KeyboardFitEnv {
  return {
    viewport: window.visualViewport,
    focusEvents: document,
    layoutHeight: () => document.documentElement.clientHeight,
    focusInPanel: () => {
      const a = document.activeElement;
      return Boolean(a && a !== document.body && panel.contains(a));
    },
    panelDocked: () => window.matchMedia?.(PANEL_DOCKED_QUERY).matches ?? false,
    resetScroll: () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    },
  };
}
