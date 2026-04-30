import type { InterviewDifficulty } from "./interview-types";

/** Voice IDs used for the interviewer; one is chosen randomly when an interview session starts. */
export const INTERVIEWER_VOICE_IDS = [
  "3TStB8f3X3To0Uj5R7RK", // Joseff
  "AwMZtPh74zNy5MWrczpG", // Female interviewer — Cheery
  "k6QSxIIB0qbVljgqTYlJ", // Professional Man
  "cX13WrXXGtD1mHd3Anpo" // Hard Man
] as const;

/** Avatar identifiers that each have a mouth-closed and a mouth-open image in public/avatar/. */
export type AvatarPersona = "jake" | "mia" | "clyde";

/**
 * Maps each ElevenLabs voice ID to the avatar persona whose images should be
 * displayed while that voice is speaking.
 *
 * Assignment rationale:
 *   jake  — Joseff (male, conversational)
 *   mia   — Female Cheery (the only female voice)
 *   clyde — Professional Man + Hard Man (covers the remaining two male voices)
 */
export const VOICE_AVATAR_MAP: Record<string, AvatarPersona> = {
  "3TStB8f3X3To0Uj5R7RK": "jake",  // Joseff
  "AwMZtPh74zNy5MWrczpG": "mia",   // Female — Cheery
  "k6QSxIIB0qbVljgqTYlJ": "clyde", // Professional Man
  "cX13WrXXGtD1mHd3Anpo": "clyde"  // Hard Man
};

/** Returns the avatar persona for the given voice ID, falling back to "jake" if unknown. */
export function avatarPersonaForVoice(voiceId: string | null | undefined): AvatarPersona {
  if (voiceId && voiceId in VOICE_AVATAR_MAP) {
    return VOICE_AVATAR_MAP[voiceId];
  }
  return "jake";
}

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
