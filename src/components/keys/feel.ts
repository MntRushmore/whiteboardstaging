/**
 * How the Keys page feels (docs/KEYS.md, "Focus"): a digit pops into its box, a star flies up into
 * the stars pill, and soft sounds answer a check. All of it is off under Reduce Motion (the sounds
 * are separate: a switch in More, remembered on this device).
 */

const SOUNDS_KEY = "agathon.keys.sounds";

function still(): boolean {
  return typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A typed digit lands in its box. */
export function pop(el: Element | null) {
  if (!el || still() || typeof (el as HTMLElement).animate !== "function") return;
  (el as HTMLElement).animate(
    [
      { transform: "scale(0.82)", opacity: 0.4 },
      { transform: "scale(1.06)", opacity: 1, offset: 0.6 },
      { transform: "scale(1)", opacity: 1 },
    ],
    { duration: 240, easing: "cubic-bezier(0.3, 1.4, 0.5, 1)" },
  );
}

const STAR_SVG =
  '<svg width="44" height="44" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 L14.9 8.6 L21.5 9.4 L16.6 13.9 L17.9 20.5 L12 17.2 L6.1 20.5 L7.4 13.9 L2.5 9.4 L9.1 8.6 Z" fill="#FFD12E"/></svg>';

/** A star flies in an arc from the cheer to the stars pill; `land` runs when it arrives (at once under Reduce Motion). */
export function flyStar(from: Element | null, to: Element | null, land: () => void) {
  if (!from || !to || still()) return land();
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const el = document.createElement("div");
  el.innerHTML = STAR_SVG;
  Object.assign(el.style, {
    position: "fixed",
    left: `${a.left + a.width / 2 - 22}px`,
    top: `${a.top + a.height / 2 - 22}px`,
    zIndex: "50",
    pointerEvents: "none",
  });
  document.body.appendChild(el);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  let over = false;
  const finish = () => {
    if (over) return;
    over = true;
    el.remove();
    land();
  };
  const anim = el.animate(
    [
      { transform: "translate(0, 0) scale(0.6)" },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 90}px) scale(1.35)`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.6)` },
    ],
    { duration: 720, easing: "cubic-bezier(0.45, 0.05, 0.35, 1)" },
  );
  anim.onfinish = finish;
  // a background tab may never finish the animation: land anyway
  window.setTimeout(finish, 1000);
}

/** Lands a bump on the stars pill. */
export function bump(el: Element | null) {
  if (!el || still() || typeof (el as HTMLElement).animate !== "function") return;
  (el as HTMLElement).animate([{ transform: "scale(1)" }, { transform: "scale(1.16)", offset: 0.4 }, { transform: "scale(1)" }], {
    duration: 420,
    easing: "cubic-bezier(0.3, 1.6, 0.5, 1)",
  });
}

// ---------------------------------------------------------------- sounds

export type SoundKind = "key" | "block" | "right" | "small" | "look" | "star";

export function soundsOn(): boolean {
  try {
    return window.localStorage.getItem(SOUNDS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundsOn(on: boolean) {
  try {
    window.localStorage.setItem(SOUNDS_KEY, on ? "on" : "off");
  } catch {
    // private window: the switch lasts for this page only
  }
  quietFallback = !on;
}

let quietFallback = false;
let ctx: AudioContext | null = null;

function tone(ac: AudioContext, freq: number, at: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const t = ac.currentTime + at;
  const osc = ac.createOscillator();
  const vol = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  vol.gain.setValueAtTime(0, t);
  vol.gain.linearRampToValueAtTime(gain, t + 0.01);
  vol.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(vol).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Soft, short sounds made in the browser (no files to load). Only after the kid has pressed a key. */
export function play(kind: SoundKind) {
  if (typeof window === "undefined" || quietFallback || !soundsOn()) return;
  try {
    ctx ??= new AudioContext();
  } catch {
    return;
  }
  const ac = ctx;
  if (ac.state === "suspended") void ac.resume();
  switch (kind) {
    case "key":
      return tone(ac, 740, 0, 0.05, 0.03, "triangle");
    case "block":
      return tone(ac, 520, 0, 0.08, 0.045, "triangle");
    case "right":
      tone(ac, 523, 0, 0.18, 0.06);
      tone(ac, 659, 0.09, 0.18, 0.06);
      return tone(ac, 784, 0.18, 0.32, 0.06);
    case "small":
      tone(ac, 659, 0, 0.12, 0.05);
      return tone(ac, 880, 0.08, 0.2, 0.05);
    case "look":
      tone(ac, 392, 0, 0.16, 0.045);
      return tone(ac, 349, 0.12, 0.22, 0.045);
    case "star":
      return tone(ac, 988, 0, 0.12, 0.045, "triangle");
  }
}
