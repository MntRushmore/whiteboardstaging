/**
 * Is what was just said worth a quick look from the director? Numbers, amounts, changes, steps and
 * lists are what charts and diagrams are made of: "Sales in Q1 were twelve million… then up to
 * fifteen" should reach the board within seconds, while "so, as I was saying" can wait for the
 * usual pace. Pure and cheap (a few regular expressions over a few hundred characters), run on
 * every committed segment. English cues: a lecture in another language still gets its digits,
 * percentages and currency noticed, and otherwise the slower pace.
 *
 * A false positive costs a slightly earlier question (billing is per minute of lecture, not per
 * question); a false negative costs up to `tickMinMs` of waiting. So the rules lean inclusive —
 * except "one", "half" and "quarter", which are everywhere in speech ("one of the reasons", "the
 * other half"); "one million" and "a quarter of the market" are still caught by what follows them.
 *
 * A REQUEST to see something ("draw a plant cell", "I'd like to see that on the whiteboard",
 * "picture this", "a comic strip") is the one thing the speaker asks of the board itself: it gets
 * the quick look too, so what they asked for is on the board in seconds, not at the next minute.
 */

export type SalienceReason = "number" | "percent" | "money" | "change" | "sequence" | "list" | "request";

const NUMBER_WORDS = [
  "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
  "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
  "hundred", "hundreds", "thousand", "thousands", "million", "millions", "billion", "billions", "trillion", "trillions",
  "dozen", "dozens",
];

const RULES: ReadonlyArray<[SalienceReason, RegExp]> = [
  // 12, 4.5, 1920, Q2, 3rd, 2,400 (a year is a number too)
  ["number", /\d/],
  ["number", new RegExp(`\\b(${NUMBER_WORDS.join("|")})\\b`, "i")],
  ["percent", /%|\bper\s?cent(age)?s?\b/i],
  // a currency, or the words a business lecture's numbers come with ("sales", "revenue")
  ["money", /[$€£¥₹]|\b(dollars?|euros?|pounds|yen|yuan|rupees?|cents|pence|bucks|revenues?|profits?|sales|turnover|earnings)\b/i],
  [
    "change",
    /\b(gr[eo]w(s|n|ing|th)?|r[io]se[ns]?|rising|f[ae]ll(s|en|ing)?|drop(s|ped|ping)?|doubl(e|ed|es|ing)|tripl(e|ed|es|ing)|halved|increas(e|ed|es|ing)|decreas(e|ed|es|ing)|declin(e|ed|es|ing)|jump(s|ed)?|climb(s|ed)?|surg(e|ed|es)|soar(s|ed)?|plung(e|ed|es)|plummet(s|ed)?|peak(s|ed)?|(up|down) (to|from|by))\b/i,
  ],
  ["sequence", /\b(first(ly)?|second(ly)?|third(ly)?|fourth|fifth|next|then|after that|afterwards|finally|lastly|step|steps|stage|phase|followed by)\b/i],
  [
    "list",
    /\bthere (are|were|is) (\w+ ){0,2}(types?|kinds?|stages?|steps?|causes?|parts?|phases?|ways?|reasons?|factors?|categories|forms?|classes|groups?|layers?|components?|elements?|principles?|laws?|effects?|branches|levels?|periods?|sources?|features?)\b/i,
  ],
  ["request", /\b(draw|drawn|sketch|illustrate|doodle|imagine|comic( strip)?s?)\b|\bpicture (this|that|it)\b|\bshow (me|us)\b|\b(want|like|love|need) to see\b|\bon the (white ?)?board\b/i],
];

/** Every reason `text` is salient (empty: it is not). */
export function salienceReasons(text: string): SalienceReason[] {
  const out: SalienceReason[] = [];
  for (const [reason, re] of RULES) if (!out.includes(reason) && re.test(text)) out.push(reason);
  return out;
}

export function isSalient(text: string): boolean {
  return RULES.some(([, re]) => re.test(text));
}

const REQUEST = RULES.find(([reason]) => reason === "request")![1];

/** The speaker asks to see something drawn ("draw…", "I'd like to see that on the whiteboard", "a comic strip"). */
export function isRequest(text: string): boolean {
  return REQUEST.test(text);
}
