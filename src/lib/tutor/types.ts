export const TUTOR_LAYER_META = "tutorLayer" as const;

export const TUTOR_MODES = ["socratic", "solve", "feedback"] as const;
export type TutorMode = (typeof TUTOR_MODES)[number];

/** Board UI values. `suggest` is Socratic; `answer` is Solve. */
export type AssistanceMode = "off" | "feedback" | "suggest" | "answer";

export const MARK_KINDS = ["circle", "underline", "arrow", "note"] as const;
export type TutorMarkKind = (typeof MARK_KINDS)[number];

export type TutorMark = {
  kind: TutorMarkKind;
  pageId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
};

export type TutorResponse = {
  latex: string;
  confidence: number;
  mode: TutorMode;
  marks: TutorMark[];
};

export type ClusterBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type StrokeSample = {
  points: { x: number; y: number }[];
};

export type TutorRequest = {
  crop: string;
  nearbyText: string;
  strokes: StrokeSample[];
  mode: TutorMode;
  pageId: string;
  clusterBounds: ClusterBounds;
  instructions?: string;
};

/** Model output uses crop-normalized boxes (0–1) before we map to page space. */
export type NormalizedMark = {
  kind: TutorMarkKind;
  nx: number;
  ny: number;
  nw: number;
  nh: number;
  text?: string;
};

export const CONFIDENCE_THRESHOLD = 0.6;
export const TUTOR_DEBOUNCE_MS = 400;
export const CLUSTER_GAP_PX = 96;
export const CROP_PADDING_PX = 28;
export const CROP_MAX_EDGE = 512;

export function assistanceToTutorMode(mode: AssistanceMode): TutorMode | null {
  if (mode === "off") return null;
  if (mode === "suggest") return "socratic";
  if (mode === "answer") return "solve";
  return "feedback";
}
