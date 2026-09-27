/**
 * The reasons of a two-column geometry proof: a fixed, short vocabulary in the conventional US
 * high-school abbreviations. These are the ONLY words the tutor ever writes on the board, and only
 * in a proof's reason column (`docs/ARCHITECTURE.md`, "Proofs").
 *
 * `normalizeReason` reads what Mathpix returns for a student's reason — `\text{Given}`, `S A S`,
 * `\text{Vert. } \angle s \cong`, `\text{def of midpt}`, `\text{SAS} \cong`, `\mathrm{CPCTC}`,
 * `\text{reflexive prop}` — as one of these ids, or null when it is not a reason. Pure.
 */

export const REASONS = [
  "given",
  "reflexive",
  "symmetric",
  "transitive",
  "substitution",
  "sss",
  "sas",
  "asa",
  "aas",
  "hl",
  "cpctc",
  "vertical",
  "midpoint",
  "angleBisector",
  "segmentBisector",
  "perpendicular",
  "rightAngle",
  "rightAngles",
  "altInterior",
  "altExterior",
  "corresponding",
  "altInteriorConverse",
  "correspondingConverse",
  "isosceles",
  "isoscelesConverse",
  "thirdAngles",
  "linearPair",
  "congruence",
  "segmentAddition",
  "angleAddition",
  /** not postulates: always wrong as a reason for triangle congruence */
  "ssa",
  "aaa",
] as const;
export type ReasonId = (typeof REASONS)[number];

/**
 * How the tutor writes each reason (LaTeX for the hand: short words in `\text{}`, the symbols as
 * maths). Every entry is at most four words and 24 letters per `\text{}` group, the hand's limit.
 */
export const REASON_LATEX: Record<ReasonId, string> = {
  given: "\\text{Given}",
  reflexive: "\\text{Reflexive}",
  symmetric: "\\text{Symmetric}",
  transitive: "\\text{Transitive}",
  substitution: "\\text{Substitution}",
  sss: "\\text{SSS}",
  sas: "\\text{SAS}",
  asa: "\\text{ASA}",
  aas: "\\text{AAS}",
  hl: "\\text{HL}",
  cpctc: "\\text{CPCTC}",
  vertical: "\\text{Vertical } \\angle \\text{s}",
  midpoint: "\\text{Def. of midpoint}",
  angleBisector: "\\text{Def. of } \\angle \\text{ bisector}",
  segmentBisector: "\\text{Def. of seg. bisector}",
  perpendicular: "\\text{Def. of } \\perp",
  rightAngle: "\\text{Def. of rt. } \\angle",
  rightAngles: "\\text{Rt. } \\angle \\text{s} \\cong",
  altInterior: "\\text{Alt. int. } \\angle \\text{s}",
  altExterior: "\\text{Alt. ext. } \\angle \\text{s}",
  corresponding: "\\text{Corr. } \\angle \\text{s}",
  altInteriorConverse: "\\text{Conv. alt. int. } \\angle \\text{s}",
  correspondingConverse: "\\text{Conv. corr. } \\angle \\text{s}",
  isosceles: "\\text{Isos. } \\triangle \\text{ thm}",
  isoscelesConverse: "\\text{Conv. isos. } \\triangle \\text{ thm}",
  thirdAngles: "\\text{Third } \\angle \\text{s thm}",
  linearPair: "\\text{Linear pair}",
  congruence: "\\text{Def. of } \\cong",
  segmentAddition: "\\text{Seg. add.}",
  angleAddition: "\\angle \\text{ add.}",
  ssa: "\\text{SSA}",
  aaa: "\\text{AAA}",
};

