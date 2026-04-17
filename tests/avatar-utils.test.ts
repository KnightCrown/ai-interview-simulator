import { describe, expect, it } from "vitest";
import { deriveAvatarEmotion } from "@/lib/avatar-utils";

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
