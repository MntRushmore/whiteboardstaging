import { describe, expect, it } from "vitest";
import { z } from "zod";
import { jsonlToEvents, repairJsonEscapes, sseFrame, sseResponse, stripCodeFences } from "@/lib/server/sse";
import { AnnotationSchema } from "@/lib/live/contracts";

async function* chunks(parts: string[]): AsyncGenerator<string> {
  for (const p of parts) yield p;
}

const ItemSchema = z.object({ id: z.number(), name: z.string() });

describe("jsonlToEvents", () => {
  it("reassembles lines split across chunks", async () => {
    const seen: Array<{ id: number; name: string }> = [];
    const result = await jsonlToEvents(
      chunks(['{"id":1,"na', 'me":"a"}\n{"id":2,', '"name":"b"}\n', '{"id":3,"name":"c"}']),
      ItemSchema,
      (item) => {
        seen.push(item);
      },
    );
    expect(seen).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 3, name: "c" },
    ]);
    expect(result).toEqual({ count: 3, invalid: 0 });
  });

  it("strips code fences and tolerates a trailing comma / array wrapper", async () => {
    const seen: number[] = [];
    const result = await jsonlToEvents(
      chunks(["```json\n", '{"id":1,"name":"a"},\n', "[\n", '{"id":2,"name":"b"}\n', "]\n```\n"]),
      ItemSchema,
      (item) => {
        seen.push(item.id);
      },
    );
    expect(seen).toEqual([1, 2]);
    expect(result).toEqual({ count: 2, invalid: 0 });
  });

  it("drops one invalid line (bad JSON or schema failure) and keeps going", async () => {
    const seen: number[] = [];
    const invalidLines: string[] = [];
    const result = await jsonlToEvents(
      chunks(['{"id":1,"name":"a"}\n', 'Sure! Here you go:\n', '{"id":"nope","name":"x"}\n', '{"id":3,"name":"c"}\n']),
      ItemSchema,
      (item) => {
        seen.push(item.id);
      },
      (line) => {
        invalidLines.push(line);
      },
    );
    expect(seen).toEqual([1, 3]);
    expect(result.count).toBe(2);
    expect(result.invalid).toBe(2);
    expect(invalidLines).toHaveLength(2);
  });

  it("stops early when onItem returns false", async () => {
    const seen: number[] = [];
    const result = await jsonlToEvents(
      chunks(['{"id":1,"name":"a"}\n{"id":2,"name":"b"}\n{"id":3,"name":"c"}\n']),
      ItemSchema,
      (item) => {
        seen.push(item.id);
        return seen.length < 2;
      },
    );
    expect(seen).toEqual([1, 2]);
    expect(result.count).toBe(2);
  });

  it("validates real annotations and applies schema defaults", async () => {
    const items: Array<z.infer<typeof AnnotationSchema>> = [];
    await jsonlToEvents(
      chunks([
        '{"lineId":"l3","verdict":"warn","kind":"arithmetic","message":"Look again at the right side of line 3","expected":"11-3"}\n',
      ]),
      AnnotationSchema,
      (a) => {
        items.push(a);
      },
    );
    expect(items).toHaveLength(1);
    expect(items[0].confidence).toBe(0.8);
    expect(items[0].expected).toBe("11-3");
  });
});

describe("repairJsonEscapes", () => {
  it("keeps single-backslash LaTeX commands intact through JSON.parse", () => {
    const raw = '{"latex":"\\boxed{x=4}","b":"\\frac{1}{2} \\times 3 \\neq \\rightarrow \\theta","c":"\\cdot \\left( \\sqrt{2} \\right) \\underline{u}"}';
    const parsed = JSON.parse(repairJsonEscapes(raw)) as Record<string, string>;
    expect(parsed.latex).toBe("\\boxed{x=4}");
    expect(parsed.b).toBe("\\frac{1}{2} \\times 3 \\neq \\rightarrow \\theta");
    expect(parsed.c).toBe("\\cdot \\left( \\sqrt{2} \\right) \\underline{u}");
  });

  it("leaves already-escaped JSON alone", () => {
    const raw = '{"latex":"\\\\frac{1}{2}","q":"say \\"hi\\"","u":"\\u00e9","nl":"a\\n b","slash":"a\\/b"}';
    expect(repairJsonEscapes(raw)).toBe(raw);
    const parsed = JSON.parse(repairJsonEscapes(raw)) as Record<string, string>;
    expect(parsed.latex).toBe("\\frac{1}{2}");
    expect(parsed.q).toBe('say "hi"');
    expect(parsed.u).toBe("é");
    expect(parsed.nl).toBe("a\n b");
  });

  it("is applied inside jsonlToEvents", async () => {
    const seen: string[] = [];
    await jsonlToEvents(chunks(['{"id":1,"name":"\\boxed{x=4}"}\n']), ItemSchema, (item) => {
      seen.push(item.name);
    });
    expect(seen).toEqual(["\\boxed{x=4}"]);
  });
});

describe("stripCodeFences / sseFrame", () => {
  it("removes fence markers only", () => {
    expect(stripCodeFences("```json")).toBe("");
    expect(stripCodeFences("```")).toBe("");
    expect(stripCodeFences('{"a":1}```')).toBe('{"a":1}');
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });

  it("formats an SSE frame", () => {
    expect(sseFrame("meta", { requestId: "r", model: "m" })).toBe('event: meta\ndata: {"requestId":"r","model":"m"}\n\n');
  });
});

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe("sseResponse", () => {
  it("sets event-stream headers and streams the emitted frames in order", async () => {
    const req = new Request("http://localhost/api/live/check", { method: "POST" });
    const res = sseResponse(req, async (emit) => {
      emit("meta", { requestId: "r1", model: "m" });
      await new Promise((r) => setTimeout(r, 5));
      emit("annotation", { lineId: "l1" });
      emit("done", { count: 1, ms: 5 });
    });
    expect(res.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
    const text = await readAll(res);
    expect(text).toBe(
      'event: meta\ndata: {"requestId":"r1","model":"m"}\n\n' +
        'event: annotation\ndata: {"lineId":"l1"}\n\n' +
        'event: done\ndata: {"count":1,"ms":5}\n\n',
    );
  });

  it("emits an error frame when run() throws", async () => {
    const req = new Request("http://localhost/x", { method: "POST" });
    const res = sseResponse(req, async (emit) => {
      emit("meta", { requestId: "r", model: "m" });
      throw new Error("boom");
    });
    const text = await readAll(res);
    expect(text).toContain("event: error");
    expect(text).toContain('"message":"boom"');
  });

  it("aborts the run signal when the client disconnects", async () => {
    const ac = new AbortController();
    const req = new Request("http://localhost/x", { method: "POST", signal: ac.signal });
    let aborted = false;
    const res = sseResponse(req, async (emit, signal) => {
      emit("meta", { requestId: "r", model: "m" });
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      aborted = signal.aborted;
    });
    setTimeout(() => ac.abort(), 10);
    const text = await readAll(res);
    expect(aborted).toBe(true);
    expect(text).toContain("event: meta");
    expect(text).not.toContain("event: error");
  });

  it("writes ping comments on the configured interval", async () => {
    const req = new Request("http://localhost/x", { method: "POST" });
    const res = sseResponse(
      req,
      async (emit) => {
        await new Promise((r) => setTimeout(r, 30));
        emit("done", { count: 0, ms: 30 });
      },
      { pingMs: 8 },
    );
    const text = await readAll(res);
    expect(text).toContain(": ping\n\n");
    expect(text.endsWith('event: done\ndata: {"count":0,"ms":30}\n\n')).toBe(true);
  });
});
