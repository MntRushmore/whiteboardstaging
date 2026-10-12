/**
 * What the tutor may remember about a student, and when it is worth asking the memory model at all
 * (docs/ASK-V2.md, part "memory"). Pure: the store (`store.ts`) calls these around the model.
 *
 * KEEP: how the student learns. What they get stuck on ("Mixes up the bottom numbers when adding
 * fractions"), what helps ("A picture helps with fractions"), interests a word problem can use
 * ("Likes soccer and dinosaurs"), and how they like to be taught ("Likes shorter hints", "Wants to
 * try first").
 *
 * NEVER: who they are. No names (theirs or anyone's), school or teacher, where they live, family or
 * friends, contact details or accounts, age or birthday, health, and nothing they share about how
 * they feel or their life at home. The memory prompt says so (`prompts/askMemory.ts`), and
 * `memoryNoteAllowed` drops any note that still carries one, as the backstop: a note it is unsure
 * about is dropped, never kept. A kid who writes "my teacher Mrs Lee says…" loses nothing by it:
 * the tutor just does not keep that note.
 */
import { ASK_LIMITS } from "@/lib/live/ask/contracts";

// ------------------------------------------------------------------ the filter

/** Words and phrases that make a note about who the student is, not how they learn (case-insensitive, whole words). */
const PERSONAL: readonly RegExp[] = [
  // school and teachers
  /\b(school|schools|teachers?|principal|classmates?|homeroom|academy|elementary|middle school|high school|tutor named)\b/i,
  // family and friends ("fact families" is maths)
  /\b(mom|mum|mommy|mother|dad|daddy|father|parents?|brothers?|sisters?|siblings?|grandma|grandpa|grandmother|grandfather|granny|nana|aunt|auntie|uncle|cousins?|stepmom|stepdad|friends?|bff|boyfriend|girlfriend|babysitter|nanny|divorce\w*|adopted|foster)\b/i,
  /(?<!\bfact\s)\bfamil(y|ies)\b/i,
  // contact details, accounts and places
  /\b(address|street|avenue|zip code|zipcode|postcode|postal code|phone|cellphone|cell phone|email|e-mail|instagram|snapchat|tiktok|discord|username|password|whatsapp|facebook|youtube channel)\b/i,
  /\b(lives?|living)\s+(in|at|near|on|with)\b/i,
  /\bmoved\s+(here|away|from|house|schools?)\b/i,
  /\b(hometown|neighbou?rhood|apartment)\b/i,
  // names said as names
  /\b(named|called|name is|name's)\b/i,
  // age and birthday
  /\b(birthdays?|born|years? old|year-old)\b/i,
  // health
  /\b(adhd|autism|autistic|asperger\w*|dyslexi\w*|dyscalculi\w*|dyspraxi\w*|disorder|disabilit\w*|diagnos\w*|therap\w*|counsel\w*|doctor|hospital|medicine|medication|meds|pills?|sick|illness|ill|disease|allerg\w*|asthma|diabet\w*|epilep\w*|seizures?|injur\w*|surgery|pregnan\w*)\b/i,
  // feelings and life at home
  /\b(sad|sadness|depress\w*|lonely|loneliness|anxious|anxiety|panic\w*|scared|afraid|fear|frightened|cry|cries|crying|cried|upset|angry|anger|mad at|bull(y|ied|ies|ying)|abuse\w*|hurt\w*|unsafe|worried|worries|stress\w*|suicid\w*|self-harm|kill\w*|die|dying|death|dead|grief|grieving|unhappy|miserable|nightmares?)\b/i,
  /\bhates?\s+(him|her|my|them)sel(f|ves)\b/i,
  // beliefs and background
  /\b(church|mosque|temple|synagogue|pray\w*|religio\w*|christian|muslim|jewish|hindu|buddhist|immigra\w*|citizenship|racial|ethnic\w*)\b/i,
  // things to steal
  /\b(credit card|bank account|social security|ssn|passport)\b/i,
];

/** A title before a name (case matters: "miss a step" is fine, "Miss Lee" is not). */
const TITLE_NAME = /\b(Mrs|Mr|Ms|Mx|Dr|Miss)\.?\s+[A-Z]/;
/** An email address, a web address, a handle. */
const CONTACT = /[^\s@]+@[^\s@]+|https?:\/\/|www\.|\.(com|org|net|edu)\b|(^|\s)@\w/i;
/** A phone number, a zip code, a card: 5 or more digits in a row, or digits split like a phone number. */
const LONG_NUMBER = /\d{5,}|\b\d{3}[-.\s)]+\d{3}[-.\s]+\d{4}\b/;

/** Capitalized words that are not people: math, school subjects, and things a word problem can be about. */
const NOT_A_NAME = new Set([
  "Pythagorean", "Theorem", "Roman", "Numerals", "Celsius", "Fahrenheit", "English", "Spanish", "French",
  "Math", "Maths", "Science", "History", "Reading", "Writing", "Algebra", "Geometry", "Calculus", "Common", "Core",
  "Minecraft", "Lego", "Legos", "Pokemon", "Pokémon", "Star", "Wars", "Harry", "Potter", "Mario", "Roblox", "Fortnite",
]);

/** How notes begin: the first word is capitalized for the sentence, not because it is a name. */
const NOTE_STARTS = new Set([
  "Likes", "Loves", "Enjoys", "Prefers", "Wants", "Needs", "Asked", "Asks", "Gets", "Got", "Mixes", "Confuses", "Struggles",
  "Finds", "Is", "Was", "Does", "Doesn't", "Uses", "Remembers", "Forgets", "Often", "Sometimes", "Usually", "Tends",
  "Works", "Learns", "Learned", "Understands", "Knows", "Can", "Can't", "Cannot", "Has", "Responds", "Answers", "Benefits",
  "Counts", "Reads", "Writes", "Solves", "Checks", "Skips", "Rushes", "Guesses", "Draws", "Thinks", "Says", "Still",
  "Pictures", "Short", "Shorter", "Step", "Visual", "Word", "Interested", "Into",
]);

