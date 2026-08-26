export const TUTOR_LAYER_META = "tutorLayer" as const;
export const PROBLEM_META = "problemId" as const;
export const TUTOR_DIAGRAM_META = "tutorDiagram" as const;
export const TUTOR_PENDING_META = "tutorPending" as const;

export function isPendingTutorMeta(meta: Record<string, unknown> | undefined): boolean {
  return meta?.[TUTOR_LAYER_META] === true && meta?.[TUTOR_PENDING_META] === true;
}

export const PROBLEM_COUNT = 12;

export const TUTOR_MODES = ["socratic", "solve", "feedback"] as const;
export type TutorMode = (typeof TUTOR_MODES)[number];

/** Board UI values. `suggest` is Socratic; `answer` is Solve. */
export type AssistanceMode = "off" | "feedback" | "suggest" | "answer";

export const MARK_KINDS = ["circle", "underline", "arrow", "note", "caret"] as const;
export type TutorMarkKind = (typeof MARK_KINDS)[number];

export type ClusterBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Locked request body for POST /api/tutor. */
export type TutorRequest = {
  problemId: number;
  latex: string;
  bbox: ClusterBounds;
};

export type TutorMark = {
  kind: TutorMarkKind;
  pageId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  problemId: number;
  latex: string;
  bbox: ClusterBounds;
};

export type TutorResponse = {
  problemId: number;
  latex: string;
  bbox: ClusterBounds;
  confidence: number;
  mode: TutorMode;
  marks: TutorMark[];
};

export type ProblemRecord = {
  id: number;
  unlocked: boolean;
  finished: boolean;
  latex: string;
  bbox: ClusterBounds | null;
  subject: ProblemSubject;
  title: string;
  socratic: string;
  diagram?: string;
};

/** Model output uses bbox-normalized boxes (0–1) before we map to page space. */
export type NormalizedMark = {
  kind: TutorMarkKind;
  nx: number;
  ny: number;
  nw: number;
  nh: number;
  text?: string;
};

export type StrokeSample = {
  points: { x: number; y: number }[];
};

export const CONFIDENCE_THRESHOLD = 0.6;
/** First mark ~2s after pen-up. Never a generated page. */
export const TUTOR_DEBOUNCE_MS = 2000;
export const DEFAULT_ASSISTANCE_MODE: AssistanceMode = "suggest";

/** OpenRouter Flash on recognized LaTeX. Backup is GPT-4.1-mini. */
export const TUTOR_FLASH_MODEL = "google/gemini-2.5-flash";
export const TUTOR_BACKUP_MODEL = "openai/gpt-4.1-mini";

export type ProblemSubject = "algebra" | "calculus" | "geometry";
export const CLUSTER_GAP_PX = 96;
export const CROP_PADDING_PX = 28;

export function assistanceToTutorMode(mode: AssistanceMode): TutorMode | null {
  if (mode === "off") return null;
  if (mode === "suggest") return "socratic";
  if (mode === "answer") return "solve";
  return "feedback";
}

export function isProblemId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= PROBLEM_COUNT;
}
