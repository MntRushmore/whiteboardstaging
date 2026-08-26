import type { Editor, TLPage } from "tldraw";
import { PROBLEM_COUNT, isProblemId } from "./types";

export const PAPER_BOUNDS = { x: 0, y: 0, w: 1024, h: 768 };

function problemIdFromPage(page: TLPage): number | null {
  const fromMeta = Number((page.meta as Record<string, unknown> | undefined)?.problemId);
  if (isProblemId(fromMeta)) return fromMeta;
  const fromName = Number(page.name);
  if (isProblemId(fromName)) return fromName;
  return null;
}

export function ensureProblemPages(editor: Editor): void {
  const pages = editor.getPages();
  const byProblem = new Map<number, TLPage>();

  for (const page of pages) {
    const id = problemIdFromPage(page);
    if (id != null && !byProblem.has(id)) byProblem.set(id, page);
  }

  if (!byProblem.has(1) && pages[0]) {
    byProblem.set(1, pages[0]);
    editor.updatePage({
      id: pages[0].id,
      name: "1",
      meta: { ...(pages[0].meta as object), problemId: 1 },
    });
  }

  for (let i = 1; i <= PROBLEM_COUNT; i++) {
    const existing = byProblem.get(i);
    if (existing) {
      const meta = (existing.meta ?? {}) as Record<string, unknown>;
      if (meta.problemId !== i || existing.name !== String(i)) {
        editor.updatePage({
          id: existing.id,
          name: String(i),
          meta: { ...meta, problemId: i },
        });
      }
      continue;
    }
    editor.createPage({
      name: String(i),
      meta: { problemId: i },
    });
  }
}

export function getPageProblemId(editor: Editor): number {
  const id = problemIdFromPage(editor.getCurrentPage());
  return id ?? 1;
}

export function goToProblemPage(editor: Editor, problemId: number): void {
  if (!isProblemId(problemId)) return;
  ensureProblemPages(editor);
  const page = editor.getPages().find((p) => problemIdFromPage(p) === problemId);
  if (!page) return;
  if (page.id !== editor.getCurrentPageId()) {
    editor.setCurrentPage(page.id);
  }
}

export function lockPaperCamera(editor: Editor): void {
  editor.setCameraOptions({
    isLocked: true,
    panSpeed: 0,
    zoomSpeed: 0,
    wheelBehavior: "none",
    zoomSteps: [1],
    constraints: {
      bounds: PAPER_BOUNDS,
      padding: { x: 32, y: 32 },
      origin: { x: 0.5, y: 0.5 },
      initialZoom: "fit-min-100",
      baseZoom: "fit-min-100",
      behavior: "contain",
    },
  });
  editor.setCamera({ x: 0, y: 0, z: 1 }, { immediate: true, force: true });
}
