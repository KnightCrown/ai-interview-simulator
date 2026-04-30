import { describe, expect, it } from "vitest";
import { isTranscriptSubstantive } from "@/lib/transcript-utils";

describe("transcript-utils", () => {
  it("isTranscriptSubstantive rejects empty or noise-only input", () => {
    expect(isTranscriptSubstantive("")).toBe(false);
    expect(isTranscriptSubstantive("   ")).toBe(false);
    expect(isTranscriptSubstantive("123")).toBe(false);
    expect(isTranscriptSubstantive("?!")).toBe(false);
  });

  it("isTranscriptSubstantive accepts minimal real words", () => {
    expect(isTranscriptSubstantive("ok")).toBe(true);
    expect(isTranscriptSubstantive("I shipped the feature.")).toBe(true);
  });
});
