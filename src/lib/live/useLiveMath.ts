"use client";

import type { Editor } from "tldraw";
import type { LiveController, UseLiveMathOptions } from "./contracts";

// STUB — WP-D replaces this body (keeps the `useLiveMath` export and signature).
const noop: LiveController = {
  getTranscript: () => ({ lines: [], summary: "Live is not ready." }),
  placeMath: () => null,
  plotFunction: () => null,
  requestCheck: () => {},
  requestSolve: () => {},
  escalate: () => {},
  dismissHint: () => {},
  clearMarks: () => {},
  retypeLine: () => {},
};

export function useLiveMath(_editor: Editor, _opts: UseLiveMathOptions): LiveController {
  return noop;
}