/** The reason as plain text (reports, prompts): `Vertical ∠s`, `Def. of midpoint`. */
export const REASON_TEXT: Record<ReasonId, string> = {
  given: "Given",
  reflexive: "Reflexive",
  symmetric: "Symmetric",
  transitive: "Transitive",
  substitution: "Substitution",
  sss: "SSS",
  sas: "SAS",
  asa: "ASA",
  aas: "AAS",
  hl: "HL",
  cpctc: "CPCTC",
  vertical: "Vertical ∠s",
  midpoint: "Def. of midpoint",
  angleBisector: "Def. of ∠ bisector",
  segmentBisector: "Def. of seg. bisector",
  perpendicular: "Def. of ⊥",
  rightAngle: "Def. of rt. ∠",
  rightAngles: "Rt. ∠s ≅",
  altInterior: "Alt. int. ∠s",
  altExterior: "Alt. ext. ∠s",
  corresponding: "Corr. ∠s",
  altInteriorConverse: "Conv. alt. int. ∠s",
  correspondingConverse: "Conv. corr. ∠s",
  isosceles: "Isos. △ thm",
  isoscelesConverse: "Conv. isos. △ thm",
  thirdAngles: "Third ∠s thm",
  linearPair: "Linear pair",
  congruence: "Def. of ≅",
  segmentAddition: "Seg. add.",
  angleAddition: "∠ add.",
  ssa: "SSA",
  aaa: "AAA",
};

/** Reasons that prove two triangles congruent. */
export const POSTULATES: ReadonlySet<ReasonId> = new Set<ReasonId>(["sss", "sas", "asa", "aas", "hl"]);
/** Reasons that need the figure (which angles are vertical, alternate interior, …). */
export const FIGURE_REASONS: ReadonlySet<ReasonId> = new Set<ReasonId>([
  "vertical",
  "altInterior",
  "altExterior",
  "corresponding",
  "altInteriorConverse",
  "correspondingConverse",
  "linearPair",
  "segmentAddition",
  "angleAddition",
]);

/**
 * LaTeX (or plain text) → lowercase words: text groups opened, symbols named, spacing and braces
 * gone. `\text{Vert. } \angle s \cong` → `vert angles congruent`.
 */
