/**
 * Load the checked-in bank (data/sat/bank.json) into `sat_questions`, idempotently.
 *
 *   JITI_ALIAS='{"@/":"<repo>/src/"}' npx jiti scripts/sat/upsert.ts [--dry-run]
 *   JITI_ALIAS='{"@/":"<repo>/src/"}' npx jiti scripts/sat/upsert.ts --sql out.sql   (no database: writes SQL)
 *
 * `--sql` writes the same load as one idempotent SQL transaction (for production at deploy time, by
 * the owner: psql or the SQL editor). It touches no database itself.
 *
 * LOCAL ONLY: it refuses any NEXT_PUBLIC_SUPABASE_URL that is not this machine (loading production
 * is the owner's separate, deliberate step: docs/SAT-MODE.md). Service role (SUPABASE_SERVICE_ROLE_KEY,
 * or the local stack's from `npx supabase status`).
 *
 *  - ids never change: a row is matched by `id` and upserted;
 *  - `version` goes up by one only when the question's content changed (stem, figure, choices,
 *    answer, solution, nudge, common_wrong, domain, skill, difficulty, format); a rerun with nothing
 *    changed writes nothing;
 *  - `status` comes from the file (`live` or `draft`), and every question is checked again here
 *    (questionIssues): a `live` row that fails a check is loaded as `draft`;
 *  - the v2 notes (docs/SAT-V2.md: nudge, choices[].why, common_wrong, solution.desmos_steps) are
 *    checked again too (dropFailingNotes): a note that fails is left out, and the question keeps
 *    its status. A note no longer in the file is cleared (nudge and common_wrong are written as null);
 *  - a row in the table that is no longer in the file is set `retired` (never deleted: students'
 *    answers point at it).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { SatQuestion } from "../../src/lib/sat/contracts";
import { dropFailingNotes, questionIssues } from "../../src/lib/sat/lint";
import { isLoopbackUrl, loadDotEnvLocal, resolveSupabaseEnv } from "../lib/supabaseHttp.mjs";

const ROOT = resolve(__dirname, "..", "..");

type DbRow = Pick<SatQuestion, "id" | "domain" | "skill" | "difficulty" | "format" | "stem" | "figure" | "choices" | "answer" | "solution" | "status" | "version"> & {
  nudge: string | null;
  common_wrong: SatQuestion["common_wrong"] | null;
};

/** The row as loaded: notes that fail a check left out, status checked again. */
export function loadRow(q: SatQuestion): { row: DbRow; demoted: boolean; dropped: string[] } {
  const { q: clean, dropped } = dropFailingNotes(q);
  const demoted = clean.status === "live" && questionIssues(clean).length > 0;
  const row: DbRow = {
    id: clean.id,
    domain: clean.domain,
    skill: clean.skill,
    difficulty: clean.difficulty,
    format: clean.format,
    stem: clean.stem,
    figure: clean.figure,
    choices: clean.choices,
    answer: clean.answer,
    solution: clean.solution,
    nudge: clean.nudge ?? null,
    common_wrong: clean.common_wrong ?? null,
    status: demoted ? "draft" : clean.status,
    version: 1,
  };
  return { row, demoted, dropped };
}

/** Content that makes a new version (status does not). Keys sorted so jsonb's key order does not matter. */
export function contentHash(q: Omit<DbRow, "status" | "version" | "nudge" | "common_wrong"> & { nudge?: string | null; common_wrong?: unknown }): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v;
  const { id, domain, skill, difficulty, format, stem, figure, choices, answer, solution } = q;
  const nudge = q.nudge ?? null;
  const common_wrong = q.common_wrong ?? null;
  return createHash("sha1").update(JSON.stringify(sort({ id, domain, skill, difficulty, format, stem, figure, choices, answer, solution, nudge, common_wrong }))).digest("hex");
}

/** What to write: rows to upsert (with their version) and ids to retire. Pure, for the tests. */
export function planUpsert(
  bank: readonly SatQuestion[],
  existing: ReadonlyArray<Omit<DbRow, "nudge" | "common_wrong"> & { nudge?: string | null; common_wrong?: unknown }>,
): { upsert: DbRow[]; retire: string[]; unchanged: number; demoted: string[]; droppedNotes: Record<string, string[]> } {
  const byId = new Map(existing.map((r) => [r.id, r]));
  const upsert: DbRow[] = [];
  const demoted: string[] = [];
  const droppedNotes: Record<string, string[]> = {};
  let unchanged = 0;
  for (const q of bank) {
    const loaded = loadRow(q);
    const row = loaded.row;
    if (loaded.demoted) demoted.push(q.id);
    if (loaded.dropped.length) droppedNotes[q.id] = loaded.dropped;
    const old = byId.get(q.id);
    if (old) {
      const changed = contentHash(old) !== contentHash(row);
      row.version = changed ? old.version + 1 : old.version;
      if (!changed && old.status === row.status) {
        unchanged++;
        continue;
      }
    }
    upsert.push(row);
  }
  const ids = new Set(bank.map((q) => q.id));
  const retire = existing.filter((r) => !ids.has(r.id) && r.status !== "retired").map((r) => r.id);
  return { upsert, retire, unchanged, demoted, droppedNotes };
}

