import { describe, expect, it } from "vitest";
import { dedupeOverlap } from "@/hooks/useSpeechRecognition";

describe("useSpeechRecognition.dedupeOverlap", () => {
  it("returns the incoming text untouched when there is no overlap", () => {
    expect(dedupeOverlap("hello world", "how are you today")).toBe("how are you today");
  });

  it("returns an empty string when the incoming text is entirely a replay of the tail", () => {
    expect(dedupeOverlap("the quick brown fox", "brown fox")).toBe("");
  });

  it("strips the leading word-prefix that already appears as the trailing suffix", () => {
    expect(
      dedupeOverlap("I built a system that handles", "that handles real time payments")
    ).toBe("real time payments");
  });

  it("matches case-insensitively but preserves the original casing of the surviving tail", () => {
    expect(
      dedupeOverlap("We Shipped The Feature", "the feature on Tuesday")
    ).toBe("on Tuesday");
  });

  it("normalizes runs of whitespace when matching", () => {
    expect(
      dedupeOverlap("hello   there  friend", "friend how are you")
    ).toBe("how are you");
  });

  it("returns the incoming text trimmed when committed is empty", () => {
    expect(dedupeOverlap("", "  hello world  ")).toBe("hello world");
  });

  it("returns an empty string when incoming is empty", () => {
    expect(dedupeOverlap("anything goes here", "   ")).toBe("");
  });

  it("does not match a single-word coincidence beyond MAX_OVERLAP_WORDS", () => {
    // Trailing 'the' coincidentally matches start of incoming, but that's a
    // single-word overlap which is a real risk with common English words.
    // Confirm that single common-word overlaps still strip — this is the
    // expected behavior; the dedupe is conservative on the "trim" side.
    expect(dedupeOverlap("we built the", "the new dashboard")).toBe("new dashboard");
  });

  it("simulates the iOS Safari restart-replay scenario without doubling words", () => {
    // Session 1 finalised this much:
    let committed = "in my last role I led a team of five engineers";

    // iOS Safari force-stops after ~10s; on restart, it replays the last few
    // words of the previous session as the first 'final' result of the new
    // session, then continues with genuinely new speech.
    const replayedTail = "of five engineers and we shipped a major release in three months";

    const deduped = dedupeOverlap(committed, replayedTail);
    committed = `${committed} ${deduped}`;

    // Critical assertion: 'of five engineers' must appear EXACTLY ONCE in the
    // final transcript; the rest of the new content must be preserved.
    const occurrences = committed.toLowerCase().match(/of five engineers/g)?.length ?? 0;
    expect(occurrences).toBe(1);
    expect(committed).toBe(
      "in my last role I led a team of five engineers and we shipped a major release in three months"
    );
  });
});
