"use client";

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { trailShape, type TrailShape } from "@/lib/path/pathLayout";

/**
 * The trail's own hooks: its shape for the width it has, and the next stop in view on a phone. Apart
 * from the data hooks (`usePath.ts`), so the trail draws from a fixture with no network around it.
 */

/** A layout effect in the browser, a plain one on the server (no warning when rendered to a string). */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** A stop's least width, as the stylesheet's `--cell` on a wide screen (8 rem). */
const CELL_PX = 128;
/** The room the trail's turns take on each side (`--turn`, 1.5 rem). */
const TURN_PX = 24;

/**
 * The trail's shape for the width it has: one row scrolled sideways on a phone, a snake of as many
 * columns as fit on a wider screen. Measured before the first paint and again when the width changes.
 */
export function useTrailShape(ref: RefObject<HTMLElement | null>, count: number): TrailShape {
  const [width, setWidth] = useState(0);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth - 2 * TURN_PX);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return trailShape(width, count, CELL_PX, 0);
}

/**
 * On a phone, the next stop in the middle of the scrolled row when the trail first shows, so a kid
 * halfway along sees where they are, not the start. Only the row scrolls, never the page.
 */
export function useCenterCurrent(ref: RefObject<HTMLElement | null>, shape: TrailShape, currentIndex: number): void {
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || shape.mode !== "scroll" || currentIndex < 0) return;
    const stop = el.querySelectorAll<HTMLElement>("[data-stop]")[currentIndex];
    if (!stop) return;
    el.scrollLeft = Math.max(0, stop.offsetLeft - (el.clientWidth - stop.offsetWidth) / 2);
  }, [ref, shape.mode, currentIndex]);
}
