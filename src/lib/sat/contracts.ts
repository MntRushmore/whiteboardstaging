import { z } from "zod";

/**
 * SAT mode's shared contract (docs/SAT-MODE.md): the bank's rows as the iPad reads them, the
 * figure kinds it draws natively, the four domains and their skills, and the routes' requests and
 * answers. The server routes (src/app/api/sat/*), the bank's pipeline (scripts/sat) and the tests
 * all read these; the iPad mirrors them in Swift. Changing a shape here is changing the contract.
 */

// ------------------------------------------------------------------ domains and skills

export const SAT_DOMAINS = ["algebra", "advanced_math", "psda", "geometry_trig"] as const;
export type SatDomain = (typeof SAT_DOMAINS)[number];

/**
 * Each domain's skills, named exactly as docs/SAT-MODE.md writes them (that is the `skill` column),
 * with the slug the question ids use (`<domain>-<slug>-<nnnn>`). The same pairs are a CHECK in
 * 20261022000000_sat_mode.sql (sat_questions_skill_known): a new skill needs both.
 */
export const SAT_SKILLS = {
  algebra: [
    { name: "linear equations in one variable", slug: "linear-one-var" },
    { name: "linear equations in two variables", slug: "linear-two-var" },
    { name: "linear functions", slug: "linear-functions" },
    { name: "systems of two linear equations", slug: "linear-systems" },
    { name: "linear inequalities", slug: "linear-inequalities" },
  ],
  advanced_math: [
    { name: "equivalent expressions", slug: "equivalent-expressions" },
    { name: "nonlinear equations and systems", slug: "nonlinear-equations" },
    { name: "nonlinear functions", slug: "nonlinear-functions" },
  ],
  psda: [
    { name: "ratios, rates, proportions, units", slug: "ratios-rates" },
    { name: "percentages", slug: "percentages" },
    { name: "one-variable data (distributions, centre, spread)", slug: "one-var-data" },
    { name: "two-variable data (models, scatterplots)", slug: "two-var-data" },
    { name: "probability", slug: "probability" },
    { name: "inference from samples and margin of error", slug: "inference" },
    { name: "evaluating statistical claims", slug: "statistical-claims" },
  ],
  geometry_trig: [
    { name: "area and volume", slug: "area-volume" },
    { name: "lines, angles, triangles", slug: "lines-angles-triangles" },
    { name: "right triangles and trigonometry", slug: "right-triangles-trig" },
    { name: "circles", slug: "circles" },
  ],
} as const satisfies Record<SatDomain, ReadonlyArray<{ name: string; slug: string }>>;

export type SatSkill = (typeof SAT_SKILLS)[SatDomain][number]["name"];

/** Every skill name, in table order. */
export const SAT_SKILL_NAMES: readonly SatSkill[] = SAT_DOMAINS.flatMap((d) => SAT_SKILLS[d].map((s) => s.name));

/** The domain a skill belongs to, or null for a name that is not one of the table's. */
export function domainOfSkill(skill: string): SatDomain | null {
  for (const d of SAT_DOMAINS) if (SAT_SKILLS[d].some((s) => s.name === skill)) return d;
  return null;
}

/** The id slug of a skill, or null. */
export function skillSlug(skill: string): string | null {
  for (const d of SAT_DOMAINS) {
    const hit = SAT_SKILLS[d].find((s) => s.name === skill);
    if (hit) return hit.slug;
  }
  return null;
}

/** The real section's mix, about 35/35/15/15 (the bank's plan and "Practice 10" both follow it). */
export const SAT_DOMAIN_SHARE: Record<SatDomain, number> = { algebra: 0.35, advanced_math: 0.35, psda: 0.15, geometry_trig: 0.15 };

export const SAT_QUESTION_ID_RE = /^(algebra|advanced_math|psda|geometry_trig)-[a-z0-9]+(-[a-z0-9]+)*-[0-9]{4}$/;

