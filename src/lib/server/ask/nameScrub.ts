/**
 * The student's display name never reaches a model: the Privacy Policy promises that no AI request
 * carries it. POST /api/live/ask scrubs everything it sends to ANY model with this — the answer's
 * messages (`buildAskMessages`), the engine gates' repairs (`chatGate`) and the memory model
 * (`rememberFromTurn`) — each word of the name becoming "[name]".
 *
 * Names are written capitalised, and many are words too: a kid named Ray asks to "draw a ray AB",
 * one named Max wants the "max" of a list, and Will asks "will it work?". So:
 *  - every word of the display name counts (first, middle and last: "Maya Lopez-Diaz" is three), two
 *    letters or more, as whole words only, and never a LaTeX command (`\max`);
 *  - capitalised ("Ray", "RAY") it is always taken out: that is how a name is written;
 *  - lowercase it is taken out too, unless it is a common word (COMMON_WORDS: "ray", "max", "will",
 *    "an"…), which in lowercase is the word, not the kid. A name word missing from the list is
 *    taken out in lowercase as well: that costs a word of a sentence, never the name;
 *  - a display name's words that are never part of a name ("The", "Kid", "Mr": NOT_NAMES) are left
 *    alone, so "The Maths Kid" does not take every "The" out of every sentence.
 *
 * The screen's picture cannot be scrubbed (the policy says a board's content goes with it). Pure.
 */

/** Words that are also names, kept in lowercase: the word, not the kid. Lowercase, letters only. */
export const COMMON_WORDS: ReadonlySet<string> = new Set(
  (
    // maths and school words
    "ray max min mark sum mean mode range set base line point angle prime even odd plus times dot key ace " +
    "pi xi chi mu nu tau phi psi rho eta zeta theta delta sigma alpha beta gamma kappa lambda omega " +
    "tan sin cos sec log arc " +
    // short words that are names somewhere (An, He, Do, Le, Ma, My, No, So, To, In, Son, Long, Sun, Park…)
    "an do go ha he ho in la le lo ma me my no oh so to " +
    "son long sun moon song park young bay hung " +
    // words that are also given names
    "will may can bill jack pat sue bob rob art gene norm frank earl guy rich chase hunter cash drew dean lane " +
    "wade reed chip rusty sandy penny sunny buddy nick page pierce miles rocky robin wren jay fox wolf bear " +
    "hawk raven dove finch king prince duke major price white black brown green gray grey rice wood hill lake " +
    "ford ash oak glen cliff brook field forest ocean coral crystal honey berry cherry candy kit carol don rod " +
    "spike scout angel rex dale dash dusty echo ember fern gale gem gold haven ivory jewel laurel lark marsh " +
    "meadow misty noble north poppy reign royal saint shadow silver slate sparrow story true west zen " +
    "rose lily daisy iris ivy violet ruby pearl amber jade holly hazel olive sage willow heather " +
    "hope faith joy grace glory mercy charity patience honor honour justice liberty harmony melody destiny trinity " +
    "dawn eve sky river rain snow storm star stone summer autumn winter june april august march " +
    "mason cooper carter porter baker fisher archer sawyer tucker turner walker ward warren " +
    // what "[name]" itself says: never scrubbed twice
    "name"
  ).split(/\s+/),
);

/** A display name's words that are never part of a name: left alone, never scrubbed. */
export const NOT_NAMES: ReadonlySet<string> = new Set(
  "the and of is are am was were for with from this that not but its im mr mrs ms dr miss mister sir kid kids student user math maths".split(" "),
);

/** At most this many words of a display name are scrubbed (a display name is a name, not a paragraph). */
const MAX_NAME_WORDS = 8;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The display name's words, for the scrubber: two letters or more, split at spaces, hyphens and
 * anything else that is not a letter (an apostrophe stays inside: "O'Neil"), the part before an "@"
 * for an email, NOT_NAMES left out, each once. Never sent anywhere.
 */
export function nameWords(displayName: unknown): string[] {
  if (typeof displayName !== "string") return [];
  const text = displayName.includes("@") ? displayName.slice(0, displayName.indexOf("@")) : displayName;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[^\p{L}\p{M}'’]+/u)) {
    const word = raw.replace(/^['’]+|['’]+$/g, "");
    const key = word.toLowerCase();
    if ([...word].length < 2 || seen.has(key) || NOT_NAMES.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= MAX_NAME_WORDS) break;
  }
  return out;
}

/** One letter in either case (an apostrophe either way it is typed). */
function eitherCase(c: string): string {
  if (c === "'" || c === "’") return "['’]";
  const lo = c.toLowerCase();
  const up = c.toUpperCase();
  return lo !== up && [...lo].length === 1 && [...up].length === 1 ? `[${escapeRe(lo)}${escapeRe(up)}]` : escapeRe(c);
}

/** One name word as a pattern: capitalised only for a common word, else in any case. */
function wordPattern(word: string): string {
  const chars = [...word.toLowerCase()];
  const rest = chars.slice(1).map(eitherCase).join("");
  if (!COMMON_WORDS.has(word.toLowerCase())) return eitherCase(chars[0]) + rest;
  const capital = chars[0].toUpperCase();
  return ([...capital].length === 1 && capital !== chars[0] ? escapeRe(capital) : eitherCase(chars[0])) + rest;
}

/**
 * A function that takes every word of the name(s) out of a text as "[name]" (the module comment
 * says how). `names`: display names or name words, in any mix; nothing to scrub gives the text back.
 */
export function nameScrubber(names: string | ReadonlyArray<string | null | undefined> | null | undefined): (s: string) => string {
  const list = typeof names === "string" ? [names] : (names ?? []);
  const words = new Map<string, string>();
  for (const n of list) for (const w of nameWords(n)) if (!words.has(w.toLowerCase())) words.set(w.toLowerCase(), w);
  if (words.size === 0) return (s) => s;
  const patterns = [...words.values()].sort((a, b) => [...b].length - [...a].length).map(wordPattern);
  const re = new RegExp(`(?<![\\\\\\p{L}\\p{M}])(?:${patterns.join("|")})(?![\\p{L}\\p{M}])`, "gu");
  return (s) => s.replace(re, "[name]");
}

/** The scrubber for what the tutor knows about a student: every word of their display name. */
export function learnerScrubber(learner: { name?: string | null; nameWords?: readonly string[] }): (s: string) => string {
  return nameScrubber([learner.name ?? null, ...(learner.nameWords ?? [])]);
}
