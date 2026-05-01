import { describe, expect, it } from "vitest";
import {
  formatLiveAvatarLogLine,
  normalizeLiveAvatarLog
} from "@/lib/live-avatar-debug";

describe("live-avatar-debug", () => {
  it("redacts sensitive fields and truncates long strings", () => {
    const entry = normalizeLiveAvatarLog({
      event: "token_received",
      source: "test",
      pathname: "/interview/live",
      at: Date.UTC(2026, 4, 1),
      details: {
        livekitToken: "super-secret-token",
        textPreview: "x".repeat(220)
      }
    });

    expect(entry.details.livekitToken).toBe("[redacted]");
    expect(String(entry.details.textPreview)).toHaveLength(183);
  });

  it("formats compact terminal lines", () => {
    const entry = normalizeLiveAvatarLog({
      event: "listening",
      source: "page",
      pathname: "/interview/live",
      at: Date.UTC(2026, 4, 1),
      details: { status: "ready" }
    });

    expect(formatLiveAvatarLogLine(entry)).toContain("[live-avatar] 2026-05-01T00:00:00.000Z page:listening /interview/live");
    expect(formatLiveAvatarLogLine(entry)).toContain('"status":"ready"');
  });
});
