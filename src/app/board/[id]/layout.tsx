import type { Viewport } from "next";

/**
 * The board's viewport: the root layout's, plus `maximum-scale=1`. On an iPhone Safari zooms the
 * page in when a text field under 16 px takes focus (the Ask box, the readback editor, the bug
 * report), and the board can never be zoomed back out: tldraw cancels Safari's page pinch
 * (`gesturestart`) so that a pinch zooms the canvas. `maximum-scale=1` stops that automatic zoom.
 * It costs no zoom a student could use: iOS ignores it for pinch-zoom (it only blocks the
 * automatic one), and the board's page pinch is tldraw's anyway.
 */
export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
