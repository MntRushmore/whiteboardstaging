import { describe, expect, it } from "vitest";
import { isRequest, isSalient, salienceReasons } from "../salience";

describe("salience", () => {
  it("numbers: digits, years, number words", () => {
    expect(salienceReasons("Sales hit 12 million")).toContain("number");
    expect(salienceReasons("in 1920 the economy boomed")).toContain("number");
    expect(salienceReasons("Q2 looked better")).toContain("number");
    expect(salienceReasons("twelve million units")).toContain("number");
    expect(salienceReasons("a hundred and five people")).toContain("number");
    expect(salienceReasons("it was worth three thousand")).toContain("number");
    expect(salienceReasons("about a dozen eggs")).toContain("number");
    expect(salienceReasons("Twenty-five of them")).toContain("number");
  });

  it("percentages and money", () => {
    expect(salienceReasons("up 4%")).toContain("percent");
    expect(salienceReasons("a rise of five percent")).toContain("percent");
    expect(salienceReasons("the percentage who voted")).toContain("percent");
    expect(salienceReasons("it cost $40")).toContain("money");
    expect(salienceReasons("prices in euros")).toContain("money");
    expect(salienceReasons("let's talk about sales")).toContain("money");
    expect(salienceReasons("revenue and profit")).toContain("money");
  });

  it("changes", () => {
    for (const s of ["exports grew", "prices rose", "the rate fell", "profits dropped", "output doubled", "costs increased", "demand decreased", "it declined", "it went up to the top", "down by a lot", "shares jumped", "growth slowed"]) {
      expect(salienceReasons(s), s).toContain("change");
    }
  });

  it("steps and lists", () => {
    for (const s of ["First, the light is absorbed", "next the water splits", "then it rains", "after that we filter", "finally the sugar forms", "in this step", "the second stage"]) {
      expect(salienceReasons(s), s).toContain("sequence");
    }
    expect(salienceReasons("there are three types of rock")).toContain("list");
    expect(salienceReasons("There were several main causes of the war")).toContain("list");
    expect(salienceReasons("there are many kinds of cells")).toContain("list");
  });

  it("a request to see something: drawn at the quick pace", () => {
    for (const s of [
      "Can you draw a plant cell for me?",
      "I would kind of like to see that on the whiteboard.",
      "Picture this: a castle on a hill.",
      "Imagine a futuristic police officer.",
      "I'm thinking about making a comic strip for a video game.",
      "Show me what a neuron looks like.",
      "Sketch the heart, please.",
    ]) {
      expect(salienceReasons(s), s).toContain("request");
    }
    expect(isSalient("Can everyone see the board?")).toBe(false);
    expect(isRequest("I would kind of like to see that on the whiteboard.")).toBe(true);
    expect(isRequest("Sales grew 12% in Q2.")).toBe(false);
  });

  it("everyday talk is not salient", () => {
    for (const s of [
      "Good morning everyone, let's get started.",
      "So, as I was saying, this matters a lot.",
      "One of the reasons is simple.",
      "The other half of the room can't hear me.",
      "Can everyone see the board?",
      "This idea is really important for the exam.",
      "The fellow in the story was kind.",
      "Often people forget this.",
    ]) {
      expect(isSalient(s), s).toBe(false);
    }
  });

  it("reasons are listed once each, in rule order", () => {
    expect(salienceReasons("Sales grew 12% to $4 million, then fell")).toEqual(["number", "percent", "money", "change", "sequence"]);
    expect(salienceReasons("")).toEqual([]);
  });
});
