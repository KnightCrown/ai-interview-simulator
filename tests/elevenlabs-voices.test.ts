import { describe, expect, it } from "vitest";
import {
  INTERVIEWER_VOICE_IDS,
  avatarPersonaForVoice,
  isAllowedElevenLabsVoiceId,
  pickRandomInterviewerVoiceId,
  voiceSettingsForInterviewDifficulty
} from "@/lib/elevenlabs-voices";

describe("elevenlabs-voices", () => {
  it("pickRandomInterviewerVoiceId returns an allowed id", () => {
    const id = pickRandomInterviewerVoiceId();
    expect(INTERVIEWER_VOICE_IDS).toContain(id);
  });

  it("isAllowedElevenLabsVoiceId accepts configured voices only", () => {
    expect(isAllowedElevenLabsVoiceId(INTERVIEWER_VOICE_IDS[0])).toBe(true);
    expect(isAllowedElevenLabsVoiceId("not-a-real-voice-id")).toBe(false);
  });

  it("voiceSettingsForInterviewDifficulty uses higher stability for Hard", () => {
    expect(voiceSettingsForInterviewDifficulty("Hard")).toEqual({ stability: 0.7, similarity_boost: 0.8 });
    expect(voiceSettingsForInterviewDifficulty("Easy")).toEqual({ stability: 0.3, similarity_boost: 0.8 });
    expect(voiceSettingsForInterviewDifficulty("Medium")).toEqual({ stability: 0.3, similarity_boost: 0.8 });
    expect(voiceSettingsForInterviewDifficulty(undefined)).toEqual({ stability: 0.3, similarity_boost: 0.8 });
  });
});

describe("avatarPersonaForVoice", () => {
  it("maps Joseff voice to jake", () => {
    expect(avatarPersonaForVoice("3TStB8f3X3To0Uj5R7RK")).toBe("jake");
  });

  it("maps the female voice to mia", () => {
    expect(avatarPersonaForVoice("AwMZtPh74zNy5MWrczpG")).toBe("mia");
  });

  it("maps Professional Man voice to clyde", () => {
    expect(avatarPersonaForVoice("k6QSxIIB0qbVljgqTYlJ")).toBe("clyde");
  });

  it("maps Hard Man voice to clyde", () => {
    expect(avatarPersonaForVoice("cX13WrXXGtD1mHd3Anpo")).toBe("clyde");
  });

  it("falls back to jake for unknown voice ids", () => {
    expect(avatarPersonaForVoice("unknown-voice")).toBe("jake");
    expect(avatarPersonaForVoice(null)).toBe("jake");
    expect(avatarPersonaForVoice(undefined)).toBe("jake");
  });

  it("every configured voice ID maps to a known persona", () => {
    const knownPersonas = new Set(["jake", "mia", "clyde"]);
    for (const id of INTERVIEWER_VOICE_IDS) {
      expect(knownPersonas.has(avatarPersonaForVoice(id))).toBe(true);
    }
  });
});
