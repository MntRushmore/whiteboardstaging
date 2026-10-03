"use client";

import { apiJson } from "@/lib/api-client";
import {
  RereadResponseSchema,
  SetupResponseSchema,
  type RereadRequest,
  type RereadResponse,
  type SetupRequest,
  type SetupResponse,
} from "./contracts";
import type { FetchJson } from "./recognizeClient";
import { TITLE_PATH, TitleResponseSchema, type TitleRequest, type TitleResponse } from "@/lib/boards/smartTitle";

/**
 * The two non-streaming Live model calls: POST /api/live/setup (a word problem's equations) and
 * POST /api/live/reread (the second reader). Plain JSON through `apiJson` (the Supabase token
 * attached, the error contract turned into `ApiError`), the reply validated with the shared zod
 * schema before the loop sees it.
 */

export const SETUP_PATH = "/api/live/setup";
export const REREAD_PATH = "/api/live/reread";

export interface CallOptions {
  signal?: AbortSignal;
}

export async function requestSetup(req: SetupRequest, opts: CallOptions = {}, fetchJson: FetchJson = apiJson as FetchJson): Promise<SetupResponse> {
  const parsed = SetupResponseSchema.safeParse(await fetchJson(SETUP_PATH, req, { signal: opts.signal }));
  if (!parsed.success) throw new Error("Setup returned an unexpected response");
  return parsed.data;
}

/** POST /api/live/title: a board's smart name (`src/lib/boards/smartTitle.ts`). */
export async function requestTitle(req: TitleRequest, opts: CallOptions = {}, fetchJson: FetchJson = apiJson as FetchJson): Promise<TitleResponse> {
  const parsed = TitleResponseSchema.safeParse(await fetchJson(TITLE_PATH, req, { signal: opts.signal }));
  if (!parsed.success) throw new Error("Title returned an unexpected response");
  return parsed.data;
}

export async function requestReread(req: RereadRequest, opts: CallOptions = {}, fetchJson: FetchJson = apiJson as FetchJson): Promise<RereadResponse> {
  const parsed = RereadResponseSchema.safeParse(await fetchJson(REREAD_PATH, req, { signal: opts.signal }));
  if (!parsed.success) throw new Error("Reread returned an unexpected response");
  return parsed.data;
}
