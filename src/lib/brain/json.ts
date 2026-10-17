/**
 * The brain's JSON across the native boundary (`AgathonBrain.call`).
 *
 * JSON has no Infinity or NaN, and the engine uses them: a domain `x > 0` is `{ lo: 0, hi: Infinity }`,
 * a number line's open end is unbounded. Plain `JSON.stringify` writes them as `null`, which loses the
 * answer. So out of the brain a non-finite number is the string `"Infinity"`, `"-Infinity"` or
 * `"NaN"` — what Swift's `JSONDecoder.nonConformingFloatDecodingStrategy = .convertFromString(…)`
 * reads back as a `Double` — and into the brain those strings become numbers again, but only under
 * the keys where the brain's records hold numbers (`NUMERIC_KEYS`), so a line of LaTeX that happens
 * to read `NaN` stays a string.
 */

export const NON_FINITE = { positive: "Infinity", negative: "-Infinity", nan: "NaN" } as const;

/** Keys whose values are numbers (or arrays of numbers) in the brain's records. */
const NUMERIC_KEYS: ReadonlySet<string> = new Set([
  "lo",
  "hi",
  "at",
  "from",
  "to",
  "slope",
  "x",
  "y",
  "w",
  "h",
  "cx",
  "cy",
  "r",
  "solutions",
  "covers",
  "xMin",
  "xMax",
  "yMin",
  "yMax",
]);

function reviveNumber(value: unknown): unknown {
  if (value === NON_FINITE.positive) return Infinity;
  if (value === NON_FINITE.negative) return -Infinity;
  if (value === NON_FINITE.nan) return NaN;
  return value;
}

/**
 * `encode` for records that hold no Infinity, NaN, Map, Set or function by construction (strokes,
 * payloads): plain `JSON.stringify`, which skips a replacer call per number — a stroke-heavy result
 * has tens of thousands of them, and the replacer is what a JavaScriptCore without a JIT pays for.
 */
export function encodePlain(value: unknown): string {
  return JSON.stringify(value);
}

export function encode(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "number" && !Number.isFinite(v)) return Number.isNaN(v) ? NON_FINITE.nan : v > 0 ? NON_FINITE.positive : NON_FINITE.negative;
    if (v instanceof Map) return Object.fromEntries(v);
    if (v instanceof Set) return [...v];
    // functions (a graph curve's sampler) never cross the boundary
    if (typeof v === "function") return undefined;
    return v;
  });
}

export function decode<T = unknown>(json: string): T {
  if (json === "" || json === undefined) return undefined as T;
  // the reviver costs a call per value: only a document with a non-finite number in it needs one
  if (!json.includes(`"${NON_FINITE.positive}"`) && !json.includes(`"${NON_FINITE.negative}"`) && !json.includes(`"${NON_FINITE.nan}"`)) return JSON.parse(json) as T;
  return JSON.parse(json, (key, v) => {
    if (!NUMERIC_KEYS.has(key)) return v;
    if (Array.isArray(v)) return v.map(reviveNumber);
    return reviveNumber(v);
  }) as T;
}
