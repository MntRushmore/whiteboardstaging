/**
 * When the hero's replay plays: once the iPad is at least half in view, not when the page loads, so a
 * parent who scrolls down to it sees it from the first stroke.
 *
 * `REPLAY_START_SCRIPT` runs inline right after the figure in the server HTML, before the first
 * paint and without waiting for hydration. It holds the replay with a style of its own in <head>
 * (`#lp-replay` animations paused) and removes it once the iPad is half in view; it never touches an
 * element React renders, so hydration sees the server's HTML unchanged. A browser without
 * IntersectionObserver plays at once; without scripts nothing is held, so the replay plays on load
 * as CSS alone would. `holdUntilSeen` does the same from Watch again's island when the page was
 * reached by a client-side navigation, where an inline script does not run.
 */

export const REPLAY_ID = "lp-replay";

/** Half the iPad in view. */
export const REPLAY_VISIBLE = 0.5;

/** The held style's id, and the flag the inline script leaves on window once it has run. */
const HOLD_ID = "lp-replay-hold";
const FLAG = "__lpReplay";

export const REPLAY_START_SCRIPT =
  `(function(){var f=document.getElementById(${JSON.stringify(REPLAY_ID)});if(!f)return;window.${FLAG}=1;` +
  `if(!("IntersectionObserver" in window))return;` +
  `var s=document.createElement("style");s.id=${JSON.stringify(HOLD_ID)};` +
  `s.textContent="#${REPLAY_ID} path,#${REPLAY_ID} span{animation-play-state:paused!important}";document.head.appendChild(s);` +
  `var o=new IntersectionObserver(function(e){for(var i=0;i<e.length;i++)if(e[i].intersectionRect.height>=${REPLAY_VISIBLE}*e[i].boundingClientRect.height){o.disconnect();s.remove()}},{threshold:[0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1]});` +
  `o.observe(f)})();`;

/**
 * Half the iPad's height in view. Height, not area: on a phone the iPad runs off both edges, so its
 * visible area never reaches half of its box however far a parent scrolls.
 */
function halfInView(entry: IntersectionObserverEntry): boolean {
  return entry.intersectionRect.height >= REPLAY_VISIBLE * entry.boundingClientRect.height;
}
const THRESHOLDS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

/** Lets the replay go now (Watch again): drops the inline script's hold if it is still there. */
export function releaseHold(): void {
  document.getElementById(HOLD_ID)?.remove();
}

/**
 * For a figure the inline script never saw: hold its animations at the start, play them once it is
 * half in view. Returns a cleanup.
 */
export function holdUntilSeen(board: HTMLElement): () => void {
  if (typeof IntersectionObserver === "undefined") {
    releaseHold();
    return () => {};
  }
  const ranInline = Boolean((window as unknown as Record<string, unknown>)[FLAG]);
  // the inline script's hold still up: watch this figure too (the one React hydrated), in case the
  // script's own observer is watching an element hydration replaced
  if (ranInline && !document.getElementById(HOLD_ID)) return () => {};
  const animations = ranInline ? [] : board.getAnimations({ subtree: true });
  for (const animation of animations) {
    animation.pause();
    animation.currentTime = 0;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some(halfInView)) return;
      observer.disconnect();
      releaseHold();
      for (const animation of animations) animation.play();
    },
    { threshold: THRESHOLDS },
  );
  observer.observe(board);
  return () => observer.disconnect();
}
