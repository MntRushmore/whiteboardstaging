import { LANDING_COPY } from "./copy";

/**
 * CONTRACT STUB (v3, owner: feat/lp3-devices). Under the hero: a strip that moves slowly sideways,
 * one problem from each grade's path (copy.strip.items), each written in the board's hand
 * (HandMath, kid ink) with the tutor's check (InkCheck) and its grade, looping seamlessly. Pauses on
 * hover and for reduced motion (then it is a still row that scrolls sideways by hand).
 */
export function ProblemStrip() {
  const copy = LANDING_COPY.strip;
  return <section aria-label={copy.label} />;
}
