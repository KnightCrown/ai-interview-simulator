import { describe, expect, it } from "vitest";
import { pickAvatarFrame } from "@/components/avatar-2d";

describe("pickAvatarFrame", () => {
  it("forces the closed frame whenever isSpeaking is false", () => {
    const result = pickAvatarFrame({
      mouthLevel: 0.9,
      isSpeaking: false,
      lastOpenAt: 1000,
      now: 1500
    });

    expect(result.isOpen).toBe(false);
    expect(result.nextLastOpenAt).toBe(1000);
  });

  it("opens immediately when speaking and the level is above the threshold", () => {
    const result = pickAvatarFrame({
      mouthLevel: 0.4,
      isSpeaking: true,
      lastOpenAt: 0,
      now: 2000
    });

    expect(result.isOpen).toBe(true);
    expect(result.nextLastOpenAt).toBe(2000);
  });

  it("keeps the mouth open during a short dip below the threshold (hold window)", () => {
    const result = pickAvatarFrame({
      mouthLevel: 0.05,
      isSpeaking: true,
      lastOpenAt: 1000,
      now: 1050,
      holdMs: 70
    });

    expect(result.isOpen).toBe(true);
    expect(result.nextLastOpenAt).toBe(1000);
  });

  it("closes once the level has stayed below the threshold past the hold window", () => {
    const result = pickAvatarFrame({
      mouthLevel: 0.02,
      isSpeaking: true,
      lastOpenAt: 1000,
      now: 1100,
      holdMs: 70
    });

    expect(result.isOpen).toBe(false);
    expect(result.nextLastOpenAt).toBe(1000);
  });

  it("respects custom thresholds", () => {
    const above = pickAvatarFrame({
      mouthLevel: 0.25,
      isSpeaking: true,
      lastOpenAt: 0,
      now: 500,
      threshold: 0.2
    });
    const below = pickAvatarFrame({
      mouthLevel: 0.18,
      isSpeaking: true,
      lastOpenAt: 0,
      now: 500,
      threshold: 0.2
    });

    expect(above.isOpen).toBe(true);
    expect(below.isOpen).toBe(false);
  });
});
