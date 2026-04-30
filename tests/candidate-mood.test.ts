import { describe, expect, it } from "vitest";
import { createEmptyMoodCounts, getDominantMoodFromCounts } from "@/lib/candidate-mood";

describe("candidate mood utilities", () => {
  it("uses the fallback mood when no mood samples were captured", () => {
    expect(getDominantMoodFromCounts(createEmptyMoodCounts(), "nervous")).toBe("nervous");
  });

  it("selects the mood with the highest sampled count", () => {
    const counts = createEmptyMoodCounts();
    counts.happy = 10;
    counts.sad = 2;
    counts.nervous = 4;

    expect(getDominantMoodFromCounts(counts, "neutral")).toBe("happy");
  });
});
