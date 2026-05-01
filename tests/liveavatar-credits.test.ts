import { describe, expect, it } from "vitest";
import { detectLiveAvatarCreditsExhausted } from "@/lib/liveavatar-credits";

describe("detectLiveAvatarCreditsExhausted", () => {
  it("returns false for generic errors", () => {
    expect(detectLiveAvatarCreditsExhausted(500, '{"message":"Internal server error"}')).toBe(false);
    expect(detectLiveAvatarCreditsExhausted(400, '{"message":"Invalid avatar id"}')).toBe(false);
  });

  it("detects explicit credit exhaustion wording", () => {
    expect(detectLiveAvatarCreditsExhausted(400, "No credits remaining on this account")).toBe(true);
    expect(detectLiveAvatarCreditsExhausted(403, '{"message":"Insufficient credits"}')).toBe(true);
    expect(detectLiveAvatarCreditsExhausted(200, "Credits are depleted")).toBe(true);
  });

  it("detects subscription / quota signals", () => {
    expect(detectLiveAvatarCreditsExhausted(403, '{"message":"Subscription inactive"}')).toBe(true);
    expect(detectLiveAvatarCreditsExhausted(429, '{"detail":"Quota exceeded for streaming"}')).toBe(true);
    expect(detectLiveAvatarCreditsExhausted(402, '{"error":"Payment required"}')).toBe(true);
    expect(detectLiveAvatarCreditsExhausted(402, '{"message":"Malformed payload"}')).toBe(false);
  });
});
