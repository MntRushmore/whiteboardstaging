"use client";

import { useEffect, useSyncExternalStore, type RefObject } from "react";

/** True from `minWidth` px (a media query; "wide" on the server, where nothing of the console renders). */
export function useWide(minWidth: number): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(`(min-width: ${minWidth}px)`).matches,
    () => true,
  );
}

/** The key went to a text field (so a one-letter shortcut must not fire). */
export function isTyping(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return Boolean(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
}

/** "/" focuses `ref` (not while typing elsewhere or with a modifier). */
export function useSlashFocus(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      ref.current?.focus();
      ref.current?.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}
