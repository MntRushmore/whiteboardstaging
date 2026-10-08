/**
 * The admin board viewer's dev fixture (`/admin/boards/<any id>?fixture=synthetic`): an
 * `AdminBoardDoc` built around a made-up board, so the viewer can be run and looked at without the
 * admin API or a real student's board. Never in production: the viewer imports this only behind
 * `process.env.NODE_ENV !== "production"` (a dynamic import the production build drops).
 *
 *   synthetic   a 300-stroke board (`synthetic:2000` for more; `synthetic:2000:2000` all on one screen), its times stamped
 *   untimed     the same board as an old one (no times on the student's ink)
 *   live        a board that grows by a line every few seconds: "Follow live"
 *   file        a board export kept on this machine only (public/dev-fixtures/board.json, never committed)
 */
import type { AdminBoardDoc } from "@/lib/admin/contracts";
import { syntheticBoard } from "./synthetic";

export const DEV_FIXTURE_NAMES = ["synthetic", "untimed", "live", "file"] as const;
export type DevFixtureName = (typeof DEV_FIXTURE_NAMES)[number];

const BOARD_ID = "00000000-0000-4000-8000-00000000b0a2";
const USER_ID = "00000000-0000-4000-8000-0000000005e2";
/** the live fixture's board started here and gains a line every LIVE_EVERY_MS */
const LIVE_EVERY_MS = 6_000;

export function devFixtureDoc(name: DevFixtureName, opts: { strokes?: number; perPage?: number; now?: number; snapshot?: unknown; updatedAt?: number } = {}): AdminBoardDoc {
  const now = opts.now ?? Date.now();
  let snapshot: unknown;
  let version: number;
  let updatedAt: number;
  let start: number;
  if (name === "file") {
    snapshot = opts.snapshot ?? null;
    version = 1;
    updatedAt = opts.updatedAt ?? now - 3 * 60 * 60_000;
    start = updatedAt - 2 * 60 * 60_000;
  } else if (name === "live") {
    // a board begun at the top of the hour, a line more every few seconds (its version is its line
    // count); the same records each read but the new ones, as a real board's would be
    start = now - (now % 3_600_000);
    const lines = 6 + (Math.floor((now % 3_600_000) / LIVE_EVERY_MS) % 120);
    snapshot = syntheticBoard({ strokes: lines * 9, start, seed: 7 });
    version = lines;
    updatedAt = now - (now % LIVE_EVERY_MS);
  } else {
    start = Date.UTC(2026, 9, 6, 20, 4);
    snapshot = syntheticBoard({ strokes: opts.strokes ?? 300, perPage: opts.perPage, timed: name === "synthetic", start });
    version = 42;
    updatedAt = start + 40 * 60_000;
  }
  const sizeKb = Math.round(JSON.stringify(snapshot ?? null).length / 1024);
  const iso = (t: number) => new Date(t).toISOString();
  const event = (id: number, at: number, kind: string, message: string, level: "error" | "warn" = "error") => ({
    id,
    at: iso(at),
    source: "live" as const,
    level,
    kind,
    code: null,
    message,
    route: null,
    userId: USER_ID,
    userEmail: "student@example.com",
    boardId: BOARD_ID,
    requestId: null,
    meta: null,
    release: "dev",
    noise: false,
  });
  return {
    generatedAt: iso(now),
    board: {
      id: BOARD_ID,
      userId: USER_ID,
      ownerEmail: "student@example.com",
      ownerName: "Sam Student",
      title: name === "file" ? "A real board (local file)" : "Fractions practice",
      createdAt: iso(start - 60_000),
      updatedAt: iso(updatedAt),
      preview: null,
      version,
      sizeKb,
      attempts: 3,
      errors7d: 2,
    },
    snapshot,
    events: [event(1, start + 4 * 60_000, "live.check", "Checking failed: the tutor took too long"), event(2, start + 11 * 60_000, "live.solve", "Solve failed", "warn")],
    attempts: [
      { id: "a1", boardId: BOARD_ID, problemLatex: "\\frac{3}{4}+\\frac{1}{8}", skill: "fractions.add", outcome: "self_corrected", hints: 0, solves: 0, linesRinged: 1, activeMs: 240_000, startedAt: iso(start + 60_000), finishedAt: iso(start + 5 * 60_000) },
      { id: "a2", boardId: BOARD_ID, problemLatex: "2x+5=17", skill: "equations.linear", outcome: "first_try", hints: 0, solves: 0, linesRinged: 0, activeMs: 180_000, startedAt: iso(start + 6 * 60_000), finishedAt: iso(start + 9 * 60_000) },
      { id: "a3", boardId: BOARD_ID, problemLatex: "12\\times 13", skill: "arithmetic.multiply", outcome: "with_help", hints: 2, solves: 0, linesRinged: 1, activeMs: 300_000, startedAt: iso(start + 10 * 60_000), finishedAt: null },
    ],
    history: [
      { id: 9, at: iso(updatedAt - 20 * 60_000), version: Math.max(1, version - 3), reason: "before_restore" },
      { id: 8, at: iso(updatedAt - 50 * 60_000), version: Math.max(1, version - 9), reason: "daily" },
    ],
  };
}
