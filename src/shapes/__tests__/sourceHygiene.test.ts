import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A raw NUL byte once slipped into GraphShapeUtil.tsx (used as a join separator), which made
 * git and grep treat the file as binary. Source must stay plain text: escape control characters.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

// every C0 control character except tab (0x09), LF (0x0A) and CR (0x0D)
const CONTROL_BYTE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

describe("source hygiene", () => {
  it("shape and engine sources contain no control bytes", () => {
    const roots = [join(__dirname, ".."), join(__dirname, "..", "..", "lib", "live", "engine")];
    const files = roots.flatMap((r) => walk(r));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      const bad = CONTROL_BYTE.exec(text);
      expect(bad, `${f} has control byte ${bad ? JSON.stringify(bad[0]) : ""}`).toBeNull();
    }
  });
});
