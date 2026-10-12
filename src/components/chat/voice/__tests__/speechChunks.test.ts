import { describe, expect, it } from "vitest";
import { ASK_SPEECH, fitWords, sentenceKey, sentenceWords, splitLong, takeSentences } from "../speechChunks";

const all = (text: string) => takeSentences(text, 0, true).sentences;
const streamed = (text: string) => takeSentences(text, 0, false);

describe("takeSentences: where a sentence ends", () => {
  it("at . ! ? followed by a space, keeping the mark", () => {
    expect(all("Nice work! What is 7 times 8? Try it.")).toEqual(["Nice work!", "What is 7 times 8?", "Try it."]);
  });

  it("not inside a decimal: 3.5, 0.25", () => {
    expect(all("Round 3.5 up. Then 0.25 is a quarter.")).toEqual(["Round 3.5 up.", "Then 0.25 is a quarter."]);
  });

  it("not after e.g., i.e., etc., Mr. or Dr.", () => {
    expect(all("Use a tool, e.g. a ruler. Dr. Lee says hi. That is, i.e. the same.")).toEqual(["Use a tool, e.g. a ruler.", "Dr. Lee says hi.", "That is, i.e. the same."]);
  });

  it("never inside $…$ or $$…$$ maths", () => {
    expect(all("We get $3.5 + 1.2 = 4.7$. Next one.")).toEqual(["We get $3.5 + 1.2 = 4.7$.", "Next one."]);
    expect(all("Look:\n$$x = 2. \\text{ Done! } y = 3$$\nNow you try.")).toEqual(["Look:", "$$x = 2. \\text{ Done! } y = 3$$", "Now you try."]);
  });

  it("at a new line: paragraphs and list items; a list's '1.' is not an end", () => {
    expect(all("Here are the steps:\n1. Add the ones. Write 3.\n2. Carry the 1\n\n- Then add the tens")).toEqual([
      "Here are the steps:",
      "1. Add the ones.",
      "Write 3.",
      "2. Carry the 1",
      "- Then add the tens",
    ]);
  });

  it("a number that ends a sentence still ends it", () => {
    expect(all("The answer is 56. Great job!")).toEqual(["The answer is 56.", "Great job!"]);
  });

  it("closing bold, quotes and brackets stay with their sentence", () => {
    expect(all('**Great job!** You said "seven." (That is right.) Next.')).toEqual(["**Great job!**", 'You said "seven."', "(That is right.)", "Next."]);
  });

  it("an ellipsis ends one", () => {
    expect(all("Hmm... let's see.")).toEqual(["Hmm...", "let's see."]);
  });

  it("the board block is never said", () => {
    expect(all('I wrote it on the board. <board>{"actions":[]}</board>')).toEqual(["I wrote it on the board."]);
    expect(takeSentences('Done. <board>{"act', 0, false).sentences).toEqual(["Done."]);
  });

  it("a lone $ is money at the end of its line or the reply, not maths", () => {
    expect(all("It costs $5. You pay $2.\nThat leaves $3. Yes.")).toEqual(["It costs $5.", "You pay $2.", "That leaves $3.", "Yes."]);
  });
});

describe("takeSentences: while the reply streams", () => {
  it("only whole sentences; the rest waits, and `next` says where it starts", () => {
    const text = "First one. Second is on its";
    const { sentences, next } = streamed(text);
    expect(sentences).toEqual(["First one."]);
    expect(text.slice(next)).toBe(" Second is on its");
  });

  it("a mark at the very end waits: '3.' may become '3.5', 'Great!' may get its '**'", () => {
    expect(streamed("The answer is 3.").sentences).toEqual([]);
    expect(streamed("**Great!").sentences).toEqual([]);
    expect(streamed("The answer is 3.5 cm. And").sentences).toEqual(["The answer is 3.5 cm."]);
  });

  it("a dollar (money) waits at most for its line to end", () => {
    expect(streamed("It costs $5. You pay $2. Then").sentences).toEqual([]);
    expect(streamed("It costs $5. You pay $2.\nThen").sentences).toEqual(["It costs $5.", "You pay $2."]);
  });

  it("an open $ waits for its maths to close", () => {
    expect(streamed("We get $3.5 + 1.2 = ").sentences).toEqual([]);
    expect(streamed("We get $3.5 + 1.2 = 4.7$. Then").sentences).toEqual(["We get $3.5 + 1.2 = 4.7$."]);
  });

  it("piece by piece gives the same sentences as all at once", () => {
    const reply = "Let's think. What is $\\frac{1}{2}$ of 8? It is 4. Now try 3.5 times 2.\n- One more step: add 1!";
    const pieces: string[] = [];
    let text = "";
    let cursor = 0;
    for (let i = 0; i < reply.length; i += 3) {
      text = reply.slice(0, i + 3);
      const got = takeSentences(text, cursor, false);
      pieces.push(...got.sentences);
      cursor = got.next;
    }
    pieces.push(...takeSentences(reply, cursor, true).sentences);
    expect(pieces).toEqual(all(reply));
    expect(pieces).toEqual(["Let's think.", "What is $\\frac{1}{2}$ of 8?", "It is 4.", "Now try 3.5 times 2.", "- One more step: add 1!"]);
  });
});

describe("sentenceWords, splitLong, sentenceKey, fitWords", () => {
  it("the words to say: list markers, bold and emoji gone, maths in words", () => {
    expect(sentenceWords("1. **Add** $\\frac{3}{4}$ to $x^2$! 🎉")).toBe("Add three quarters to x squared!");
    expect(sentenceWords("- $3 - 5 = -2$")).toBe("3 minus 5 equals negative 2");
    expect(sentenceWords("## Step 2")).toBe("Step 2");
    expect(sentenceWords("$$ $$")).toBe("");
  });

  it("splitLong: at a comma when it can, else a space; every piece fits", () => {
    const long = `${"one two three four five, ".repeat(12)}the end.`;
    const parts = splitLong(long, 100);
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(100);
    expect(parts[0].endsWith(",")).toBe(true);
    expect(parts.join(" ")).toBe(long.trim());
    expect(splitLong("short", 100)).toEqual(["short"]);
    expect(splitLong("x".repeat(250), 100).map((p) => p.length)).toEqual([100, 100, 50]);
  });

  it("sentenceKey: the same sentence streamed and cleaned has one key", () => {
    expect(sentenceKey("**Great** job!")).toBe(sentenceKey("Great job."));
    expect(sentenceKey("What is $7 \\times 8$?")).toBe("whatis7times8");
    expect(sentenceKey("🎉")).toBe("");
  });

  it("fitWords: whole when it fits, cut on a sentence or word when it does not, nothing when too little is left", () => {
    expect(fitWords("Short one.", 100)).toBe("Short one.");
    const cut = fitWords("This is the first part. This is the second part that is long.", 40);
    expect(cut).toBe("This is the first part.");
    expect(fitWords("Anything at all here", 15)).toBe("");
  });

  it("the reply's character cap and phrase size are what the voice can take", () => {
    expect(ASK_SPEECH.maxReplyChars).toBe(700);
    expect(ASK_SPEECH.phraseChars).toBeLessThan(280);
  });
});
