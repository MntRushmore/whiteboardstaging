"use client";

import { apiJson, isApiError } from "@/lib/api-client";
import type { FetchJson } from "../recognizeClient";
import {
  LISTEN_NOT_CONFIGURED,
  LectureResponseSchema,
  ListenTokenResponseSchema,
  SketchResponseSchema,
  type LectureRequest,
  type LectureResponse,
  type ListenTokenResponse,
  type SketchRequest,
  type SketchResponse,
} from "./contracts";

/**
 * Lecture mode's three calls, like the board chat's (`src/lib/live/chat/client.ts`): `apiJson` sends
 * the signed-in user's token and turns a failure into an `ApiError` (401, 402 `ink_empty`,
 * 429 with its `retryAfterMs`), and a 2xx that does not match the contract is an
 * `UnexpectedLectureResponse`, never guessed at.
 */

/** POST /api/live/lecture: recent transcript + the screen → what to sketch (usually nothing). */
export const LECTURE_PATH = "/api/live/lecture";
/** POST /api/live/lecture/token: a single-use token for one realtime speech-to-text session. */
export const LISTEN_TOKEN_PATH = "/api/live/lecture/token";
/** POST /api/live/lecture/sketch: one panel of a sketch, drawn by the illustrator as vector strokes. */
export const LECTURE_SKETCH_PATH = "/api/live/lecture/sketch";

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

/**
 * One panel drawn (`SketchRequest` → `SketchDrawing`), checked against the contract here too: the
 * desk turns it into ink as it is, so a drawing that does not parse is refused, never drawn.
 */
export async function requestLectureSketch(req: SketchRequest, signal?: AbortSignal, fetchJson: FetchJson = apiJson as FetchJson): Promise<SketchResponse> {
  const parsed = SketchResponseSchema.safeParse(await fetchJson(LECTURE_SKETCH_PATH, req, { signal }));
  if (!parsed.success) throw new UnexpectedLectureResponse("illustrator");
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
