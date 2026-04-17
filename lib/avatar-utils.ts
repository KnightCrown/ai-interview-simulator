export type AvatarEmotion = "neutral" | "positive" | "negative";

export function deriveAvatarEmotion(text: string) {
  const lower = text.toLowerCase();

  if (
    lower.includes("good") ||
    lower.includes("interesting") ||
    lower.includes("strong") ||
    lower.includes("great") ||
    lower.includes("nice")
  ) {
    return "positive" as AvatarEmotion;
  }

  if (
    lower.includes("specific") ||
    lower.includes("deeper") ||
    lower.includes("pressure") ||
    lower.includes("concern") ||
    lower.includes("skeptical")
  ) {
    return "negative" as AvatarEmotion;
  }

  return "neutral" as AvatarEmotion;
}

export function supportsWebGl() {
  if (typeof document === "undefined") {
    return false;
  }

  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
}