const lit = (v: unknown) => (v === null || v === undefined ? "null" : `'${String(typeof v === "string" ? v : JSON.stringify(v)).replace(/'/g, "''")}'`);

/**
 * The bank as one idempotent SQL load: insert each row, or update it when its content or status
 * changed (the version goes up only when the content did); rows no longer in the bank are retired.
 */
export function bankSql(bank: readonly SatQuestion[]): string {
  const lines = ["begin;"];
  const cols = "domain, skill, difficulty, format, stem, figure, choices, answer, solution, nudge, common_wrong";
  const content = (t: string) => cols.split(", ").map((c) => `${t}.${c}`).join(", ");
  for (const q of bank) {
    const { row } = loadRow(q);
    lines.push(
      `insert into public.sat_questions as t (id, ${cols}, status, version) values (` +
        [lit(row.id), lit(row.domain), lit(row.skill), row.difficulty, lit(row.format), lit(row.stem), `${lit(row.figure)}::jsonb`, `${lit(row.choices)}::jsonb`, `${lit(row.answer)}::jsonb`, `${lit(row.solution)}::jsonb`, lit(row.nudge), `${lit(row.common_wrong)}::jsonb`, lit(row.status), 1].join(", ") +
        `) on conflict (id) do update set ${cols.split(", ").map((c) => `${c} = excluded.${c}`).join(", ")}, status = excluded.status,` +
        ` version = t.version + case when (${content("t")}) is distinct from (${content("excluded")}) then 1 else 0 end` +
        ` where (${content("t")}, t.status) is distinct from (${content("excluded")}, excluded.status);`,
    );
  }
  lines.push(`update public.sat_questions set status = 'retired' where status <> 'retired' and id <> all (array[${bank.map((q) => lit(q.id)).join(", ")}]::text[]);`);
  lines.push("commit;");
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const sqlOut = process.argv.includes("--sql") ? process.argv[process.argv.indexOf("--sql") + 1] : null;
  if (sqlOut) {
    const bank = JSON.parse(readFileSync(join(ROOT, "data", "sat", "bank.json"), "utf8")) as SatQuestion[];
    writeFileSync(sqlOut, bankSql(bank));
    console.log(`wrote ${sqlOut}: ${bank.length} questions (${bank.filter((q) => q.status === "live").length} live)`);
    return;
  }
  loadDotEnvLocal(ROOT);
  const { url, serviceKey } = resolveSupabaseEnv(process.env);
  if (!url || !serviceKey) throw new Error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or a running local stack).");
  if (!isLoopbackUrl(url)) throw new Error(`Refusing ${new URL(url).host}: this script loads the LOCAL database only.`);
  const dry = process.argv.includes("--dry-run");
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const rest = `${url.replace(/\/$/, "")}/rest/v1/sat_questions`;

  const bank = JSON.parse(readFileSync(join(ROOT, "data", "sat", "bank.json"), "utf8")) as SatQuestion[];
  const existing: DbRow[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${rest}?select=id,domain,skill,difficulty,format,stem,figure,choices,answer,solution,nudge,common_wrong,status,version&order=id`, { headers: { ...headers, Range: `${from}-${from + 999}` } });
    if (!res.ok) throw new Error(`read sat_questions: ${res.status} ${await res.text()}`);
    const page = (await res.json()) as DbRow[];
    existing.push(...page);
    if (page.length < 1000) break;
  }
  const plan = planUpsert(bank, existing);
  console.log(`bank ${bank.length} (${bank.filter((q) => q.status === "live").length} live); table ${existing.length}: ${plan.upsert.length} to write, ${plan.unchanged} unchanged, ${plan.retire.length} to retire${plan.demoted.length ? `, ${plan.demoted.length} live rows failing a check loaded as draft: ${plan.demoted.join(", ")}` : ""}${Object.keys(plan.droppedNotes).length ? `; notes left out (failed a check): ${Object.entries(plan.droppedNotes).map(([id, d]) => `${id} (${d.join(", ")})`).join(", ")}` : ""}`);
  if (dry) return;
  for (let i = 0; i < plan.upsert.length; i += 200) {
    const res = await fetch(`${rest}?on_conflict=id`, { method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(plan.upsert.slice(i, i + 200)) });
    if (!res.ok) throw new Error(`upsert: ${res.status} ${await res.text()}`);
  }
  for (const id of plan.retire) {
    const res = await fetch(`${rest}?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: "retired" }) });
    if (!res.ok) throw new Error(`retire ${id}: ${res.status} ${await res.text()}`);
  }
  console.log("done");
}

if (process.argv[1]?.endsWith("upsert.ts")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
