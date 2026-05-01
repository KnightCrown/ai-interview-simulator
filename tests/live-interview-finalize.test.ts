import { describe, expect, it } from "vitest";
import {
  candidateTextFromFormattedLiveTranscript,
  formatLiveConversationForFinalize,
  hasSubstantiveLiveConversationTranscript,
  parseLiveConversationTranscript,
  segmentLiveTranscriptByMainQuestion
} from "@/lib/live-interview-finalize";

describe("parseLiveConversationTranscript", () => {
  it("returns empty for undefined or blank", () => {
    expect(parseLiveConversationTranscript(undefined)).toEqual([]);
    expect(parseLiveConversationTranscript("   ")).toEqual([]);
  });

  it("round-trips with formatLiveConversationForFinalize", () => {
    const formatted = formatLiveConversationForFinalize([
      { role: "avatar", text: "Hello?", classification: "next_main_question" },
      { role: "user", text: "I shipped the API." },
      { role: "avatar", text: "Outcome?", classification: "follow_up" }
    ]);
    expect(parseLiveConversationTranscript(formatted)).toEqual([
      { role: "interviewer", classification: "next_main_question", text: "Hello?" },
      { role: "candidate", text: "I shipped the API." },
      { role: "interviewer", classification: "follow_up", text: "Outcome?" }
    ]);
  });
});

describe("segmentLiveTranscriptByMainQuestion", () => {
  it("puts all messages in question 1 when there are no next_main_question tags", () => {
    const messages = parseLiveConversationTranscript(
      formatLiveConversationForFinalize([
        { role: "avatar", text: "Hi", classification: "greeting" },
        { role: "user", text: "Hello" }
      ])
    );
    const [q1, q2, q3] = segmentLiveTranscriptByMainQuestion(messages);
    expect(q1).toEqual(messages);
    expect(q2).toEqual([]);
    expect(q3).toEqual([]);
  });

  it("splits on second and third next_main_question boundaries", () => {
    const formatted = formatLiveConversationForFinalize([
      { role: "avatar", text: "Greet", classification: "greeting" },
      { role: "avatar", text: "Q1 body", classification: "next_main_question" },
      { role: "user", text: "A1" },
      { role: "avatar", text: "Q2 body", classification: "next_main_question" },
      { role: "user", text: "A2" },
      { role: "avatar", text: "Q3 body", classification: "next_main_question" },
      { role: "user", text: "A3" },
      { role: "avatar", text: "Bye", classification: "wrap_up" }
    ]);
    const messages = parseLiveConversationTranscript(formatted);
    const [q1, q2, q3] = segmentLiveTranscriptByMainQuestion(messages);
    expect(q1.map((m) => m.text)).toEqual(["Greet", "Q1 body", "A1"]);
    expect(q2.map((m) => m.text)).toEqual(["Q2 body", "A2"]);
    expect(q3.map((m) => m.text)).toEqual(["Q3 body", "A3", "Bye"]);
  });

  it("with only one main question boundary, only question 1 has content", () => {
    const formatted = formatLiveConversationForFinalize([
      { role: "avatar", text: "Only main", classification: "next_main_question" },
      { role: "user", text: "Ans" }
    ]);
    const messages = parseLiveConversationTranscript(formatted);
    const [q1, q2, q3] = segmentLiveTranscriptByMainQuestion(messages);
    expect(q1).toEqual(messages);
    expect(q2).toEqual([]);
    expect(q3).toEqual([]);
  });

  it("with two boundaries, question 3 is empty", () => {
    const formatted = formatLiveConversationForFinalize([
      { role: "avatar", text: "M1", classification: "next_main_question" },
      { role: "user", text: "u1" },
      { role: "avatar", text: "M2", classification: "next_main_question" },
      { role: "user", text: "u2" }
    ]);
    const messages = parseLiveConversationTranscript(formatted);
    const [q1, q2, q3] = segmentLiveTranscriptByMainQuestion(messages);
    expect(q1.map((m) => m.text)).toEqual(["M1", "u1"]);
    expect(q2.map((m) => m.text)).toEqual(["M2", "u2"]);
    expect(q3).toEqual([]);
  });
});

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
