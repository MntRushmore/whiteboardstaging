/**
 * The name scrubber (src/lib/server/ask/nameScrub.ts): every word of the display name out of what a
 * model gets, capitalised always and lowercase unless it is a common word, so a kid named Ray can
 * still ask for "a ray AB".
 */
import { describe, expect, it } from "vitest";
import { COMMON_WORDS, learnerScrubber, nameScrubber, nameWords } from "../nameScrub";

describe("nameWords", () => {
  it("every word of the display name: first, middle, last, each side of a hyphen; an email's local part", () => {
    expect(nameWords("Maya Lopez")).toEqual(["Maya", "Lopez"]);
    expect(nameWords("  Ana María  Lopez-Diaz ")).toEqual(["Ana", "María", "Lopez", "Diaz"]);
    expect(nameWords("O'Neil")).toEqual(["O'Neil"]);
    expect(nameWords("maya.lopez@example.com")).toEqual(["maya", "lopez"]);
    expect(nameWords("Maya maya MAYA")).toEqual(["Maya"]);
  });

  it("one letter, words that are never a name, and nothing at all are left out", () => {
    expect(nameWords("J Smith")).toEqual(["Smith"]);
    expect(nameWords("The Maths Kid")).toEqual([]);
    expect(nameWords("Mr Lopez")).toEqual(["Lopez"]);
    expect(nameWords("kid4")).toEqual([]);
    expect(nameWords(null)).toEqual([]);
    expect(nameWords(42)).toEqual([]);
  });
});

describe("nameScrubber", () => {
  it("a kid named Ray: 'draw a ray AB' stays intact; 'Ray says hi' is scrubbed", () => {
    const scrub = nameScrubber("Ray");
    expect(COMMON_WORDS.has("ray")).toBe(true);
    expect(scrub("draw a ray AB")).toBe("draw a ray AB");
    expect(scrub("Ray says hi")).toBe("[name] says hi");
    expect(scrub("RAY SAYS HI")).toBe("[name] SAYS HI");
    expect(scrub("it's Ray's turn, then rays and Rayleigh")).toBe("it's [name]'s turn, then rays and Rayleigh");
  });

  it("Max, Will and Mark keep their words in lowercase", () => {
    expect(nameScrubber("Max")("find the max of 3, 7 and 5, Max")).toBe("find the max of 3, 7 and 5, [name]");
    expect(nameScrubber("Will")("will it work? Will thinks so")).toBe("will it work? [name] thinks so");
    expect(nameScrubber("Mark")("mark the point, Mark")).toBe("mark the point, [name]");
  });

  it("a two-word name: both words, a name that is not a word in any case", () => {
    const scrub = nameScrubber("Maya Lopez");
    expect(scrub("Hi, I'm Maya Lopez")).toBe("Hi, I'm [name] [name]");
    expect(scrub("maya lopez here")).toBe("[name] [name] here");
    expect(scrub("MAYA's homework, Lopez family")).toBe("[name]'s homework, [name] family");
    // whole words only
    expect(scrub("the Mayan calendar")).toBe("the Mayan calendar");
  });

  it("letters with accents, in any case", () => {
    const scrub = nameScrubber("Zoë Ångström");
    expect(scrub("zoë and ZOË and ångström")).toBe("[name] and [name] and [name]");
  });

  it("a LaTeX command is left alone; the name inside \\text{} is not", () => {
    const scrub = nameScrubber("Max");
    expect(scrub("\\max(a, b) = 3")).toBe("\\max(a, b) = 3");
    expect(nameScrubber("Maya")("\\text{Maya} = 3")).toBe("\\text{[name]} = 3");
  });

  it("a display name's words that are never a name are left alone", () => {
    const scrub = nameScrubber("The Maths Kid");
    expect(scrub("The answer is 5. The kid did maths.")).toBe("The answer is 5. The kid did maths.");
  });

  it("scrubbing twice changes nothing more; nothing to scrub gives the text back", () => {
    const scrub = nameScrubber(["Name", "Maya"]);
    const once = scrub("Name: Maya");
    expect(once).toBe("[name]: [name]");
    expect(scrub(once)).toBe(once);
    expect(nameScrubber(null)("Maya")).toBe("Maya");
    expect(nameScrubber([])("Maya")).toBe("Maya");
  });

  it("learnerScrubber: the first name and every word of the display name", () => {
    const scrub = learnerScrubber({ name: "Maya", nameWords: ["Maya", "Okafor"] });
    expect(scrub("maya okafor and Okafor")).toBe("[name] [name] and [name]");
    expect(learnerScrubber({ name: null, nameWords: [] })("Maya")).toBe("Maya");
  });
});
