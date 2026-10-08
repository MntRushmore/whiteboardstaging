import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recognizeFailureHints } from "@/lib/server/recognizeHints";

describe("recognizeFailureHints (server side of the recognizer_failed 502)", () => {
  it("asks for a crop only when the request had none", () => {
    expect(recognizeFailureHints(false, null)).toEqual({ needsCrop: true });
    expect(recognizeFailureHints(true, null)).toEqual({});
  });

  it("says the recognizer is down only for a Mathpix credentials failure", () => {
    expect(recognizeFailureHints(true, { ok: false, reason: "auth", status: 401 })).toEqual({ recognizerDown: true });
    expect(recognizeFailureHints(false, { ok: false, reason: "auth", status: 403 })).toEqual({ needsCrop: true, recognizerDown: true });
    expect(recognizeFailureHints(true, { ok: false, reason: "api_error" })).not.toHaveProperty("recognizerDown");
    expect(recognizeFailureHints(true, { ok: false, reason: "timeout" })).not.toHaveProperty("recognizerDown");
  });

  it("says Mathpix answered but could not read the ink (api_error): unreadable, not an outage", () => {
    expect(recognizeFailureHints(false, { ok: false, reason: "api_error", status: 200, detail: "image_no_content" })).toEqual({ needsCrop: true, unreadable: true });
    expect(recognizeFailureHints(true, { ok: false, reason: "api_error" })).toEqual({ unreadable: true });
  });

  it("says a Mathpix timeout, network failure or error status is worth one more try", () => {
    for (const reason of ["timeout", "network", "http"] as const) {
      expect(recognizeFailureHints(false, { ok: false, reason })).toEqual({ needsCrop: true, transient: true });
    }
    expect(recognizeFailureHints(false, { ok: false, reason: "auth", status: 401 })).not.toHaveProperty("transient");
    expect(recognizeFailureHints(false, { ok: false, reason: "aborted" })).toEqual({ needsCrop: true });
  });

  it("is not exported from the route file (next dev type-checks a route's exports against handlers + config)", () => {
    const src = readFileSync(join(__dirname, "..", "..", "..", "app", "api", "live", "recognize", "route.ts"), "utf8");
    const exported = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1]).sort();
    expect(exported).toEqual(["GET", "POST", "dynamic", "maxDuration", "runtime"]);
  });
});
