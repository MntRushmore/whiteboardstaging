"use client";

/**
 * Who's practising: the family's profiles (src/lib/family/contracts.ts) in the app bar, to switch
 * between the grown-up and the kids. Loaded with a dynamic import; renders nothing for an account
 * with no kids.
 *
 * SLOT (contract 2026-10-09): the family agent fills this in (feat/kcb-family). Nothing imported
 * here may reach tldraw: the app bar renders on prerendered pages.
 */

export default function ProfileSwitcher() {
  return null;
}
