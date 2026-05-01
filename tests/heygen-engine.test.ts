import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAIN_QUESTION_CAP,
  buildOrchestratorPrompt,
  decideNextUtterance,
  runConversationTurn
} from "@/lib/heygen-engine";
import { buildSession } from "@/lib/interview-engine";
import {
  CandidateMoodSnapshot,
  FaceMetrics,
  InterviewSession,
  SpeechMetrics
} from "@/lib/interview-types";
import { ConversationLogEntry } from "@/lib/heygen-types";

const SAMPLE_FACE: FaceMetrics = {
  eyeContact: 80,
  headStability: 80,
  engagementScore: 80,
  emotion: { happy: 12, sad: 12, nervous: 12, neutral: 76, dominant: "neutral" }
};

const SAMPLE_SPEECH: SpeechMetrics = {
  fillerCount: 1,
  fillerWords: ["um"],
  speakingPace: 130
};

const SAMPLE_MOOD: CandidateMoodSnapshot = {
  dominant: "neutral",
  averages: { happy: 10, sad: 10, nervous: 10, neutral: 70 },
  framesSampled: 4
};

function freshSession(): InterviewSession {
  return buildSession("Software Developer", "Medium", "Skip Resume", null);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildOrchestratorPrompt", () => {
  it("includes the role, difficulty, current main question, and the 3-question cap budget", () => {
    const session = freshSession();
    const prompt = buildOrchestratorPrompt({
      session,
      conversationLog: [],
      latestUserUtterance: "I worked on a payments system.",
      currentMainQuestion: "Walk me through a project you led.",
      mainQuestionsAsked: 1,
      cumulativeAnswerTranscript: "I worked on a payments system."
    });

    expect(prompt).toContain("Software Developer");
    expect(prompt).toContain("Medium");
    expect(prompt).toContain("Walk me through a project you led.");
    // The cap should be communicated to the LLM so it knows when to wrap up.
    expect(prompt).toContain(`${MAIN_QUESTION_CAP}`);
    expect(prompt).toContain("isQuestionComplete");
    expect(prompt).toContain("classification");
  });
});

describe("decideNextUtterance", () => {
  it("falls back deterministically to follow_up when the LLM returns nothing", async () => {
    const session = freshSession();
    const decision = await decideNextUtterance(
      {
        session,
        conversationLog: [],
        latestUserUtterance: "yeah",
        mainQuestionsAsked: 1,
        currentMainQuestion: "Walk me through a project you led.",
        cumulativeAnswerTranscript: "yeah"
      },
      async () => null
    );

    expect(decision.classification).toBe("follow_up");
    expect(decision.isQuestionComplete).toBe(false);
    expect(decision.followUpText.length).toBeGreaterThan(0);
  });

  it("falls back to next_main_question when the cumulative answer is substantive and we are below the cap", async () => {
    const session = freshSession();
    const cumulative =
      "I led a payments project where we cut error rates from 1.4 percent to 0.2 percent over six months by " +
      "rewriting the retry layer and adding idempotency keys. I owned the design and shipped the rollout to " +
      "production. The biggest tradeoff was speed versus blast radius and we erred on the safe side.";

    const decision = await decideNextUtterance(
      {
        session,
        conversationLog: [],
        latestUserUtterance: cumulative,
        mainQuestionsAsked: 1,
        currentMainQuestion: "Walk me through a project you led.",
        cumulativeAnswerTranscript: cumulative
      },
      async () => null
    );

    expect(decision.classification).toBe("next_main_question");
    expect(decision.isQuestionComplete).toBe(true);
  });

  it("forces wrap_up when at the cap, even if the LLM returns next_main_question", async () => {
    const session = freshSession();
    const llm = vi.fn(async () =>
      JSON.stringify({
        isQuestionComplete: true,
        classification: "next_main_question",
        transitionPhrase: "Got it.",
        followUpText: "",
        wrapUpText: ""
      })
    );

    const decision = await decideNextUtterance(
      {
        session,
        conversationLog: [],
        latestUserUtterance: "And that is the impact I drove.",
        mainQuestionsAsked: MAIN_QUESTION_CAP,
        currentMainQuestion: "Last main question.",
        cumulativeAnswerTranscript: "And that is the impact I drove."
      },
      llm
    );

    expect(decision.classification).toBe("wrap_up");
    expect(decision.isQuestionComplete).toBe(true);
    expect(llm).toHaveBeenCalledOnce();
  });

  it("forces next_main_question when the LLM tries to wrap up too early", async () => {
    const session = freshSession();
    const llm = vi.fn(async () =>
      JSON.stringify({
        isQuestionComplete: true,
        classification: "wrap_up",
        transitionPhrase: "Thanks.",
        followUpText: "",
        wrapUpText: "We'll be in touch."
      })
    );

    const decision = await decideNextUtterance(
      {
        session,
        conversationLog: [],
        latestUserUtterance: "I drove 30% growth.",
        mainQuestionsAsked: 1,
        currentMainQuestion: "Walk me through a project.",
        cumulativeAnswerTranscript: "I drove 30% growth."
      },
      llm
    );

    expect(decision.classification).toBe("next_main_question");
    expect(decision.isQuestionComplete).toBe(true);
  });

  it("treats follow_up as not complete even if LLM marks it complete", async () => {
    const session = freshSession();
    const llm = vi.fn(async () =>
      JSON.stringify({
        isQuestionComplete: true,
        classification: "follow_up",
        transitionPhrase: "",
        followUpText: "Could you give a specific example?",
        wrapUpText: ""
      })
    );

    const decision = await decideNextUtterance(
      {
        session,
        conversationLog: [],
        latestUserUtterance: "Sort of.",
        mainQuestionsAsked: 0,
        currentMainQuestion: "Walk me through a project.",
        cumulativeAnswerTranscript: "Sort of."
      },
      llm
    );

    expect(decision.classification).toBe("follow_up");
    expect(decision.isQuestionComplete).toBe(false);
  });
});