export const SAT_LIMITS = {
  /** SAT_FREE_TUTOR_PER_DAY's default: free tutor questions a day without Unlimited. */
  freeTutorPerDay: 5,
  /** A question is not asked again within this many days, unless the bank (or the filter) is exhausted. */
  noRepeatDays: 30,
  /** GET /api/sat/next: at most this many at once (default 10). */
  maxCount: 20,
  defaultCount: 10,
  /** The answers the adaptive difficulty follows, per domain. */
  recentPerDomain: 10,
  /** No estimate before this many answers. */
  estimateMinAnswered: 15,
  /** The estimate reads at most this many of the newest answers (what the student can do now). */
  estimateWindow: 120,
  /** GET /api/sat/progress reads at most this many of the newest answers. */
  progressWindow: 5000,
  /** SPR: a positive answer fills at most 5 characters, a negative one 6 (with its minus). */
  sprMaxPositive: 5,
  sprMaxNegative: 6,
} as const;

// ------------------------------------------------------------------ figures

const Num = z.number().finite();
const Pt = z.tuple([Num, Num]);
const Short = z.string().max(80);

export const TableFigureSchema = z
  .object({
    kind: z.literal("table"),
    headers: z.array(Short).min(1).max(8),
    rows: z.array(z.array(Short).min(1).max(8)).min(1).max(12),
    note: z.string().max(200).optional(),
  })
  .strict()
  .refine((t) => t.rows.every((r) => r.length === t.headers.length), { message: "every row has one cell per header" });

const Axis = z.object({ min: Num, max: Num, step: Num.positive(), label: Short.optional() }).strict().refine((a) => a.max > a.min, { message: "axis max must be above min" });

export const PlotItemSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("function"), expr: z.string().min(1).max(120), label: Short.optional(), dashed: z.boolean().optional(), domain: z.tuple([Num, Num]).optional() }).strict(),
  z.object({ type: z.literal("segment"), from: Pt, to: Pt, label: Short.optional(), dashed: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("point"), at: Pt, label: Short.optional(), open: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("bar"), x: Num, height: Num, label: Short.optional(), width: Num.positive().optional() }).strict(),
]);

export const PlotFigureSchema = z
  .object({
    kind: z.literal("plot"),
    x: Axis,
    y: Axis,
    grid: z.boolean().optional(),
    items: z.array(PlotItemSchema).min(1).max(60),
    note: z.string().max(200).optional(),
  })
  .strict();

export const ShapeItemSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("polygon"), points: z.array(Pt).min(3).max(12), dashed: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("circle"), center: Pt, r: Num.positive(), dashed: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("segment"), from: Pt, to: Pt, dashed: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("point"), at: Pt, label: Short.optional() }).strict(),
  z.object({ type: z.literal("label"), at: Pt, text: Short }).strict(),
  z.object({ type: z.literal("right_angle"), at: Pt, dirs: z.tuple([Pt, Pt]) }).strict(),
  z.object({ type: z.literal("arc_angle"), at: Pt, from: Num, to: Num, label: Short.optional() }).strict(),
]);

export const ShapeFigureSchema = z
  .object({
    kind: z.literal("shape"),
    items: z.array(ShapeItemSchema).min(1).max(40),
    note: z.string().max(200).optional(),
  })
  .strict();

export const SatFigureSchema = z.union([TableFigureSchema, PlotFigureSchema, ShapeFigureSchema]);
export type SatFigure = z.infer<typeof SatFigureSchema>;
export type PlotItem = z.infer<typeof PlotItemSchema>;
export type ShapeItem = z.infer<typeof ShapeItemSchema>;

// ------------------------------------------------------------------ questions

export const SAT_CHOICE_KEYS = ["A", "B", "C", "D"] as const;

export const SatChoiceSchema = z.object({ key: z.enum(SAT_CHOICE_KEYS), text: z.string().min(1).max(400) }).strict();

export const SatSolutionSchema = z
  .object({
    steps: z.array(z.object({ text: z.string().min(1).max(400), math: z.string().max(300).nullable() }).strict()).min(2).max(6),
    desmos_tip: z.string().max(400).nullable(),
  })
  .strict();

export const SatAnswerSchema = z.union([
  z.object({ key: z.enum(SAT_CHOICE_KEYS) }).strict(),
  z.object({ accepted: z.array(z.string().min(1).max(6)).min(1).max(12) }).strict(),
]);

