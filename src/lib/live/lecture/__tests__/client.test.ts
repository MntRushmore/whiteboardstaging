import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { isListenNotConfigured, LECTURE_PATH, LISTEN_TOKEN_PATH, requestLecture, requestListenToken, UnexpectedLectureResponse } from "../client";
import { LISTEN_NOT_CONFIGURED, type LectureRequest } from "../contracts";

const REQ: LectureRequest = { boardId: "b1", session: "sess_12345678", context: "", fresh: "GDP grew by four percent in 1920.", screen: { empty: true, topic: null, drawn: [], room: 1, active: [] }, recent: [], force: false };

describe("lecture client", () => {
  it("posts the request to the director with the signal, and parses the reply", async () => {
    const fetchJson = vi.fn(async () => ({ actions: [{ type: "heading", text: "The 1920s economy" }], charged: true, model: "m", ms: 12 }));
    const ctrl = new AbortController();
    const res = await requestLecture(REQ, ctrl.signal, fetchJson);
    expect(fetchJson).toHaveBeenCalledWith(LECTURE_PATH, REQ, { signal: ctrl.signal });
    expect(res).toEqual({ actions: [{ type: "heading", text: "The 1920s economy" }], notes: [], charged: true, model: "m", ms: 12 });
  });

  it("a reply that breaks the contract is refused, never guessed at", async () => {
    await expect(requestLecture(REQ, undefined, async () => ({ actions: [{ type: "paint", prompt: "a cat" }], model: "m", ms: 1 }))).rejects.toBeInstanceOf(UnexpectedLectureResponse);
    await expect(requestLecture(REQ, undefined, async () => ({ actions: [{ type: "heading", text: "$\\LaTeX$" }], model: "m", ms: 1 }))).rejects.toBeInstanceOf(UnexpectedLectureResponse);
  });

  it("the route's errors pass through as ApiError (402, 429 with its wait)", async () => {
    const err = new ApiError("x", 402, "credits_exhausted");
    await expect(
      requestLecture(REQ, undefined, async () => {
        throw err;
      }),
    ).rejects.toBe(err);
  });

  it("asks for a token with no body and checks it", async () => {
    const fetchJson = vi.fn(async () => ({ provider: "elevenlabs", token: "t", url: "wss://api.elevenlabs.io/v1/speech-to-text/realtime?token=t", expiresAt: 1 }));
    const tok = await requestListenToken(undefined, fetchJson);
    expect(fetchJson).toHaveBeenCalledWith(LISTEN_TOKEN_PATH, undefined, { signal: undefined });
    expect(tok.token).toBe("t");
    await expect(requestListenToken(undefined, async () => ({ provider: "other", token: "t" }))).rejects.toBeInstanceOf(UnexpectedLectureResponse);
  });

  it("recognizes the token route's 'not configured'", () => {
    expect(isListenNotConfigured(new ApiError("x", 503, LISTEN_NOT_CONFIGURED))).toBe(true);
    expect(isListenNotConfigured(new ApiError("x", 503, "feature_unavailable"))).toBe(false);
    expect(isListenNotConfigured(new Error(LISTEN_NOT_CONFIGURED))).toBe(false);
  });
});
