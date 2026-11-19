/**
 * The NDJSON stream's keepalive (v1.0): a `{"type":"ping"}` line only after `pingMs` of silence,
 * none while lines flow, none once the stream is closed, and none at all unless asked for.
 */
import { describe, expect, it } from "vitest";
import { ndjsonResponse, PING_LINE } from "../ndjson";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lines(res: Response): Promise<string[]> {
  return (await res.text()).split("\n").filter(Boolean);
}

describe("ndjsonResponse pings", () => {
  it("pings through a silent stretch, then the run's last line ends it", async () => {
    const res = ndjsonResponse<{ type: string }>(new Request("http://x"), async (emit) => {
      emit({ type: "status" });
      await wait(130);
      emit({ type: "none" });
    }, {}, { pingMs: 30 });
    const out = await lines(res);
    expect(out[0]).toBe('{"type":"status"}');
    expect(out[out.length - 1]).toBe('{"type":"none"}');
    const pings = out.filter((l) => `${l}\n` === PING_LINE);
    expect(pings.length).toBeGreaterThanOrEqual(2);
    expect(pings.length).toBeLessThanOrEqual(5);
    expect(out.every((l) => JSON.parse(l))).toBe(true);
  });

  it("doesn't ping while lines keep coming", async () => {
    const res = ndjsonResponse<{ n: number }>(new Request("http://x"), async (emit) => {
      for (let n = 0; n < 8; n++) {
        emit({ n });
        await wait(10);
      }
    }, {}, { pingMs: 40 });
    expect((await lines(res)).filter((l) => l.includes("ping"))).toEqual([]);
  });

  it("never pings unless asked, and stops with the stream", async () => {
    const quiet = ndjsonResponse<{ type: string }>(new Request("http://x"), async (emit) => {
      await wait(60);
      emit({ type: "none" });
    });
    expect(await lines(quiet)).toEqual(['{"type":"none"}']);

    const res = ndjsonResponse<{ type: string }>(new Request("http://x"), async (emit) => emit({ type: "none" }), {}, { pingMs: 10 });
    const out = await lines(res);
    await wait(40);
    expect(out).toEqual(['{"type":"none"}']);
  });
});
