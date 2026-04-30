import type { InterviewDifficulty } from "./interview-types";

/** Voice IDs used for the interviewer; one is chosen randomly when an interview session starts. */
export const INTERVIEWER_VOICE_IDS = [
  "3TStB8f3X3To0Uj5R7RK", // Joseff
  "AwMZtPh74zNy5MWrczpG", // Female interviewer — Cheery
  "k6QSxIIB0qbVljgqTYlJ", // Professional Man
  "cX13WrXXGtD1mHd3Anpo" // Hard Man
] as const;

export type InterviewerVoiceId = (typeof INTERVIEWER_VOICE_IDS)[number];

export function pickRandomInterviewerVoiceId(): string {
  const index = Math.floor(Math.random() * INTERVIEWER_VOICE_IDS.length);
  return INTERVIEWER_VOICE_IDS[index];
}

export function isAllowedElevenLabsVoiceId(id: string): id is InterviewerVoiceId {
  return (INTERVIEWER_VOICE_IDS as readonly string[]).includes(id);
}

export function voiceSettingsForInterviewDifficulty(
  difficulty: InterviewDifficulty | null | undefined
): { stability: number; similarity_boost: number } {
  return {
    stability: difficulty === "Hard" ? 0.7 : 0.3,
    similarity_boost: 0.8
  };
}
