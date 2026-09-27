/**
 * "The tutor reads the figure": the model perceives (`schema.ts`: which label is which angle or
 * side, and what the drawing shows), the engine reasons (`plan.ts`: the facts → the equations;
 * `answer.ts`: the engine solves them and the answer is checked). Pure — the route, the board and
 * the figure eval share it.
 */
export { FigureReplySchema, FigureQuantitySchema, FACT_TYPES, parseFact, readFromReply, type FactType, type FigureFact, type FigureQuantity, type FigureRead, type FigureReply } from "./schema";
export { askedLetters, planFigure, type FigurePlan, type FigureStage, type PlanOptions, type QuantityKind } from "./plan";
export { finalValue, numberValue, renameLetter, sensibleSize, solveFallbackLines, solveStages, type FigureSolve } from "./answer";
export { formatNumber, isValueLabel, labelKey, looksLikeUnknown, parseLabel, type LabelValue, type ParsedLabel } from "./labels";
