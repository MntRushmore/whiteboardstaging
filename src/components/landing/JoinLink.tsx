"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { START_HREF, startHref } from "@/lib/landing/links";

const subscribeNever = () => () => {};

/** /start with this page's `?ref` and `utm_*` (`startHref`); plain /start on the server. */
function joinHrefHere(): string {
  return startHref(window.location.search);
}

/**
 * Every "Join Agathon" on the landing page: a link to /start (docs/START-FLOW.md) that carries the
 * visitor's `?ref` and `utm_*` on. The server's HTML (and a search engine) gets plain /start, so the
 * page stays static; in the browser the link takes the address's own parameters.
 */
export function JoinLink({ className, children }: { className?: string; children: ReactNode }) {
  const href = useSyncExternalStore(subscribeNever, joinHrefHere, () => START_HREF);
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
