"use client";

import { useEffect, useLayoutEffect, useSyncExternalStore, type RefObject } from "react";

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

/** What `holdTitle` needs of the document (the real one, or a test's). */
export interface TitleDocument {
  title: string;
  head: Node;
}
export type TitleObserver = new (callback: () => void) => { observe(target: Node, options: MutationObserverInit): void; disconnect(): void };

/**
 * Sets the tab's title, and sets it again each time something else writes over it, until the
 * returned stop. Next's metadata for the route ("Agathon", from the root layout) can land after
 * the page's first effects, so a title set once was lost whenever the page knew it early (a
 * non-admin's "Not found" from the cached hint; a console page whose answer was already cached).
 */
export function holdTitle(doc: TitleDocument, title: string, Observer: TitleObserver): () => void {
  const apply = () => {
    if (doc.title !== title) doc.title = title;
  };
  apply();
  const observer = new Observer(apply);
  observer.observe(doc.head, { subtree: true, childList: true, characterData: true });
  return () => observer.disconnect();
}

/**
 * The tab's title while this page shows (null: leave it as it is). A layout effect: its cleanup
 * runs in the commit that leaves the page, before the next page's title can be written over.
 */
export function useDocumentTitle(title: string | null): void {
  useLayoutEffect(() => {
    if (title === null) return;
    return holdTitle(document, title, MutationObserver);
  }, [title]);
}
