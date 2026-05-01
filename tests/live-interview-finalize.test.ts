import { describe, expect, it } from "vitest";
import {
  candidateTextFromFormattedLiveTranscript,
  formatLiveConversationForFinalize,
  hasSubstantiveLiveConversationTranscript
} from "@/lib/live-interview-finalize";

describe("formatLiveConversationForFinalize", () => {
  it("labels roles and optional avatar classifications", () => {
    const text = formatLiveConversationForFinalize([
      { role: "avatar", text: "Hello?", classification: "next_main_question" },
      { role: "user", text: "I shipped the API rewrite." }
    ]);
    expect(text).toContain("Interviewer [next_main_question]: Hello?");
    expect(text).toContain("Candidate: I shipped the API rewrite.");
  });
});

describe("candidateTextFromFormattedLiveTranscript", () => {
  it("concatenates candidate blocks only", () => {
    const formatted = "Interviewer: Q1?\n\nCandidate: First bit.\n\nInterviewer: Follow-up?\n\nCandidate: Second bit.";
    expect(candidateTextFromFormattedLiveTranscript(formatted)).toBe("First bit. Second bit.");
  });
});

describe("hasSubstantiveLiveConversationTranscript", () => {
  it("is false for empty or trivial candidate text", () => {
    expect(hasSubstantiveLiveConversationTranscript(undefined)).toBe(false);
    expect(hasSubstantiveLiveConversationTranscript("Interviewer: Hi")).toBe(false);
    expect(hasSubstantiveLiveConversationTranscript("Candidate: a")).toBe(false);
  });

  it("is true when candidate blocks contain substantive speech", () => {
    const formatted = formatLiveConversationForFinalize([
      { role: "avatar", text: "Tell me about a project." },
      {
        role: "user",
        text: "I led the billing migration reducing errors from two percent to zero point two."
      }
    ]);
    expect(hasSubstantiveLiveConversationTranscript(formatted)).toBe(true);
  });
});
