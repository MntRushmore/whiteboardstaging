"use client";

import { useState } from "react";
import { useValue } from "tldraw";
import type { LiveLineState } from "@/lib/live/contracts";
import { liveDebugEnabled, liveDebugStore, type LiveDebugRecord } from "@/lib/live/liveDebug";
import { liveStore } from "@/lib/live/liveStore";
import { renderLatex } from "@/shapes/math/katex";

/**
 * Dev-only: what Mathpix was sent and what it said, line by line, next to what the local
 * engine made of it. For finding out WHERE a line went wrong — the pen, the recognizer, or
 * the maths — without guessing.
 */
export function LiveDebugPanel() {
  const [open, setOpen] = useState(false);
  const lines = useValue("debug lines", () => liveStore.lines.get(), []);
  const records = useValue("debug records", () => liveDebugStore.get(), []);
  if (!liveDebugEnabled()) return null;

  const ordered = Object.values(lines).sort((a, b) => a.line.column - b.line.column || a.line.row - b.line.row);

  return (
    <div className="pointer-events-auto fixed left-3 top-16 z-[1000] flex max-h-[75vh] flex-col items-start gap-2 font-sans">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 shadow-sm hover:bg-amber-100"
        aria-expanded={open}
      >
        {open ? "Hide" : "Mathpix"} · {ordered.length} line{ordered.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="w-[420px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-800 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          {ordered.length === 0 ? (
            <p className="p-2 text-slate-500">Write something on this screen.</p>
          ) : (
            ordered.map((st) => <LineCard key={st.line.id} state={st} record={records[st.line.id]} />)
          )}
        </div>
      )}
    </div>
  );
}

function LineCard({ state, record }: { state: LiveLineState; record: LiveDebugRecord | undefined }) {
  const raw = (record?.response.debug?.mathpix ?? record?.response.debug?.vision ?? null) as Record<string, unknown> | null;
  const a = state.analysis;
  return (
    <section className="mb-2 rounded-md border border-slate-200 p-2 last:mb-0 dark:border-slate-700">
      <header className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
        <span>
          col {state.line.column} · row {state.line.row}
        </span>
        <span>
          {record ? `${record.response.provider}${record.cached ? " (cached)" : ""} · ${Math.round(record.response.ms)} ms` : state.provider}
        </span>
      </header>

      <div className="flex gap-2">
        {record && <InkPreview sent={record.sent} />}
        <div className="min-w-0 flex-1">
          <div
            className="mb-1 overflow-x-auto text-base"
            // renderLatex never throws and escapes what it cannot render
            dangerouslySetInnerHTML={{ __html: renderLatex(state.latex) || "<span class='text-slate-400'>(nothing)</span>" }}
          />
          <Row k="latex" v={<code className="break-all">{state.latex || "—"}</code>} />
          {record && record.response.text !== state.latex && <Row k="text" v={<code className="break-all">{record.response.text}</code>} />}
          <Row k="confidence" v={<Confidence value={state.confidence} />} />
          {raw && typeof raw.is_handwritten === "boolean" && <Row k="handwritten" v={String(raw.is_handwritten)} />}
          {record && <Row k="recognize kind" v={record.response.kind} />}
        </div>
      </div>

      <div className="mt-1 border-t border-slate-100 pt-1 dark:border-slate-800">
        <Row k="engine kind" v={a?.kind ?? "—"} />
        <Row k="verdict" v={<Verdict v={a?.verdict} solved={a?.solved} />} />
        <Row k="as mathjs" v={<code className="break-all">{a?.math || "— (did not parse)"}</code>} />
        {a?.resultLatex ? <Row k="result" v={<code>{a.resultLatex}</code>} /> : null}
        {a?.variable ? <Row k="variable" v={a.variable} /> : null}
        {a?.solutions?.length ? <Row k="solutions" v={a.solutions.join(", ")} /> : null}
        {a?.note ? <Row k="note" v={a.note} /> : null}
      </div>

      {raw && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-slate-500">raw {record?.response.provider} response</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-50 p-1 text-[10px] leading-tight dark:bg-slate-800">
            {JSON.stringify(raw, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-2 leading-5">
      <span className="w-24 shrink-0 text-slate-500">{k}</span>
      <span className="min-w-0">{v}</span>
    </div>
  );
}

function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.8 ? "text-emerald-700" : value >= 0.6 ? "text-amber-700" : "text-red-700";
  return (
    <span className={tone}>
      {pct}%{value < 0.6 ? " (below 60%: Live stays silent)" : ""}
    </span>
  );
}

function Verdict({ v, solved }: { v: string | undefined; solved?: boolean }) {
  if (!v) return <>—</>;
  const tone = v === "ok" ? "text-emerald-700" : v === "mismatch" ? "text-amber-700" : "text-slate-600";
  return (
    <span className={tone}>
      {v}
      {solved ? " · solved" : ""}
    </span>
  );
}

/** The strokes exactly as Mathpix received them (normalized ints, y down). */
function InkPreview({ sent }: { sent: LiveDebugRecord["sent"] }) {
  const w = Math.max(1, sent.w);
  const h = Math.max(1, sent.h);
  return (
    <svg
      viewBox={`-4 -4 ${w + 8} ${h + 8}`}
      className="h-16 w-28 shrink-0 rounded border border-slate-200 bg-white dark:border-slate-700"
      aria-label="ink sent to the recognizer"
    >
      {sent.x.map((xs, i) => (
        <polyline
          key={i}
          fill="none"
          stroke="#0f172a"
          strokeWidth={Math.max(1.5, Math.max(w, h) / 60)}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={xs.map((x, j) => `${x},${sent.y[i][j]}`).join(" ")}
        />
      ))}
    </svg>
  );
}
