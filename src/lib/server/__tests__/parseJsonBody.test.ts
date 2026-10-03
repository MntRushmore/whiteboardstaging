/**
 * parseJsonBody tells a body that never arrived (the client gave up on the request while it was on
 * its way: the Live clients' timeout, or a newer request for the same line) from one that is wrong.
 * Release QA 2026-10-03: the "invalid request body" warnings /api/live/recognize logged for valid
 * strokes were requests the client had already abandoned, while the dev server was compiling.
 */
import { describe, expect, it } from "vitest";
import { RecognizeRequestSchema } from "@/lib/live/contracts";
import { parseJsonBody } from "../request";

const VALID = {
  boardId: "9a69089c-e108-4db2-bd76-cec1c2909f6b",
  lineId: "ln_8cd717c8",
  strokes: { x: [[0, 80, 160]], y: [[0, 144, 0]] },
  bounds: { w: 160, h: 144 },
};

const post = (body: BodyInit, init: RequestInit = {}) =>
  new Request("http://localhost/api/live/recognize", { method: "POST", body, ...init, duplex: "half" } as RequestInit);

describe("parseJsonBody", () => {
  it("passes a valid body through", async () => {
    const out = await parseJsonBody(post(JSON.stringify(VALID)), RecognizeRequestSchema);
    expect("data" in out && out.data.lineId).toBe("ln_8cd717c8");
  });

  it("a body whose stream breaks off (the client went away) is 'unreadable', not a bad request", async () => {
    const half = JSON.stringify(VALID).slice(0, 40);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(half));
        c.error(new Error("aborted"));
      },
    });
    const out = await parseJsonBody(post(stream), RecognizeRequestSchema);
    expect("response" in out && out.failure).toBe("unreadable");
    if ("response" in out) expect(out.response.status).toBe(400);
  });

  it("a body cut short with the request aborted is 'unreadable' too", async () => {
    const ctrl = new AbortController();
    const req = post(JSON.stringify(VALID).slice(0, 40), { signal: ctrl.signal });
    ctrl.abort();
    const out = await parseJsonBody(req, RecognizeRequestSchema);
    expect("response" in out && out.failure).toBe("unreadable");
  });

  it("text that is not JSON is 'malformed'", async () => {
    const out = await parseJsonBody(post("{not json"), RecognizeRequestSchema);
    expect("response" in out && out.failure).toBe("malformed");
  });

  it("JSON the schema refuses is 'invalid', with where", async () => {
    const out = await parseJsonBody(post(JSON.stringify({ ...VALID, bounds: { w: 0, h: 10 } })), RecognizeRequestSchema);
    expect("response" in out && out.failure).toBe("invalid");
    if ("response" in out) {
      expect(out.issues?.map((i) => i.path)).toEqual(["bounds.w"]);
      const body = (await out.response.json()) as { error: { code: string } } | { code: string };
      expect(JSON.stringify(body)).toContain("invalid_request");
    }
  });
});
