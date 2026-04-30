import type { FaceEmotionDominant } from "@/lib/interview-types";

export const CANDIDATE_MOOD_ORDER: FaceEmotionDominant[] = ["happy", "nervous", "sad", "neutral"];

export function createEmptyMoodCounts(): Record<FaceEmotionDominant, number> {
  return {
    happy: 0,
    sad: 0,
    nervous: 0,
    neutral: 0
  };
}

export function getDominantMoodFromCounts(
  counts: Record<FaceEmotionDominant, number>,
  fallback: FaceEmotionDominant
) {
  const hasSamples = CANDIDATE_MOOD_ORDER.some((mood) => counts[mood] > 0);
  if (!hasSamples) {
    return fallback;
  }

  return CANDIDATE_MOOD_ORDER.reduce((dominant, mood) => (counts[mood] > counts[dominant] ? mood : dominant), fallback);
}
