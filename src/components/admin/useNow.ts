"use client";

import { useEffect, useState } from "react";

/** "Now", ticking every `everyMs` (15 s), so "Updated 2 min ago" and "3 min ago" stay true between reads. */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}
