"use client";

import { apiJson, isApiError } from "@/lib/api-client";
import type { FetchJson } from "../recognizeClient";
import { LISTEN_NOT_CONFIGURED, LectureResponseSchema, ListenTokenResponseSchema, type LectureRequest, type LectureResponse, type ListenTokenResponse } from "./contracts";

/**
 * Lecture mode's two calls, like the board chat's (`src/lib/live/chat/client.ts`): `apiJson` sends
 * the signed-in user's token and turns a failure into an `ApiError` (401, 402 `credits_exhausted`,
 * 429 with its `retryAfterMs`), and a 2xx that does not match the contract is an
 * `UnexpectedLectureResponse`, never guessed at.
 */

/** POST /api/live/lecture: recent transcript + the screen → what to sketch (usually nothing). */
export const LECTURE_PATH = "/api/live/lecture";
/** POST /api/live/lecture/token: a single-use token for one realtime speech-to-text session. */
export const LISTEN_TOKEN_PATH = "/api/live/lecture/token";

export class UnexpectedLectureResponse extends Error {
  constructor(what: string) {
    super(`The ${what} returned an unexpected response`);
    this.name = "UnexpectedLectureResponse";
  }
}

export async function requestLecture(req: LectureRequest, signal?: AbortSignal, fetchJson: FetchJson = apiJson as FetchJson): Promise<LectureResponse> {
  const parsed = LectureResponseSchema.safeParse(await fetchJson(LECTURE_PATH, req, { signal }));
  if (!parsed.success) throw new UnexpectedLectureResponse("lecture director");
  return parsed.data;
}

export async function requestListenToken(signal?: AbortSignal, fetchJson: FetchJson = apiJson as FetchJson): Promise<ListenTokenResponse> {
  const parsed = ListenTokenResponseSchema.safeParse(await fetchJson(LISTEN_TOKEN_PATH, undefined, { signal }));
  if (!parsed.success) throw new UnexpectedLectureResponse("speech token route");
  return parsed.data;
}

/** The token route's "no realtime recognizer here" (503 `listen_not_configured`): use the browser's own. */
export function isListenNotConfigured(err: unknown): boolean {
  return isApiError(err, LISTEN_NOT_CONFIGURED);
}
