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

// Conservative estimate of how long a TTS voice will take to read `text`.
// Tuned to slightly over-estimate so the fallback safety timer never trims
// the interviewer mid-question; the hook also rechecks `speechSynthesis.speaking`
// before actually resolving.
export function estimateSpeechDurationMs(text: string) {
  const cleanText = text.trim();
  if (!cleanText) {
    return 0;
  }

  const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
  const punctuationPauses = (cleanText.match(/[.!?,;:]/g) ?? []).length * 220;
  const perWordMs = 520;
  const tailBufferMs = 1800;

  return Math.max(3000, wordCount * perWordMs + punctuationPauses + tailBufferMs);
}
