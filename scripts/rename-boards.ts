/**
 * One-off: smart names for boards made before smart names existed ("2 sin x = 1" → "Solving trig
 * equations"). New and edited boards are named by the board page (`useBoardAutoTitle`); this
 * catches the ones nobody has opened since.
 *
 *   JITI_ALIAS='{"@/":"<repo>/src/"}' npx jiti scripts/rename-boards.ts [--out plan.sql] [--limit N]
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (reads boards), OPENROUTER_API_KEY.
 *
 * It only READS: every board's title and snapshot, the maths on its first screen with any (the
 * chat's problems, then the typeset lines Live read), and a name from the same prompt and model
 * as POST /api/live/title. A board is renamed only when its title is one the namer may replace
 * (`replaceableTitles`: the default, or a first-line name of its own maths) — never a name the
 * student typed. It prints the plan and writes it as SQL to `--out`: one transaction, each update
 * conditional on the title it read, with the `updated_at` trigger off for it so no board jumps to
 * "Edited just now". Applying that SQL to production is a separate, deliberate step.
 */
import { writeFileSync } from "node:fs";
import { buildTitleMessages } from "@/lib/server/prompts/title";
import { cleanSmartTitle, replaceableTitles, titleContent } from "@/lib/boards/smartTitle";
import { CHAT_PROBLEM_META } from "@/lib/live/chat/cells";

const MODEL = "google/gemini-3.1-flash-lite";
const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "rename-boards.sql";
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const orKey = process.env.OPENROUTER_API_KEY;
if (!url || !key || !orKey) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and OPENROUTER_API_KEY");

type Rec = { typeName?: string; id?: string; type?: string; parentId?: string; index?: string; x?: number; y?: number; props?: { latex?: string }; meta?: Record<string, unknown> };

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key!, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** The records of a saved board (a TLEditorSnapshot or a bare TLStoreSnapshot). */
function recordsOf(data: unknown): Rec[] {
  const d = data as { document?: { store?: Record<string, Rec> }; store?: Record<string, Rec> } | null;
  return Object.values(d?.document?.store ?? d?.store ?? {});
}

/** The maths on the first screen that has any: the chat's problems, then the student's typeset lines. */
function contentOf(data: unknown): string[] {
  const records = recordsOf(data);
  const pages = records.filter((r) => r.typeName === "page").sort((a, b) => String(a.index).localeCompare(String(b.index)));
  for (const page of pages) {
    const shapes = records.filter((r) => r.typeName === "shape" && r.parentId === page.id);
    const problems: string[][] = [];
    const seen = new Set<string>();
    for (const s of shapes) {
      const p = s.meta?.[CHAT_PROBLEM_META] as { lines?: unknown } | undefined;
      const lines = Array.isArray(p?.lines) ? p.lines.filter((l): l is string => typeof l === "string" && l.length > 0) : [];
      if (lines.length > 0 && !seen.has(lines.join("\u0000"))) {
        seen.add(lines.join("\u0000"));
        problems.push(lines);
      }
    }
    // Live's echoes of the student's lines (the tutor's own typeset steps are `source: "ai"`)
    const echoes = shapes
      .filter((s) => s.type === "math" && s.props?.latex && s.meta?.source !== "ai")
      .sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))
      .map((s, row) => ({ id: s.id ?? String(row), latex: s.props!.latex!, column: 0, row }));
    const content = titleContent(echoes, problems);
    if (content.length > 0) return content;
  }
  return [];
}

async function nameFor(lines: string[]): Promise<string | null> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${orKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: buildTitleMessages(lines), max_tokens: 120, temperature: 0, response_format: { type: "json_object" } }),
  });
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content ?? "";
  try {
    return cleanSmartTitle((JSON.parse(text.replace(/^```(?:json)?|```$/g, "").trim()) as { title?: string | null }).title);
  } catch {
    return null;
  }
}

const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main(): Promise<void> {
  const boards = await rest<Array<{ id: string; title: string }>>("whiteboards?select=id,title&order=updated_at.desc");
  const plan: Array<{ id: string; from: string; to: string }> = [];
  const skipped = { named: 0, empty: 0, unnamed: 0 };
  for (const b of boards.slice(0, limit)) {
    const [row] = await rest<Array<{ data: unknown }>>(`whiteboards?select=data&id=eq.${b.id}`);
    const content = contentOf(row?.data);
    if (content.length === 0) {
      skipped.empty++;
      continue;
    }
    if (!replaceableTitles(content).includes(b.title)) {
      skipped.named++;
      continue;
    }
    const to = await nameFor(content);
    if (!to || to === b.title) {
      skipped.unnamed++;
      continue;
    }
    plan.push({ id: b.id, from: b.title, to });
    console.log(`${b.id}  ${JSON.stringify(b.title)}  ->  ${JSON.stringify(to)}`);
  }
  console.log(`\n${plan.length} to rename of ${Math.min(boards.length, limit)}; skipped: ${skipped.named} named by the student, ${skipped.empty} without maths, ${skipped.unnamed} with nothing better`);
  const body = plan.map((p) => `update public.whiteboards set title = ${sql(p.to)} where id = ${sql(p.id)} and title = ${sql(p.from)};`).join("\n");
  writeFileSync(
    out,
    `-- scripts/rename-boards.ts plan: ${plan.length} boards. updated_at is left as it was.\nbegin;\nalter table public.whiteboards disable trigger whiteboards_set_updated_at;\n${body}\nalter table public.whiteboards enable trigger whiteboards_set_updated_at;\ncommit;\n`,
  );
  console.log(`SQL written to ${out}`);
}

void main();