export function reasonWords(latex: string): string {
  return latex
    .replace(/\\(?:text|textrm|textbf|textit|mathrm|mathbf|mathit|operatorname|mbox|textnormal)\s*\{([^{}]*)\}/g, " $1 ")
    .replace(/\\(?:left|right|quad|qquad|,|;|:|!)/g, " ")
    .replace(/\\angle\s*s\b/g, " angles ")
    .replace(/\\(?:angle|measuredangle)/g, " angle ")
    .replace(/∠\s*s\b/g, " angles ")
    .replace(/∠/g, " angle ")
    .replace(/\\(?:triangle|Delta|bigtriangleup)|△|Δ/g, " triangle ")
    .replace(/\\cong|≅|\\simeq|\\approxeq/g, " congruent ")
    .replace(/\\perp|⊥/g, " perpendicular ")
    .replace(/\\parallel|\\\||∥/g, " parallel ")
    .replace(/\\sim|∼/g, " similar ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}~^_]/g, " ")
    .replace(/[.:;,'’"()]/g, " ")
    .replace(/-/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** `SAS` written as three letters, `S A S`, or with its ≅: the postulates and their impostors. */
const POSTULATE_WORD: Record<string, ReasonId> = {
  sss: "sss",
  sas: "sas",
  asa: "asa",
  aas: "aas",
  saa: "aas",
  hl: "hl",
  ssa: "ssa",
  ass: "ssa",
  aaa: "aaa",
};

/** One regex per reason over the words squeezed together (`defofmidpoint`), tried in order. */
const RULES: ReadonlyArray<[RegExp, ReasonId | "bisector"]> = [
  [/^(cpctc|cpcfc|cpct|correspondingpartsof(congruent)?triangles(are)?(congruent)?|corrpartsof(congruent)?triangles)$/, "cpctc"],
  [/^given$/, "given"],
  [/^(reflexive|refl|reflex)(prop(erty)?)?(of(equality|congruence|congruent))?$|^(common|shared)(side|segment|seg|angle)$/, "reflexive"],
  [/^(symmetric|sym|symm)(prop(erty)?)?(of(equality|congruence|congruent))?$/, "symmetric"],
  [/^(transitive|trans)(prop(erty)?)?(of(equality|congruence|congruent))?$/, "transitive"],
  [/^(substitution|subst|sub)(prop(erty)?)?(of(equality|congruence))?$/, "substitution"],
  [/^(conv(erse)?(of)?)(alt(ernate)?int(erior)?)(angles?)?(thm|theorem|congruent)?$/, "altInteriorConverse"],
  [/^(conv(erse)?(of)?)(corr(esponding)?)(angles?)?(post(ulate)?|thm|theorem|congruent)?$/, "correspondingConverse"],
  [/^(conv(erse)?(of)?)(isos(celes)?|baseangles?)(triangle)?(thm|theorem)?$/, "isoscelesConverse"],
  [/^vert(ical)?(angles?)?(thm|theorem|congruent|arecongruent)*$|^vat$/, "vertical"],
  [/^(def(inition)?(of)?)?mid(point|pt)(def(inition)?|thm|theorem)?$/, "midpoint"],
  [/^(def(inition)?(of)?)?(angle|ang)bis(ector|ect)?(def(inition)?|thm|theorem)?$/, "angleBisector"],
  [/^(def(inition)?(of)?)?(seg(ment)?)bis(ector|ect)?(def(inition)?|thm|theorem)?$/, "segmentBisector"],
  [/^(def(inition)?(of)?)bis(ector|ect)?$/, "bisector"],
  [/^(def(inition)?(of)?)(perp(endicular)?)(lines?)?$|^perp(endicular)?lines?form(right|rt)angles?$/, "perpendicular"],
  [/^(def(inition)?(of)?)(right|rt)(angles?)$/, "rightAngle"],
  [/^(all)?(right|rt)angles?(are)?congruent(thm|theorem)?$|^(right|rt)anglescongruence(thm|theorem)?$|^(right|rt)angles?(thm|theorem)$/, "rightAngles"],
  [/^alt(ernate)?int(erior)?(angles?)?(thm|theorem|congruent)*$|^aia(t)?$/, "altInterior"],
  [/^alt(ernate)?ext(erior)?(angles?)?(thm|theorem|congruent)*$|^aea(t)?$/, "altExterior"],
  [/^corr(esponding)?(angles?)(post(ulate)?|thm|theorem|congruent)*$|^corrangles?$/, "corresponding"],
  [/^(isos(celes)?(triangle)?(thm|theorem)|baseangles?(thm|theorem|congruent)?|isos(celes)?triangle)$/, "isosceles"],
  [/^third(angles?)(thm|theorem)?$/, "thirdAngles"],
  [/^linearpair(post(ulate)?|thm|theorem)?$|^(angles?)formalinearpair$/, "linearPair"],
  [/^def(inition)?(of)?congruen(t|ce)(segments?|angles?|segs?)?$/, "congruence"],
  [/^seg(ment)?add(ition)?(post(ulate)?)?$/, "segmentAddition"],
  [/^angleadd(ition)?(post(ulate)?)?$/, "angleAddition"],
];

/**
 * A reason as the student wrote it → its id, or null when the text is not a reason. `bisector`
 * alone (`Def. of bisector`) is returned as `angleBisector` or `segmentBisector` by the caller
 * (`resolveBisector`), from what the statement is about.
 */
export function normalizeReason(latex: string): ReasonId | "bisector" | null {
  const words = reasonWords(latex);
  if (!words) return null;
  const compact = words.replace(/[^a-z]/g, "");
  if (!compact) return null;
  // a postulate: its letters, with "congruent", "post", "thm" or "≅" after it
  const post = /^(sss|sas|asa|aas|saa|hl|ssa|ass|aaa)(congruen(t|ce)|post(ulate)?|thm|theorem|triangle)*$/.exec(compact);
  if (post) return POSTULATE_WORD[post[1]];
  for (const [re, id] of RULES) if (re.test(compact)) return id;
  return null;
}

/** `Def. of bisector` about angles is the angle bisector's, about segments the segment bisector's. */
export function resolveBisector(id: ReasonId | "bisector" | null, aboutAngles: boolean): ReasonId | null {
  if (id === "bisector") return aboutAngles ? "angleBisector" : "segmentBisector";
  return id;
}

/** The reason as the tutor's hand writes it. */
export function reasonLatex(id: ReasonId): string {
  return REASON_LATEX[id];
}
