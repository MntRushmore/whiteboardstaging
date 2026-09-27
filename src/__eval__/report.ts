/**
 * Markdown for the scoreboards (docs/eval/*.md). Built for the engineer fixing things: the
 * headline and per-topic rates first, then the failures grouped into patterns (fix one pattern,
 * move many problems), then every failure with the offending LaTeX, then the per-problem detail.
 */
import { STAGE_LABEL, STAGES, type Verdict } from "./judge";
import type { StageCounts, Summary } from "./offline";

export function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${((100 * n) / d).toFixed(0)}%`;
}

/** LaTeX in a table cell: a code span, pipes escaped. */
export function code(latex: string): string {
  if (!latex) return "";
  return "`" + latex.replace(/`/g, "ˋ").replace(/\|/g, "\\|").replace(/\n/g, " ") + "`";
}

export function cell(text: string): string {
  return (text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function problemCell(lines: readonly string[]): string {
  return lines.map(code).join(" ⏎ ");
}

export function table(head: string[], rows: string[][]): string {
  const out = [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
  for (const r of rows) out.push(`| ${r.join(" | ")} |`);
  return out.join("\n");
}

export function stageTable(s: StageCounts): string {
  const found = s.stages.local;
  return table(
    ["stage", "pass", "of all", "of those with a local solution"],
    STAGES.map((st) => [STAGE_LABEL[st], String(s.stages[st]), pct(s.stages[st], s.total), st === "local" ? "—" : pct(s.stages[st], found)]),
  );
}

export function topicTable(summary: Summary): string {
  return table(
    ["topic", "n", "pass", ...STAGES.map((s) => STAGE_LABEL[s])],
    summary.byTopic.map((t) => [t.topic, String(t.total), `**${t.passed}** (${pct(t.passed, t.total)})`, ...STAGES.map((s) => `${t.stages[s]}`)]),
  );
}

/** A failure's reason with its particulars blanked, so the same bug groups together. */
export function patternOf(v: Pick<Verdict, "topic">, f: Verdict["failures"][number]): string {
  if (f.stage === "local") return `no local solution — ${v.topic}`;
  const reason = f.reason
    .replace(/`[^`]*`/g, "`…`")
    .replace(/\{[^}]*\}|∅/g, "{…}")
    .replace(/\((?:x|y|[a-z]) = [^)]*\)/g, "(…)")
    .replace(/(?<![a-zA-Z\\])-?\d+(?:\.\d+)?/g, "N");
  return `${reason}`;
}

export interface Pattern {
  stage: string;
  pattern: string;
  ids: string[];
  example: string;
}

