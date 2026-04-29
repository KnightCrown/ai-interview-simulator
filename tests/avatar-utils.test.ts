import { describe, expect, it } from "vitest";
import { deriveAvatarEmotion, estimateSpeechDurationMs } from "@/lib/avatar-utils";

describe("deriveAvatarEmotion", () => {
  it("detects positive interviewer lines", () => {
    expect(deriveAvatarEmotion("That's interesting, good answer.")).toBe("positive");
  });

  it("detects skeptical interviewer lines", () => {
    expect(deriveAvatarEmotion("Can you be more specific and go deeper?")).toBe("negative");
  });

  it("falls back to neutral", () => {
    expect(deriveAvatarEmotion("Tell me about your project.")).toBe("neutral");
  });
});

describe("estimateSpeechDurationMs", () => {
  it("returns zero for empty input", () => {
    expect(estimateSpeechDurationMs("")).toBe(0);
    expect(estimateSpeechDurationMs("   ")).toBe(0);
  });

  it("uses a generous floor for very short utterances", () => {
    expect(estimateSpeechDurationMs("Hi.")).toBeGreaterThanOrEqual(3000);
  });

  it("does NOT cap at 14 seconds for long interview questions", () => {
    // This is a representative full-length first interview question. With the
    // previous 14s cap it was being cut off mid-sentence by the safety timer.
    const longQuestion =
      "Walk me through a challenging project that best proves you can succeed as a Software Engineer. " +
      "I am listening for system design tradeoffs, debugging process, code quality ownership, impact with measurable outcomes.";

    expect(estimateSpeechDurationMs(longQuestion)).toBeGreaterThan(14_000);
  });

  it("scales with word count", () => {
    const short = estimateSpeechDurationMs("Tell me about a project.");
    const long = estimateSpeechDurationMs(
      "Tell me about a project where you owned the architecture from end to end and explain how you made the tradeoffs along the way."
    );

    expect(long).toBeGreaterThan(short);
  });
});