/** One row of `sat_questions` as the app sees it (GET /api/sat/next, docs/sat/sample-20.json). */
export const SatQuestionSchema = z
  .object({
    id: z.string().regex(SAT_QUESTION_ID_RE),
    domain: z.enum(SAT_DOMAINS),
    skill: z.string().refine((s) => domainOfSkill(s) !== null, { message: "not one of the spec's skills" }),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    format: z.enum(["mcq", "spr"]),
    stem: z.string().min(1).max(4000),
    figure: SatFigureSchema.nullable(),
    choices: z.array(SatChoiceSchema).length(4).nullable(),
    answer: SatAnswerSchema,
    solution: SatSolutionSchema,
    status: z.enum(["live", "draft", "retired"]),
    version: z.number().int().min(1),
    created_at: z.string().optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (domainOfSkill(q.skill) !== q.domain) ctx.addIssue({ code: "custom", message: "skill is not in this domain" });
    if (!q.id.startsWith(`${q.domain}-${skillSlug(q.skill)}-`)) ctx.addIssue({ code: "custom", message: "id is not <domain>-<skill slug>-<nnnn>" });
    if (q.format === "mcq") {
      if (!q.choices) ctx.addIssue({ code: "custom", message: "an mcq has four choices" });
      else if (q.choices.map((c) => c.key).join("") !== "ABCD") ctx.addIssue({ code: "custom", message: "choices are keyed A, B, C, D in order" });
      if (!("key" in q.answer)) ctx.addIssue({ code: "custom", message: "an mcq's answer is {key}" });
    } else {
      if (q.choices !== null) ctx.addIssue({ code: "custom", message: "an spr has no choices" });
      if (!("accepted" in q.answer)) ctx.addIssue({ code: "custom", message: "an spr's answer is {accepted}" });
    }
  });

export type SatQuestion = z.infer<typeof SatQuestionSchema>;

/** What GET /api/sat/next selects (the whole row but `created_at`). */
export const SAT_QUESTION_COLUMNS = "id,domain,skill,difficulty,format,stem,figure,choices,answer,solution,status,version";

// ------------------------------------------------------------------ routes

const Flag = z.enum(["1", "2", "3"]).transform(Number);

export const SatNextQuerySchema = z
  .object({
    count: z.coerce.number().int().min(1).max(SAT_LIMITS.maxCount).default(SAT_LIMITS.defaultCount),
    domain: z.union([z.enum(SAT_DOMAINS), z.literal("")]).optional(),
    skill: z.string().max(80).optional(),
    difficulty: z.union([Flag, z.literal("")]).optional(),
  })
  .transform((q) => ({
    count: q.count,
    domain: q.domain ? q.domain : null,
    skill: q.skill ? q.skill : null,
    difficulty: q.difficulty ? (q.difficulty as 1 | 2 | 3) : null,
  }))
  .refine((q) => q.skill === null || domainOfSkill(q.skill) !== null, { message: "skill must be one of the spec's skills" })
  .refine((q) => q.skill === null || q.domain === null || domainOfSkill(q.skill) === q.domain, { message: "skill is not in that domain" });

export type SatNextQuery = z.infer<typeof SatNextQuerySchema>;

export const SatQuestionIdSchema = z.string().trim().regex(SAT_QUESTION_ID_RE).max(120);

export const SatAttemptRequestSchema = z.object({
  question_id: SatQuestionIdSchema,
  chosen: z.string().trim().min(1).max(12),
  correct: z.boolean(),
  seconds: z.number().int().min(0).max(86_400).default(0),
  used_tutor: z.boolean().default(false),
});

/** An IANA zone ("America/New_York"); checked again with Intl before it is used. */
export const SatTimeZoneSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_+\-/]+$/);

export const SatTutorRequestSchema = z.object({
  question_id: SatQuestionIdSchema,
  tz: SatTimeZoneSchema,
});

export const SatProgressQuerySchema = z.object({ tz: SatTimeZoneSchema.optional() });

export type SatTutorResponse = { allowed: boolean; used_today: number; cap: number; unlimited: boolean };

export type SatCount = { answered: number; correct: number };

export type SatProgressResponse = {
  answered: number;
  correct: number;
  by_domain: Array<{ domain: SatDomain } & SatCount>;
  by_skill: Array<{ domain: SatDomain; skill: string } & SatCount>;
  streak_days: number;
  today: { answered: number; tutor_used: number; cap: number; unlimited: boolean };
  /** A rough 200–800 band from practice (src/lib/sat/estimate.ts), never a score; null below 15 answers. */
  estimate: { low: number; high: number; note: string } | null;
};
