"use client";

import type { LiveController } from "./contracts";

// STUB — WP-D replaces the bodies (keeps these exports and signatures; WP-E wires them
// into the OpenAI Realtime session in src/app/board/[id]/page.tsx).

/** Shape of a Realtime API function tool definition (session.update -> tools[]). */
export type RealtimeToolDef = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/** Tools the voice tutor can call to read/write the Live layer without an image round-trip. */
export const LIVE_VOICE_TOOLS: RealtimeToolDef[] = [];

export function isLiveVoiceTool(name: string): boolean {
  return LIVE_VOICE_TOOLS.some((t) => t.name === name);
}

/**
 * Executes a live voice tool and returns the JSON string to send back as
 * `function_call_output.output`. Never throws; errors are returned as { error }.
 */
export async function handleLiveVoiceTool(
  name: string,
  _args: Record<string, unknown>,
  _controller: LiveController,
): Promise<string> {
  return JSON.stringify({ error: `Unknown live tool: ${name}` });
}
