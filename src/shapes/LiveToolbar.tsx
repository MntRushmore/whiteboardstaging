"use client";

import { DefaultToolbar, DefaultToolbarContent } from "tldraw";

/**
 * tldraw's toolbar: its own content, without the text tool (the board page takes it off) and
 * without the old Math tool, whose typed boxes the tutor never read. Everything on the board is
 * written with a pen, a finger or the mouse (Type it, the typing bar, was taken off on 2026-10-13:
 * the owner, "we can just use the mouse").
 */
export function LiveToolbar() {
  return (
    <DefaultToolbar>
      <DefaultToolbarContent />
    </DefaultToolbar>
  );
}
