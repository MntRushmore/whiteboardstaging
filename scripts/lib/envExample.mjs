/**
 * Parses .env.example into sections and classifies every key by its section header.
 *
 * Section headers look like `# ─── <Title> ───…` (see .env.example). Classification is
 * driven by the title's first word so new sections need no code change:
 *   "Required …"          -> "required-deploy"  (the deployed app refuses to start without it)
 *   "Scripts and tests …" -> "scripts-only"     (must never be set in Vercel)
 *   anything else         -> "optional-deploy"  (defaults apply when absent)
 *
 * Shared by scripts/check-vercel-env.mjs and its tests. No dependencies.
 */

/** @typedef {"required-deploy" | "optional-deploy" | "scripts-only"} EnvClassification */

/**
 * @typedef {object} EnvKey
 * @property {string} name
 * @property {string} value           value as written (quotes stripped), "" when empty
 * @property {boolean} commented      true for `# NAME=value` lines
 * @property {number} line            1-based line number in the file
 * @property {string} section         section title (e.g. "Required")
 * @property {EnvClassification} classification
 */

/**
 * @typedef {object} EnvSection
 * @property {string} title
 * @property {EnvClassification} classification
 * @property {EnvKey[]} keys
 */

/**
 * @typedef {object} ParsedEnvExample
 * @property {EnvSection[]} sections
 * @property {Map<string, EnvKey>} keys   by name, insertion order = file order
 */

const SECTION_HEADER_RE = /^#\s*─+\s*(.+?)\s*─*\s*$/;
const KEY_LINE_RE = /^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/;

/** Title of the implicit section for keys that appear before any header. */
export const PREAMBLE_SECTION = "(no section)";

/**
 * @param {string} title
 * @returns {EnvClassification}
 */
export function classifySection(title) {
  const first = title.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (first === "required") return "required-deploy";
  if (first === "scripts" || first === "script") return "scripts-only";
  return "optional-deploy";
}

/**
 * Strips the trailing "(…)" explainer and box-drawing rule from a header, e.g.
 * `# ─── Required (the app refuses …) ─────` -> "Required".
 * @param {string} line
 * @returns {string | null}
 */
export function parseSectionHeader(line) {
  const m = line.match(SECTION_HEADER_RE);
  if (!m) return null;
  const title = m[1].replace(/\s*\(.*$/, "").trim();
  return title || null;
}

/**
 * @param {string} text  contents of .env.example
 * @returns {ParsedEnvExample}
 */
export function parseEnvExample(text) {
  /** @type {EnvSection[]} */
  const sections = [];
  /** @type {Map<string, EnvKey>} */
  const keys = new Map();
  /** @type {EnvSection | null} */
  let current = null;

  text.split(/\r?\n/).forEach((raw, i) => {
    const header = parseSectionHeader(raw);
    if (header) {
      current = { title: header, classification: classifySection(header), keys: [] };
      sections.push(current);
      return;
    }
    const m = raw.match(KEY_LINE_RE);
    if (!m) return;
    if (!current) {
      current = { title: PREAMBLE_SECTION, classification: "optional-deploy", keys: [] };
      sections.push(current);
    }
    let value = m[3].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    /** @type {EnvKey} */
    const key = {
      name: m[2],
      value,
      commented: Boolean(m[1]),
      line: i + 1,
      section: current.title,
      classification: current.classification,
    };
    current.keys.push(key);
    if (!keys.has(key.name)) keys.set(key.name, key);
  });

  return { sections, keys };
}

/**
 * @param {ParsedEnvExample} parsed
 * @param {EnvClassification} classification
 * @returns {string[]}
 */
export function keysByClassification(parsed, classification) {
  return [...parsed.keys.values()].filter((k) => k.classification === classification).map((k) => k.name);
}