/**
 * Two capitalized words in a row ("Maya Lopez", "Lincoln Elementary"): a name, unless one of them
 * is in NOT_A_NAME, or the first is how the note begins ("Likes Roblox").
 */
function hasFullName(text: string): boolean {
  const words = text.split(/\s+/);
  const capital = (w: string) => /^[A-Z][a-z'’]+$/.test(w);
  for (let i = 0; i + 1 < words.length; i++) {
    // a comma or full stop after the first word ends the pair ("Fractions, Decimals")
    const first = words[i];
    const second = words[i + 1].replace(/[.,;:!?)]+$/, "");
    if (!capital(first) || !capital(second)) continue;
    if (i === 0 && NOTE_STARTS.has(first)) continue;
    if (NOT_A_NAME.has(first) || NOT_A_NAME.has(second)) continue;
    return true;
  }
  return false;
}

/**
 * May the tutor keep this note? False for anything personal (see the module comment), for a note
 * that is empty or longer than ASK_LIMITS.memoryNote, and for one with no words in it. When in
 * doubt, false: losing a note costs a hint that fits a little less; keeping a child's personal
 * detail is never worth it.
 */
export function memoryNoteAllowed(note: string): boolean {
  if (typeof note !== "string") return false;
  const text = note.trim();
  if (!text || text.length > ASK_LIMITS.memoryNote) return false;
  if (!/\p{L}{2,}/u.test(text)) return false;
  if (CONTACT.test(text) || LONG_NUMBER.test(text) || TITLE_NAME.test(text)) return false;
  if (PERSONAL.some((re) => re.test(text))) return false;
  return !hasFullName(text);
}

// ------------------------------------------------------------------ cleaning

/** A note as kept: one line, single spaces, no list marker or quotes around it, at most ASK_LIMITS.memoryNote characters (cut at a word). */
export function cleanMemoryNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:[-*•–]|\d{1,2}[.)])\s+/, "")
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .trim();
  if (!s) return null;
  if (s.length > ASK_LIMITS.memoryNote) {
    const cut = s.slice(0, ASK_LIMITS.memoryNote);
    const space = cut.lastIndexOf(" ");
    s = (space > ASK_LIMITS.memoryNote * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, "");
  }
  return s || null;
}

const noteKey = (note: string) => note.toLowerCase().replace(/[.!?\s]+$/, "");

/** The notes as stored: each cleaned and allowed, the first of any repeated (ignoring case and end punctuation), at most ASK_LIMITS.memoryNotes. */
export function cleanMemoryNotes(raw: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw ?? []) {
    const note = cleanMemoryNote(item);
    if (!note || !memoryNoteAllowed(note)) continue;
    const key = noteKey(note);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(note);
    if (out.length >= ASK_LIMITS.memoryNotes) break;
  }
  return out;
}

/** The same notes in the same order (case and end punctuation aside): nothing to write. */
export function sameNotes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((note, i) => noteKey(note) === noteKey(b[i]));
}

/** How many of `before` are gone from `after`. */
export function droppedNotes(before: readonly string[], after: readonly string[]): number {
  const kept = new Set(after.map(noteKey));
  return before.filter((note) => !kept.has(noteKey(note))).length;
}

/**
 * One turn may drop at most this many notes. A model that answers an empty or short list by
 * mistake would otherwise wipe what the tutor learned over weeks; a student who has really moved on
 * loses the old notes a few turns at a time.
 */
export const MAX_DROPPED_PER_TURN = 3;

// ------------------------------------------------------------------ is it worth asking?

/** A message that is only a pleasantry or a yes or no. */
const PLEASANTRY =
  /^(hi+|hello+|hey+|yo|sup|thanks?( you)?|thank u|thx|ty|ok(ay)?|k|kk|yes|yeah|yep|yup|no|nope|nah|cool|nice|great|awesome|wow|lol|haha+|bye|goodbye|good ?night|sure|got it|i see|oh+|hmm+|done|next|please|pls|what|huh|idk)[\s!.?,]*$/i;

/** Words a student uses about how they learn or what they like: always worth a look. */
const SIGNAL =
  /\b(don'?t (get|understand|know)|do not (get|understand)|confus\w*|stuck|hard|tricky|difficult|easier|simpler|slow(er)?|fast(er)?|short(er)?|long(er)?|too (long|much|many|hard|easy)|step by step|one step|explain|why|show me|picture|draw|example|hints?|like|love|favou?rite|enjoy|hate|boring|fun|practi[cs]e|quiz|remember|forget|always|never|again|mistakes?|wrong|keep)\b/i;

/**
 * Is this exchange worth the memory model's time? A cheap guess before any call: no for a
 * pleasantry ("thanks!", "ok"), a bare answer ("12", "x = 3") or a one-word ask with nothing about
 * how the student learns in it; yes for anything with a word like "stuck", "explain", "shorter" or
 * "I like", and for any real question of two words or more.
 */
export function memoryWorthy(message: string, reply: string): boolean {
  const text = (message ?? "").trim();
  if (!text || !(reply ?? "").trim()) return false;
  if (PLEASANTRY.test(text)) return false;
  if (SIGNAL.test(text)) return true;
  const words = text.match(/\p{L}{2,}/gu) ?? [];
  return words.length >= 2;
}
