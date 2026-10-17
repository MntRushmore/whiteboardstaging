/**
 * The native brain's golden results: every parity case (`cases.ts`) through the TypeScript brain
 * (`src/lib/brain`, the same functions the web board calls), one JSON line per case, written next
 * to the Swift package, whose tests run the same calls through `brain.js` in JavaScriptCore and
 * compare them exactly.
 *
 *   npm run brain:golden     rewrites ios/Packages/AgathonBrain/Tests/AgathonBrainTests/Resources/golden.ndjson
 *
 * Without BRAIN_GOLDEN_WRITE this test fails when the committed file is no longer what the sources
 * produce (the engine changed): run `npm run brain:build && npm run brain:golden` and commit both.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { call } from "@/lib/brain";
import { encode } from "@/lib/brain/json";
import { parityCases } from "./cases";

const GOLDEN = resolve(__dirname, "../../../ios/Packages/AgathonBrain/Tests/AgathonBrainTests/Resources/golden.ndjson");
const WRITE = process.env.BRAIN_GOLDEN_WRITE === "1";

/** One case per line: `args` and `result` are the exact JSON strings that cross the boundary. */
export function goldenLines(): string[] {
  return parityCases().map((c) => {
    const args = encode(c.args);
    return JSON.stringify({ name: c.name, method: c.method, args, result: call(c.method, args) });
  });
}

describe("brain golden", () => {
  it("every case has a unique name and a result", { timeout: 600_000 }, () => {
    const lines = goldenLines();
    const names = lines.map((l) => (JSON.parse(l) as { name: string }).name);
    expect(new Set(names).size).toBe(names.length);
    const failed = lines.map((l) => JSON.parse(l) as { name: string; result: string }).filter((c) => !c.name.startsWith("error/") && !JSON.parse(c.result).ok);
    expect(failed.map((c) => `${c.name}: ${c.result}`)).toEqual([]);
    const text = `${lines.join("\n")}\n`;
    if (WRITE) {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, text);
      return;
    }
    expect(existsSync(GOLDEN), "no golden file: run `npm run brain:golden`").toBe(true);
    const committed = readFileSync(GOLDEN, "utf8").split("\n");
    const fresh = text.split("\n");
    const stale = fresh.filter((l, i) => committed[i] !== l).map((l) => (l ? (JSON.parse(l) as { name: string }).name : "(end)"));
    expect(stale.slice(0, 10), "the brain's golden results are stale: run `npm run brain:golden` (and `npm run brain:build`)").toEqual([]);
    expect(committed.length).toBe(fresh.length);
  });
});
