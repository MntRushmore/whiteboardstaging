"use client";

import { useEffect } from "react";
import { DARK_BAND_ATTR } from "./bands";

/**
 * Turns the landing page's sticky bar dark while it sits over a dark band: a white, translucent bar
 * over near-black reads as muddy grey with the band's words smeared through it. Sets
 * `data-tone="dark"` on the bar (landing.module.css) when a dark band covers the bar's strip at the
 * top of the screen. Renders nothing; without a script the bar simply stays light.
 */
export function NavTone({ navId }: { navId: string }) {
  useEffect(() => {
    const nav = document.getElementById(navId);
    const bands = document.querySelectorAll(`[${DARK_BAND_ATTR}]`);
    if (!nav || bands.length === 0 || typeof IntersectionObserver === "undefined") return;
    const under = new Set<Element>();
    // only the strip of the screen the bar covers (the top 6%: about its own 56 px on a phone or a laptop)
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) under.add(entry.target);
          else under.delete(entry.target);
        }
        if (under.size > 0) nav.setAttribute("data-tone", "dark");
        else nav.removeAttribute("data-tone");
      },
      { rootMargin: "0px 0px -94% 0px" },
    );
    for (const band of bands) observer.observe(band);
    return () => observer.disconnect();
  }, [navId]);
  return null;
}
