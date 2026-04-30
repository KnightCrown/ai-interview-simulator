import { describe, expect, it } from "vitest";
import {
  INTERVIEWER_VOICE_IDS,
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
