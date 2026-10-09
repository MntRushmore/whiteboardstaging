"use client";

import React, { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { PenStyleButton } from "@/components/board/PenStyleButton";
import { ScreenStrip, ScreenStripCorner } from "@/components/screens/ScreenStrip";
import { LiveToolbar } from "@/shapes";
import { useSimpleBoard } from "./useSimpleBoard";

/**
 * The board's tldraw slots, each as the simple board has it (`<Tldraw components>` in the board
 * page). The slots are rendered by tldraw, apart from the page's bar, so each reads the simple
 * board itself (`useSimpleBoard`, one store): on, tldraw's palette gives way to the kid dock, which
 * carries the pages and the colours too, so the screen strip and the pen's style panel step aside.
 */

const loadKidDock = () => import("./KidDock");
const KidDock = React.lazy(loadKidDock);
const loadGrownUpMore = () => import("./GrownUpMore");
/** The simple board's More (the board page's bar): lazy like the dock, so a grown-up board pays for neither. */
export const GrownUpMore = React.lazy(loadGrownUpMore);
const loadKidStatus = () => import("./KidStatus");
/** The simple board's status in the bar (Thinking…, Try again): fetched with the dock, so it is there before a failure. */
export const KidStatus = React.lazy(loadKidStatus);

/** Fetches the kid dock's, More's and the kid status's chunks ahead of time (the board page calls it while the board loads). */
export function preloadKidDock(): void {
  for (const load of [loadKidDock, loadGrownUpMore, loadKidStatus]) {
    void load().catch(() => {
      /* tried again when it mounts */
    });
  }
}

function useSimple(): boolean {
  return useSimpleBoard(useAuth().user?.id) === true;
}

/** The Toolbar slot: tldraw's palette (with the Math tool), or the kid dock. */
export function BoardToolbar() {
  const simple = useSimple();
  // a dock whose chunk failed to load: the grown-up palette rather than no tools at all
  if (simple) {
    return (
      <KidDockBoundary fallback={<LiveToolbar />}>
        <React.Suspense fallback={null}>
          <KidDock />
        </React.Suspense>
      </KidDockBoundary>
    );
  }
  return <LiveToolbar />;
}

/** The StylePanel slot: the pen's swatch and style panel; the kid dock has its own colours. */
export function BoardStylePanel() {
  return useSimple() ? null : <PenStyleButton />;
}

/** The NavigationPanel slot: the screen strip at the foot of a wide board; the kid dock's pages instead. */
export function BoardNavigationPanel() {
  return useSimple() ? null : <ScreenStrip />;
}

/** The SharePanel slot: a narrow board's screen strip, in the corner; the kid dock's pages instead. */
export function BoardSharePanel() {
  return useSimple() ? null : <ScreenStripCorner />;
}

/** Warms the dock's chunk as soon as the board is known to be simple, so it is there with the board. */
export function usePreloadKidDock(simple: boolean | null): void {
  useEffect(() => {
    if (simple) preloadKidDock();
  }, [simple]);
}

class KidDockBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
