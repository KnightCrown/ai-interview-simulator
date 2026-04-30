import { describe, expect, it } from "vitest";
import {
  EMPTY_ANSWER_REACTIONS,
  EMPTY_ANSWER_REASK_PREAMBLES,
  buildReaskQuestion,
  pickRandomReaction,
  pickRandomReaskPreamble
} from "@/lib/empty-answer-responses";

describe("EMPTY_ANSWER_REACTIONS", () => {
  it("contains 10 distinct first-person reactions", () => {
    expect(EMPTY_ANSWER_REACTIONS).toHaveLength(10);
    const unique = new Set(EMPTY_ANSWER_REACTIONS);
    expect(unique.size).toBe(EMPTY_ANSWER_REACTIONS.length);
    for (const reaction of EMPTY_ANSWER_REACTIONS) {
      expect(reaction.length).toBeGreaterThan(20);
    }
  });
});

describe("EMPTY_ANSWER_REASK_PREAMBLES", () => {
  it("contains 10 distinct re-ask preambles", () => {
    expect(EMPTY_ANSWER_REASK_PREAMBLES).toHaveLength(10);
    const unique = new Set(EMPTY_ANSWER_REASK_PREAMBLES);
    expect(unique.size).toBe(EMPTY_ANSWER_REASK_PREAMBLES.length);
    for (const preamble of EMPTY_ANSWER_REASK_PREAMBLES) {
      expect(preamble.length).toBeGreaterThan(10);
    }
  });
});

describe("pickRandomReaction", () => {
  it("returns a value from the canned list", () => {
    const result = pickRandomReaction(() => 0.3);
    expect(EMPTY_ANSWER_REACTIONS).toContain(result);
  });

  it("clamps a 0.999 RNG value to a valid index", () => {
    const result = pickRandomReaction(() => 0.999);
    expect(EMPTY_ANSWER_REACTIONS).toContain(result);
  });
});

describe("pickRandomReaskPreamble", () => {
  it("returns a value from the canned list", () => {
    const result = pickRandomReaskPreamble(() => 0.7);
    expect(EMPTY_ANSWER_REASK_PREAMBLES).toContain(result);
  });
});

describe("buildReaskQuestion", () => {
  it("starts with one of the canned preambles", () => {
    const original = "Walk me through a project that proves you can succeed as a Software Engineer.";
    const result = buildReaskQuestion(original, () => 0.0);
    expect(result.startsWith(EMPTY_ANSWER_REASK_PREAMBLES[0])).toBe(true);
  });

  it("preserves the original question text so the candidate hears it again", () => {
    const original = "Walk me through a project that proves you can succeed as a Software Engineer.";
    const result = buildReaskQuestion(original, () => 0.5);
    expect(result).toContain(original);
  });

  it("falls back gracefully when the original question is empty", () => {
    const result = buildReaskQuestion("   ", () => 0.0);
    expect(result.length).toBeGreaterThan(0);
    // No trailing whitespace from the empty original.
    expect(result.endsWith(" ")).toBe(false);
  });
});
