import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_EMBED_DEFINITIONS } from "tldraw";
import { describe, expect, it } from "vitest";
import { BOARD_EMBEDS } from "@/lib/boards/embeds";

const ROOT = path.resolve(__dirname, "../../../..");

describe("board embeds (security audit, 2026-10-03)", () => {
  it("drop the GitHub Gist, whose srcdoc frame tldraw leaves unsandboxed in our origin", () => {
    expect(DEFAULT_EMBED_DEFINITIONS.some((d) => d.type === "github_gist")).toBe(true);
    expect(BOARD_EMBEDS.some((d) => d.type === "github_gist")).toBe(false);
  });

  it("keep every other default embed", () => {
    expect(BOARD_EMBEDS.map((d) => d.type)).toEqual(DEFAULT_EMBED_DEFINITIONS.map((d) => d.type).filter((t) => t !== "github_gist"));
  });

  it("every <Tldraw> mount passes them (tldraw's default list includes the gist)", () => {
    for (const file of ["src/app/board/[id]/page.tsx", "src/app/train/page.tsx"]) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      const mounts = source
        .split("<Tldraw\n")
        .slice(1)
        .map((after) => after.slice(0, after.indexOf("\n      >")));
      expect(mounts.length, file).toBeGreaterThan(0);
      for (const props of mounts) expect(props, file).toContain("embeds={BOARD_EMBEDS}");
    }
  });
});
