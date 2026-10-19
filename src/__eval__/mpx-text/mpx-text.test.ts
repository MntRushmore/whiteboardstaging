import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isMathpixConfigured } from "@/lib/server/mathpix";
import { loadEnvLocal } from "../handwriting";
import { ROOT } from "./corpus";
import { CallLedger, MAX_MATHPIX_CALLS, MAX_VISION_CALLS } from "./readers";
import { renderMpxMarkdown, type SheetRun } from "./report";
import { scoreSplit } from "./split";

/**
 * Would Mathpix v3/text (SuperNet-201) be a better crop reader than the recognize route's vision
 * fallback? Line crops made as an iPad makes them, read by both, judged by the scoreboard's judge
 * against the strokes reads already on disk; and five synthetic worksheets split into problems.
 * Spends Mathpix and OpenRouter calls (≤ 400 and ≤ 100, ever: `.cache/mpx-text/ledger.json`; every
 * answer cached, so a rerun is free), so it is skipped unless RUN_MPX_TEXT_EVAL=1.
 *
 *   npm run eval:mpx-text    RUN_MPX_TEXT_EVAL=1 EVAL_WRITE=1: runs it, writes docs/eval/mpx-supernet.{md,json}
 *
 * The canvas (`@napi-rs/canvas`, an optional dependency of pdfjs-dist) is imported only here, inside
 * the run, so CI never loads it.
 */
const RUN = process.env.RUN_MPX_TEXT_EVAL === "1";

describe.skipIf(!RUN)("eval: Mathpix v3/text as the crop reader (RUN_MPX_TEXT_EVAL=1)", () => {
  it(
    "reads the sample and the worksheets, and writes the report",
    async () => {
      const envFile = loadEnvLocal();
      expect(isMathpixConfigured(), `no Mathpix keys (looked for .env.local up from the repo root: ${envFile ?? "none found"})`).toBe(true);
      const { runSample } = await import("./run");
      const { buildWorksheets, PAGE_READERS, readPage } = await import("./worksheets");
      const ledger = new CallLedger();

      const run = await runSample(ledger);
      const sheets: SheetRun[] = [];
      for (const sheet of buildWorksheets()) {
        const reads: SheetRun["reads"] = [];
        for (const reader of PAGE_READERS) {
          const read = await readPage(sheet, reader, ledger);
          const pc = read.pageConfidence as SheetRun["reads"][number]["pageConfidence"] | undefined;
          reads.push({
            reader,
            ok: read.ok,
            error: read.error,
            ms: read.ms,
            score: read.ok ? scoreSplit(sheet, read) : null,
            pageConfidence: pc && typeof pc === "object" ? pc : null,
            regions: read.regions.length,
            regionTextConfidence: read.regions.filter((r) => typeof r.textConfidence === "number").length,
            regionLayoutConfidence: read.regions.filter((r) => typeof r.layoutConfidence === "number").length,
            handwritten: read.regions.filter((r) => r.handwritten).length,
            version: read.version,
          });
        }
        sheets.push({ name: sheet.name, photo: sheet.photo, problems: sheet.problems.length, reads });
      }

      expect(ledger.state.mathpixCalls).toBeLessThanOrEqual(MAX_MATHPIX_CALLS);
      expect(ledger.state.visionCalls).toBeLessThanOrEqual(MAX_VISION_CALLS);
      expect(run.results.filter((r) => r.text).length).toBe(run.results.length);
      console.log(`eval:mpx-text: ${run.results.length} lines, ledger ${JSON.stringify(ledger.state)}`);

      if (process.env.EVAL_WRITE === "1") {
        const dir = join(ROOT, "docs", "eval");
        mkdirSync(dir, { recursive: true });
        const md = join(dir, "mpx-supernet.md");
        const previous = existsSync(md) ? readFileSync(md, "utf8") : undefined;
        writeFileSync(md, renderMpxMarkdown({ run, sheets, ledger: ledger.state, date: new Date().toISOString().slice(0, 10), previous }));
        writeFileSync(
          join(dir, "mpx-supernet.json"),
          JSON.stringify(
            {
              ledger: ledger.state,
              corpus: { ...run.corpus, strokesReads: undefined },
              // the contours stay out: they only say where the one region of a crop is
              results: run.results.map((r) => ({ ...r, text: r.text && { ...r.text, regions: r.text.regions.map((g) => ({ ...g, cnt: undefined })) } })),
              sheets,
            },
            null,
            1,
          ) + "\n",
        );
      }
    },
    30 * 60_000,
  );
});
