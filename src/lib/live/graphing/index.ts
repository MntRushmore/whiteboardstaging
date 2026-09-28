/**
 * Graphs the tutor sketches by hand. The engine (`LiveEngine.graphFor`, `engine/graphIntent.ts`)
 * decides WHAT to graph; this module decides how it looks — the window (`window.ts`), the pen
 * strokes (`pen.ts`, `plan.ts`) and where it goes on the screen (`place.ts`). The loop reveals
 * the result with the same HandWriter as the worked steps.
 */
export { GRAPH, graphPaceFor, planGraph, planFromGroups, tickLatex, traceFunction, type GraphPlanResult, type PlanOptions } from "./plan";
export { GRAPH_PLACE, placeGraphBlock, type GraphPlaceContext } from "./place";
export { WINDOW, chooseWindow, fromPx, lineOf, niceStepFor, numberLineWindow, ticksIn, toPx, type GraphWindow, type GraphWindowHint, type NumberLineWindow } from "./window";
export { PEN, Pen, clipPolyline, clipSegment, writeMath } from "./pen";