export function failurePatterns(verdicts: readonly Verdict[]): Pattern[] {
  const map = new Map<string, Pattern>();
  for (const v of verdicts) {
    const seen = new Set<string>();
    for (const f of v.failures) {
      const pattern = patternOf(v, f);
      const key = `${f.stage}|${pattern}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = map.get(key) ?? { stage: f.stage, pattern, ids: [], example: f.latex };
      p.ids.push(v.id);
      map.set(key, p);
    }
  }
  return [...map.values()].sort((a, b) => b.ids.length - a.ids.length || STAGES.indexOf(a.stage as never) - STAGES.indexOf(b.stage as never));
}

function patternTable(patterns: Pattern[]): string {
  return table(
    ["#", "stage", "pattern", "problems", "example"],
    patterns.map((p, i) => [String(i + 1), p.stage, cell(p.pattern), `${p.ids.length}: ${p.ids.join(", ")}`, code(p.example)]),
  );
}

function failureTable(verdicts: readonly Verdict[]): string {
  const rows: string[][] = [];
  for (const v of verdicts) {
    for (const f of v.failures) rows.push([v.id, v.topic, problemCell(v.lines), code(v.expected), f.stage, cell(f.reason), code(f.latex)]);
  }
  return table(["id", "topic", "problem", "expected", "stage", "what went wrong", "offending LaTeX"], rows);
}

export function detailBlock(v: Verdict, extra: string[] = []): string {
  const out = [`#### ${v.id} · ${v.topic}${v.pass ? " · pass" : ""}`, ""];
  out.push(`- problem: ${problemCell(v.lines)} → expected ${code(v.expected)}${v.note ? ` (${v.note})` : ""}`);
  out.push(...extra.map((e) => `- ${e}`));
  out.push(`- local path: ${v.source ?? "none (Solve would ask the model)"}`);
  out.push(`- answer: **${v.answer.status}**${v.answer.reason ? ` — ${v.answer.reason}` : ""}`);
  if (v.steps.length > 0) {
    out.push("- steps:");
    v.steps.forEach((s, i) => {
      const t = v.transitions[i];
      const mark = !t ? "" : t.status === "ok" ? "✓" : t.status === "broken" ? `✗ ${t.reason}` : `${t.status}${t.reason ? `: ${t.reason}` : ""}`;
      out.push(`  ${i + 1}. ${code(s)} ${mark}`);
    });
  }
  if (v.unsupported.length > 0) out.push(`- hand cannot draw: ${v.unsupported.map(code).join(" ")}`);
  if (v.words.length > 0) out.push(`- words: ${v.words.map((w) => `"${w}"`).join(", ")}`);
  if (v.warnings.length > 0) out.push(`- warnings: ${v.warnings.join("; ")}`);
  return out.join("\n");
}

export function answerTable(summary: Summary): string {
  const keys = Object.keys(summary.answers) as Array<keyof Summary["answers"]>;
  return table(keys as string[], [keys.map((k) => String(summary.answers[k]))]);
}

export function renderOfflineMarkdown(board: { verdicts: Verdict[]; summary: Summary }): string {
  const { verdicts, summary } = board;
  const failing = verdicts.filter((v) => !v.pass);
  const warned = verdicts.filter((v) => v.pass && v.warnings.length > 0);
  const patterns = failurePatterns(verdicts);
  return [
    "# Maths scoreboard — offline",
    "",
    "> Generated by `npm run eval:offline` (`src/__eval__/offline.test.ts`); do not edit by hand.",
    "> Each problem's LaTeX goes straight into `localSolve` (`src/lib/live/localSolve.ts`: the local",
    "> paths of Solve, in `LiveLoop.startSolve`'s order) and the result is judged semantically by",
    "> `src/__eval__/oracle.ts`. A problem passes when all five stages pass. Corpus: `src/__eval__/corpus.ts`.",
    "",
    `**${summary.passed} / ${summary.total} problems pass (${pct(summary.passed, summary.total)}).**`,
    "",
    "## Stages",
    "",
    stageTable(summary),
    "",
    "Answer verdicts (`approx`: a decimal or ≈ where a teacher writes the exact value; `form`: right value, wrong shape; `unsolved`: the last line is not an answer yet; `missing`: no local solution):",
    "",
    answerTable(summary),
    "",
    "## By topic",
    "",
    topicTable(summary),
    "",
    "## Failure patterns",
    "",
    "Grouped by stage and reason (numbers and LaTeX blanked), most frequent first. One problem can appear under several stages.",
    "",
    patternTable(patterns),
    "",
    "## Every failure",
    "",
    failureTable(failing),
    "",
    "## Detail of every failing problem",
    "",
    failing.map((v) => detailBlock(v)).join("\n\n"),
    "",
    "## Passing, with warnings",
    "",
    warned.length === 0 ? "None." : table(["id", "warnings"], warned.map((v) => [v.id, cell(v.warnings.join("; "))])),
    "",
    "## Passing",
    "",
    verdicts.filter((v) => v.pass).map((v) => v.id).join(", ") || "None.",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- handwriting

/** What the handwriting run needs from ./handwriting (kept structural: no import cycle). */
interface HandRunView {
  id: string;
  topic: string;
  variant: string;
  lines: Array<{ original: string; unsupported: string[]; clusters: number; recognized: string; confidence: number; read: string; error?: string }>;
  readOk: boolean;
  verdict: Verdict | null;
}

/** LaTeX tokens for a diff: commands and single characters; braces, spacing and sizing dropped. */
export function texTokens(latex: string): string[] {
  return (latex.match(/\\[a-zA-Z]+|\\.|[^\s{}]/g) ?? []).filter((t) => !["\\,", "\\ ", "\\;", "\\!", "\\left", "\\right", "~"].includes(t));
}

/** Multiset difference: what the reader dropped and what it put in instead. */
export function tokenDiff(original: string, read: string): { removed: string[]; added: string[] } {
  const left = texTokens(original);
  const added: string[] = [];
  for (const t of texTokens(read)) {
    const i = left.indexOf(t);
    if (i === -1) added.push(t);
    else left.splice(i, 1);
  }
  return { removed: left, added };
}

function diffKey(d: { removed: string[]; added: string[] }): string {
  const r = [...d.removed].sort().join(" ");
  const a = [...d.added].sort().join(" ");
  return `${r ? `− ${r}` : "−∅"}  ${a ? `+ ${a}` : "+∅"}`;
}

function readCounts(runs: readonly HandRunView[]) {
  const lines = runs.flatMap((r) => r.lines);
  const n = (read: string) => lines.filter((l) => l.read === read).length;
  const sent = lines.filter((l) => l.read !== "unwritable" && l.read !== "skipped").length;
  return {
    lines: lines.length,
    unwritable: n("unwritable"),
    skipped: n("skipped"),
    sent,
    split: lines.filter((l) => l.clusters > 1).length,
    exact: n("exact"),
    semantic: n("semantic"),
    wrong: n("wrong"),
    failed: n("failed"),
  };
}

function runStages(runs: readonly HandRunView[]) {
  const verdicts = runs.map((r) => r.verdict).filter((v): v is Verdict => v !== null);
  const stage = (s: (typeof STAGES)[number]) => verdicts.filter((v) => v.stages[s]).length;
  return {
    runs: runs.length,
    solved: verdicts.length,
    readOk: runs.filter((r) => r.readOk).length,
    stages: Object.fromEntries(STAGES.map((s) => [s, stage(s)])) as Record<(typeof STAGES)[number], number>,
    passed: verdicts.filter((v) => v.pass).length,
  };
}

type ReadItem = { r: HandRunView; l: HandRunView["lines"][number] };

function groupDiffs(items: readonly ReadItem[]): Array<[string, { ids: string[]; example: { original: string; read: string } }]> {
  const map = new Map<string, { ids: string[]; example: { original: string; read: string } }>();
  for (const { r, l } of items) {
    if (!l.recognized) continue;
    const key = diffKey(tokenDiff(l.original, l.recognized));
    const g = map.get(key) ?? { ids: [], example: { original: l.original, read: l.recognized } };
    g.ids.push(`${r.id}/${r.variant}`);
    map.set(key, g);
  }
  return [...map.entries()].sort((a, b) => b[1].ids.length - a[1].ids.length);
}

export function renderHandwritingMarkdown(input: {
  runs: readonly HandRunView[];
  offline: readonly Verdict[];
  budget: { calls: number; hits: number; remaining: number };
  variants: ReadonlyArray<{ name: string; slant: number; sx: number; sy: number; rotateDeg: number; jitter: number }>;
}): string {
  const { runs, offline, budget, variants } = input;
  const offlinePass = new Map(offline.map((v) => [v.id, v.pass]));
  const reads = readCounts(runs);
  const all = runStages(runs);
  const sent = reads.sent;

  const stageRows: string[][] = [
    ["hand can write the line", `${reads.lines - reads.unwritable} / ${reads.lines} lines`, pct(reads.lines - reads.unwritable, reads.lines)],
    ["clusters as ONE line", `${sent - reads.split} / ${sent} lines`, pct(sent - reads.split, sent)],
    ["Mathpix read it exactly", `${reads.exact} / ${sent} lines`, pct(reads.exact, sent)],
    ["… or as the same maths", `${reads.exact + reads.semantic} / ${sent} lines`, pct(reads.exact + reads.semantic, sent)],
    ["every line of the problem read right", `${all.readOk} / ${all.runs} runs`, pct(all.readOk, all.runs)],
    ...STAGES.map((s) => [`${STAGE_LABEL[s]} (on what Mathpix read)`, `${all.stages[s]} / ${all.runs} runs`, pct(all.stages[s], all.runs)]),
    ["**pass end to end**", `**${all.passed} / ${all.runs} runs**`, `**${pct(all.passed, all.runs)}**`],
  ];

  const topicRows = [...new Set(runs.map((r) => r.topic))].map((t) => {
    const rs = runs.filter((r) => r.topic === t);
    const s = runStages(rs);
    const rc = readCounts(rs);
    const ids = [...new Set(rs.map((r) => r.id))];
    const off = ids.filter((id) => offlinePass.get(id)).length;
    return [t, String(s.runs), `${rc.exact + rc.semantic}/${rc.sent}`, `${s.readOk}`, ...STAGES.map((st) => String(s.stages[st])), `**${s.passed}** (${pct(s.passed, s.runs)})`, `${off}/${ids.length} (${pct(off, ids.length)})`];
  });

  const variantRows = variants.map((v) => {
    const rs = runs.filter((r) => r.variant === v.name);
    const s = runStages(rs);
    const rc = readCounts(rs);
    const plain = v.slant === 0 && v.sx === 1 && v.sy === 1 && v.rotateDeg === 0 && v.jitter === 0;
    const ink = plain ? "as laid out" : `slant ${v.slant}, scale ${v.sx}×${v.sy}, rotate ${v.rotateDeg}°, wobble ${v.jitter}`;
    return [v.name, ink, `${rc.exact}/${rc.sent}`, `${rc.exact + rc.semantic}/${rc.sent}`, `${rc.split}`, `**${s.passed}/${s.runs}** (${pct(s.passed, s.runs)})`];
  });

  const wrongReads: ReadItem[] = runs.flatMap((r) => r.lines.filter((l) => l.read === "wrong" || l.read === "failed").map((l) => ({ r, l })));
  const semanticReads: ReadItem[] = runs.flatMap((r) => r.lines.filter((l) => l.read === "semantic").map((l) => ({ r, l })));

  // single-token changes counted across every misread line: the systematic ones float up
  const tokenCounts = new Map<string, number>();
  for (const { l } of wrongReads) {
    if (!l.recognized) continue;
    const d = tokenDiff(l.original, l.recognized);
    for (const t of new Set(d.removed)) tokenCounts.set(`dropped ${t}`, (tokenCounts.get(`dropped ${t}`) ?? 0) + 1);
    for (const t of new Set(d.added)) tokenCounts.set(`added ${t}`, (tokenCounts.get(`added ${t}`) ?? 0) + 1);
  }
  const topTokens = [...tokenCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

  const regressions = runs.filter((r) => offlinePass.get(r.id) && !r.verdict?.pass);
  const unwritable = new Map<string, { tokens: string[]; ids: Set<string> }>();
  for (const r of runs) {
    for (const l of r.lines) {
      if (l.read !== "unwritable") continue;
      const key = l.unsupported.join(" ");
      const g = unwritable.get(key) ?? { tokens: l.unsupported, ids: new Set<string>() };
      g.ids.add(r.id);
      unwritable.set(key, g);
    }
  }
  const splits = runs.flatMap((r) => r.lines.filter((l) => l.clusters > 1).map((l) => [r.id, r.variant, code(l.original), String(l.clusters), l.recognized ? code(l.recognized) : ""]));
  const readCell = (r: HandRunView) => r.lines.map((l) => (l.recognized ? code(l.recognized) : cell(`(${l.read})`))).join(" ⏎ ");

  return [
    "# Maths scoreboard — handwriting → Mathpix → Solve",
    "",
    "> Generated by `npm run eval:live` (`src/__eval__/handwriting.test.ts`; needs `RUN_LIVE_EVAL=1` and the Mathpix",
    "> keys); do not edit by hand. Every corpus line is written by the tutor's own hand (`layoutMath`), perturbed",
    "> per variant, clustered and normalized exactly as the board does (`clusterLines` → `buildPayload`), read by",
    "> Mathpix `v3/strokes` (`recognizeStrokes`, `auto_rotate_confidence_threshold: 1`), and what Mathpix READ goes",
    "> through the same `localSolve` + judge as `offline.md`. A run is one problem in one variant.",
    `> Mathpix this run: ${budget.calls} calls, ${budget.hits} answers from the on-disk cache (\`src/__eval__/.cache/\`, gitignored).`,
    "",
    `**${all.passed} / ${all.runs} runs pass end to end (${pct(all.passed, all.runs)}).** ${reads.exact + reads.semantic} of ${sent} lines sent were read as the maths written (${pct(reads.exact + reads.semantic, sent)}; ${reads.exact} character for character).`,
    "",
    "## Stages",
    "",
    table(["stage", "count", "rate"], stageRows),
    "",
    "## By variant",
    "",
    table(["variant", "ink", "read exactly", "read as the same maths", "lines split by the clusterer", "pass"], variantRows),
    "",
    "## By topic",
    "",
    table(["topic", "runs", "lines read right", "runs read right", ...STAGES.map((s) => STAGE_LABEL[s]), "pass", "offline pass (same problems)"], topicRows),
    "",
    "## What Mathpix gets wrong",
    "",
    "Tokens dropped / added, counted once per misread line (a systematic quirk shows up as a large count):",
    "",
    topTokens.length === 0 ? "None." : table(["token change", "lines"], topTokens.map(([k, n]) => [code(k), String(n)])),
    "",
    "Misreads grouped by the exact change (`−` written and lost, `+` what Mathpix put instead):",
    "",
    wrongReads.length === 0 ? "None." : table(["change", "runs", "example written", "example read"], groupDiffs(wrongReads).map(([k, g]) => [code(k), `${g.ids.length}: ${g.ids.join(", ")}`, code(g.example.original), code(g.example.read)])),
    "",
    "## Every misread line",
    "",
    wrongReads.length === 0
      ? "None."
      : table(
          ["id", "variant", "written", "Mathpix read", "confidence", "verdict"],
          wrongReads.map(({ r, l }) => [r.id, r.variant, code(l.original), l.recognized ? code(l.recognized) : cell(l.error ?? "(nothing)"), l.confidence ? l.confidence.toFixed(2) : "", l.read]),
        ),
    "",
    "## Read as the same maths, not character for character",
    "",
    "Harmless for the engine today (spacing, braces and `\\left`/`\\right` are already ignored), but worth knowing:",
    "",
    semanticReads.length === 0 ? "None." : table(["change", "runs", "example written", "example read"], groupDiffs(semanticReads).map(([k, g]) => [code(k), `${g.ids.length}: ${g.ids.join(", ")}`, code(g.example.original), code(g.example.read)])),
    "",
    "## Lines the board would split in two",
    "",
    "`clusterLines` made more than one line of a single written line; on the board each piece is recognized on its own. The eval still sends the whole line, so recognition is measured separately.",
    "",
    splits.length === 0 ? "None." : table(["id", "variant", "written", "clusters", "Mathpix read (whole line)"], splits),
    "",
    "## Lines the tutor's hand cannot write",
    "",
    unwritable.size === 0 ? "None." : table(["cannot draw", "problems"], [...unwritable.values()].map((g) => [g.tokens.map(code).join(" "), `${g.ids.size}: ${[...g.ids].join(", ")}`])),
    "",
    "## Pass offline, fail from handwriting",
    "",
    "What recognition costs: these solve from typed LaTeX but not from what Mathpix read.",
    "",
    regressions.length === 0
      ? "None."
      : table(
          ["id", "variant", "Mathpix read", "stage", "what went wrong"],
          regressions.map((r) => {
            const f = r.verdict?.failures[0];
            return [r.id, r.variant, readCell(r), f?.stage ?? "not sent", cell(f?.reason ?? r.lines.map((l) => l.read).join(", "))];
          }),
        ),
    "",
    "## Every failing run",
    "",
    table(
      ["id", "variant", "Mathpix read", "stage", "what went wrong", "offending LaTeX"],
      runs
        .filter((r) => !r.verdict?.pass)
        .flatMap((r) => {
          if (!r.verdict) return [[r.id, r.variant, readCell(r), "write/send", cell(r.lines.map((l) => (l.unsupported.length > 0 ? `hand cannot draw ${l.unsupported.join(" ")}` : l.read)).join("; ")), ""]];
          return r.verdict.failures.map((f) => [r.id, r.variant, readCell(r), f.stage, cell(f.reason), code(f.latex)]);
        }),
    ),
    "",
  ].join("\n");
}