describe("runConversationTurn", () => {
  it("on isStart, returns a greeting + first main question without calling the LLM runner", async () => {
    const session = freshSession();
    const llm = vi.fn(async () => null);

    const decision = await runConversationTurn({
      session,
      conversationLog: [],
      latestUserUtterance: "",
      mainQuestionsAsked: 0,
      currentMainQuestion: null,
      isStart: true,
      cumulativeAnswerTranscript: "",
      durationSeconds: 0,
      speechMetrics: SAMPLE_SPEECH,
      faceMetrics: SAMPLE_FACE,
      candidateMood: SAMPLE_MOOD,
      runLLM: llm
    });

    expect(decision.classification).toBe("next_main_question");
    expect(decision.isQuestionComplete).toBe(false);
    expect(decision.shouldEndInterview).toBe(false);
    expect(decision.replyText.length).toBeGreaterThan(20);
    // Greeting branch must reuse the existing question generator (which falls
    // back to a deterministic template without an OpenAI key) rather than the
    // orchestrator's LLM runner.
    expect(llm).not.toHaveBeenCalled();
    const lower = decision.replyText.toLowerCase();
    expect(lower).toContain("hello");
    expect(lower).toContain("interviewer");
    expect(lower).toContain("let's get started");
  });

  it("on a thin user utterance, returns a follow_up that does not score a turn", async () => {
    const session = freshSession();
    const conversationLog: ConversationLogEntry[] = [
      { role: "avatar", text: "Walk me through a project.", timestamp: 1, classification: "next_main_question" },
      { role: "user", text: "yeah", timestamp: 2 }
    ];

    const decision = await runConversationTurn({
      session,
      conversationLog,
      latestUserUtterance: "yeah",
      mainQuestionsAsked: 1,
      currentMainQuestion: "Walk me through a project.",
      isStart: false,
      cumulativeAnswerTranscript: "yeah",
      durationSeconds: 3,
      speechMetrics: SAMPLE_SPEECH,
      faceMetrics: SAMPLE_FACE,
      candidateMood: SAMPLE_MOOD,
      runLLM: async () => null
    });

    expect(decision.classification).toBe("follow_up");
    expect(decision.isQuestionComplete).toBe(false);
    expect(decision.shouldEndInterview).toBe(false);
    expect(decision.evaluation).toBeUndefined();
    expect(decision.session).toBeUndefined();
    expect(decision.replyText.length).toBeGreaterThan(0);
  });

  it("on a substantive answer below the cap, scores the turn and asks the next main question", async () => {
    const session = freshSession();
    const cumulative =
      "I owned a customer onboarding redesign that cut activation drop-off from 38 percent to 19 percent in two " +
      "quarters by rewriting the empty-state flow, adding contextual help, and shipping an in-app upgrade nudge. " +
      "I led a four-person team and presented the plan to the head of product weekly.";

    const decision = await runConversationTurn({
      session,
      conversationLog: [],
      latestUserUtterance: cumulative,
      mainQuestionsAsked: 1,
      currentMainQuestion: "Walk me through a project you led.",
      isStart: false,
      cumulativeAnswerTranscript: cumulative,
      durationSeconds: 35,
      speechMetrics: SAMPLE_SPEECH,
      faceMetrics: SAMPLE_FACE,
      candidateMood: SAMPLE_MOOD,
      runLLM: async () => null
    });

    expect(decision.classification).toBe("next_main_question");
    expect(decision.isQuestionComplete).toBe(true);
    expect(decision.shouldEndInterview).toBe(false);
    expect(decision.evaluation).toBeTruthy();
    expect(decision.session).toBeTruthy();
    // The orchestrator must have appended exactly one new turn to the session.
    expect(decision.session?.turns.length).toBe(1);
    expect(decision.session?.turns[0]?.transcript).toBe(cumulative);
    // The reply must include both an acknowledgement transition AND a next question.
    expect(decision.replyText.length).toBeGreaterThan(20);
  });

  it("at the cap, scores the final turn and signals shouldEndInterview", async () => {
    const session = freshSession();
    const cumulative =
      "I would point to the migration project where we moved 14 services off legacy queues, dropped p99 latency by " +
      "47 percent, and avoided a six-figure quarterly compute bill. I led the design review and on-call rotation.";

    const decision = await runConversationTurn({
      session,
      conversationLog: [],
      latestUserUtterance: cumulative,
      mainQuestionsAsked: MAIN_QUESTION_CAP,
      currentMainQuestion: "Why should we move you forward?",
      isStart: false,
      cumulativeAnswerTranscript: cumulative,
      durationSeconds: 40,
      speechMetrics: SAMPLE_SPEECH,
      faceMetrics: SAMPLE_FACE,
      candidateMood: SAMPLE_MOOD,
      runLLM: async () => null
    });

    expect(decision.classification).toBe("wrap_up");
    expect(decision.isQuestionComplete).toBe(true);
    expect(decision.shouldEndInterview).toBe(true);
    expect(decision.evaluation).toBeTruthy();
    expect(decision.session?.turns.length).toBe(1);
    expect(decision.replyText.length).toBeGreaterThan(0);
  });
});
