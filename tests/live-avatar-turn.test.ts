import { describe, expect, it } from "vitest";
import { getUnsubmittedUtteranceDelta } from "@/lib/live-avatar-turn";

describe("getUnsubmittedUtteranceDelta", () => {
  it("accepts a stable interim-only utterance as sendable text", () => {
    expect(getUnsubmittedUtteranceDelta("I led the rollout across three teams", "")).toBe(
      "I led the rollout across three teams"
    );
  });

  it("only sends the new suffix after a prior submission", () => {
    expect(
      getUnsubmittedUtteranceDelta(
        "I led the rollout across three teams and improved activation by 20 percent",
        "I led the rollout across three teams"
      )
    ).toBe("and improved activation by 20 percent");
  });

  it("ignores empty, repeated, or non-substantive speech", () => {
    expect(getUnsubmittedUtteranceDelta("I led the rollout", "I led the rollout")).toBeNull();
    expect(getUnsubmittedUtteranceDelta("   ", "")).toBeNull();
    expect(getUnsubmittedUtteranceDelta("123", "")).toBeNull();
  });

  it("allows non-substantive deltas when requireSubstantive is false", () => {
    expect(getUnsubmittedUtteranceDelta("123", "", { requireSubstantive: false })).toBe("123");
    expect(getUnsubmittedUtteranceDelta("a", "", { requireSubstantive: false })).toBe("a");
  });
});
