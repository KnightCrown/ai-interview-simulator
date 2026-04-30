import { describe, expect, it } from "vitest";
import {
  appendQueuedQuestion,
  buildFallbackEvaluation,
  buildFallbackFinalReport,
  buildFallbackQuestion,
  buildSession,
  getNextQueuedQuestionTargetIndex,
  normalizeAnswerEvaluation,
  normalizeFinalReport
} from "@/lib/interview-engine";
import { advanceHiringStage, liveConfidenceFromSignals } from "@/lib/interview-scoring";
import { FaceMetrics, InterviewSession } from "@/lib/interview-types";
import { JOB_ROLES, SAMPLE_RESUME, getRoleExpectations } from "@/lib/sample-data";

function sampleFace(overrides: Partial<FaceMetrics> = {}): FaceMetrics {
  const base: FaceMetrics = {
    eyeContact: 80,
    headStability: 80,
    engagementScore: 80,
    emotion: { happy: 12, sad: 12, nervous: 12, dominant: "neutral" }
  };

  return {
    ...base,
    ...overrides,
    emotion: overrides.emotion ?? base.emotion
  };
}

describe("buildFallbackEvaluation", () => {
  it("surfaces aggressive missed-opportunity details when the transcript omits resume highlights", () => {
    const evaluation = buildFallbackEvaluation({
      role: "Software Engineer",
      transcript: "I worked on a frontend project and improved the user experience for customers.",
      speechMetrics: {
        fillerCount: 1,
        fillerWords: ["um"],
        speakingPace: 120
      },
      faceMetrics: sampleFace({
        headStability: 76,
        engagementScore: 78
      }),
      resume: SAMPLE_RESUME,
      strictness: 60,
      previousWeakAreas: ["Specificity"]
    });

    expect(evaluation.missingResumeHighlights).toContain("JavaScript");
    expect(evaluation.missedOpportunityDetails[0]?.impactScoreIncrease).toBeGreaterThan(0);
    expect(evaluation.interviewerReaction).toContain("specific");
    expect(evaluation.interviewerReaction).toMatch(/^I'm /);
    expect(evaluation.interviewerReaction.toLowerCase()).not.toContain("the interviewer likely");
    expect(evaluation.liveConfidence).toBeGreaterThan(0);
  });
});

describe("buildFallbackQuestion", () => {
  it("adapts hard interview questions to be more rigorous", () => {
    const session = buildSession("Machine Learning Engineer", "Hard", "Skip Resume", null);
    const question = buildFallbackQuestion(session);

    expect(question).toContain("Machine Learning Engineer");
    expect(question.toLowerCase()).toMatch(/challenging|skeptical|evidence|tradeoff|depth/);
  });

  it("can prepare a later fallback question without waiting for previous turns", () => {
    const base = buildSession("Software Engineer", "Medium", "Skip Resume", null);
    const session = {
      ...base,
      turns: [
        {
          id: "t1",
          question: "Q1",
          transcript: "I led the API redesign and cut error rates substantially.",
          durationSeconds: 10,
          speechMetrics: { fillerCount: 0, fillerWords: [], speakingPace: 120 },
          faceMetrics: sampleFace(),
          evaluation: {
            clarity: 70,
            relevance: 70,
            structure: 70,
            confidence: 70,
            engagement: 70,
            liveConfidence: 70,
            feedback: "",
            missedOpportunity: "",
            missingResumeHighlights: [],
            missedOpportunityDetails: [],
            improvedAnswer: "",
            rewriteHighlights: [],
            interviewerReaction: "",
            perceivedTone: "",
            pressureLabel: ""
          }
        }
      ]
    };
    const question = buildFallbackQuestion(session, { targetTurnIndex: 1 });

    expect(question).toContain("tradeoff");
  });

  it("uses a re-ask fallback when the prior answer was empty on a follow-up stage", () => {
    const session = buildSession("Software Engineer", "Medium", "Skip Resume", null);
    const question = buildFallbackQuestion(session, { targetTurnIndex: 1 });

    expect(question).toContain("haven't spoken");
    expect(question).toContain("Software Engineer");
  });

  it("question 4 fallback weaves in feedback from the prior evaluated answer", () => {
    const base = buildSession("Software Engineer", "Medium", "Skip Resume", null);
    const session = {
      ...base,
      turns: [
        {
          id: "t1",
          question: "Q1",
          transcript: "First answer text here.",
          durationSeconds: 10,
          speechMetrics: { fillerCount: 0, fillerWords: [], speakingPace: 120 },
          faceMetrics: sampleFace(),
          evaluation: {
            clarity: 70,
            relevance: 70,
            structure: 70,
            confidence: 70,
            engagement: 70,
            liveConfidence: 70,
            feedback: "Need more metrics from Q1.",
            missedOpportunity: "",
            missingResumeHighlights: [],
            missedOpportunityDetails: [],
            improvedAnswer: "",
            rewriteHighlights: [],
            interviewerReaction: "",
            perceivedTone: "",
            pressureLabel: ""
          }
        },
        {
          id: "t2",
          question: "Q2",
          transcript: "Second answer about tradeoffs.",
          durationSeconds: 10,
          speechMetrics: { fillerCount: 0, fillerWords: [], speakingPace: 120 },
          faceMetrics: sampleFace(),
          evaluation: {
            clarity: 70,
            relevance: 70,
            structure: 70,
            confidence: 70,
            engagement: 70,
            liveConfidence: 70,
            feedback: "Feedback after Q2.",
            missedOpportunity: "",
            missingResumeHighlights: [],
            missedOpportunityDetails: [],
            improvedAnswer: "",
            rewriteHighlights: [],
            interviewerReaction: "",
            perceivedTone: "",
            pressureLabel: ""
          }
        }
      ]
    };

    const question = buildFallbackQuestion(session, { targetTurnIndex: 3 });

    expect(question).toContain("Need more metrics from Q1.");
  });

  it("question 3 fallback remains a fresh question", () => {
    const base = buildSession("Software Engineer", "Medium", "Skip Resume", null);
    const session = {
      ...base,
      turns: [
        {
          id: "t1",
          question: "Q1",
          transcript: "First answer text here.",
          durationSeconds: 10,
          speechMetrics: { fillerCount: 0, fillerWords: [], speakingPace: 120 },
          faceMetrics: sampleFace(),
          evaluation: {
            clarity: 70,
            relevance: 70,
            structure: 70,
            confidence: 70,
            engagement: 70,
            liveConfidence: 70,
            feedback: "Need more metrics from Q1.",
            missedOpportunity: "",
            missingResumeHighlights: [],
            missedOpportunityDetails: [],
            improvedAnswer: "",
            rewriteHighlights: [],
            interviewerReaction: "",
            perceivedTone: "",
            pressureLabel: ""
          }
        },
        {
          id: "t2",
          question: "Q2",
          transcript: "Second answer about tradeoffs.",
          durationSeconds: 10,
          speechMetrics: { fillerCount: 0, fillerWords: [], speakingPace: 120 },
          faceMetrics: sampleFace(),
          evaluation: {
            clarity: 70,
            relevance: 70,
            structure: 70,
            confidence: 70,
            engagement: 70,
            liveConfidence: 70,
            feedback: "Feedback after Q2.",
            missedOpportunity: "",
            missingResumeHighlights: [],
            missedOpportunityDetails: [],
            improvedAnswer: "",
            rewriteHighlights: [],
            interviewerReaction: "",
            perceivedTone: "",
            pressureLabel: ""
          }
        }
      ]
    };

    const question = buildFallbackQuestion(session, { targetTurnIndex: 2 });

    expect(question).not.toContain("Earlier you mentioned");
    expect(question).not.toContain("Need more metrics from Q1.");
  });
});

describe("parallel-path placeholder evaluation", () => {
  // The /api/interview/answer route runs evaluateAnswer and generateQuestion in
  // parallel; while evaluation is still in flight, the optimistic session passed
  // to generateQuestion contains a "placeholder" turn whose evaluation has empty
  // strings and neutral scores. The fallback question generator must still
  // produce a substantive next question from this shape.
  const PLACEHOLDER_EVAL = {
    clarity: 50,
    relevance: 50,
    structure: 50,
    confidence: 50,
    engagement: 50,
    liveConfidence: 50,
    feedback: "",
    missedOpportunity: "",
    missingResumeHighlights: [] as string[],
    missedOpportunityDetails: [] as never[],
    improvedAnswer: "",
    rewriteHighlights: [] as string[],
    interviewerReaction: "",
    perceivedTone: "",
    pressureLabel: ""
  };

  it("produces a valid follow-up question when the latest turn carries a placeholder evaluation", () => {
    const base = buildSession("Software Engineer", "Medium", "Skip Resume", null);
    const session = {
      ...base,
      turns: [
        {
          id: "inflight-1",
          question: "Tell me about a project.",
          transcript: "I led the API redesign and cut error rates by 30 percent across the platform.",
          durationSeconds: 22,
          speechMetrics: { fillerCount: 1, fillerWords: ["um"], speakingPace: 128 },
          faceMetrics: sampleFace(),
          evaluation: PLACEHOLDER_EVAL
        }
      ]
    };

    const question = buildFallbackQuestion(session, { targetTurnIndex: 1 });

    expect(question).toContain("tradeoff");
    expect(question.length).toBeGreaterThan(20);
    expect(question).not.toContain("haven't spoken");
  });

  it("produces a valid fresh-stage question when the prior turn carries a placeholder evaluation", () => {
    const base = buildSession("Software Engineer", "Medium", "Skip Resume", null);
    const session = {
      ...base,
      turns: [
        {
          id: "t1",
          question: "Q1",
          transcript: "First answer.",
          durationSeconds: 12,
          speechMetrics: { fillerCount: 0, fillerWords: [], speakingPace: 120 },
          faceMetrics: sampleFace(),
          evaluation: { ...PLACEHOLDER_EVAL, feedback: "real feedback for prior", relevance: 70 }
        },
        {
          id: "inflight-2",
          question: "Q2",
          transcript: "I owned the migration plan, sequenced rollout, and coordinated three teams.",
          durationSeconds: 30,
          speechMetrics: { fillerCount: 0, fillerWords: [], speakingPace: 130 },
          faceMetrics: sampleFace(),
          evaluation: PLACEHOLDER_EVAL
        }
      ]
    };

    const question = buildFallbackQuestion(session, { targetTurnIndex: 2 });

    expect(question).toMatch(/Software Engineer|slipping|recover/);
    expect(question.length).toBeGreaterThan(20);
  });
});

describe("question queue helpers", () => {
  it("starts sessions with an empty predictive question queue", () => {
    const session = buildSession("Software Engineer", "Medium", "Skip Resume", null);

    expect(session.questionQueue).toEqual([]);
  });

  it("targets the next background question after the active question and queued items", () => {
    const session = {
      ...buildSession("Software Engineer", "Medium", "Skip Resume", null),
      currentQuestion: "Question 1",
      questionQueue: ["Question 2"]
    };

    expect(getNextQueuedQuestionTargetIndex(session)).toBe(2);
  });

  it("deduplicates queued questions against the active question", () => {
    const session = {
      ...buildSession("Software Engineer", "Medium", "Skip Resume", null),
      currentQuestion: "Question 1"
    };

    expect(appendQueuedQuestion(session, "Question 1").questionQueue).toEqual([]);
    expect(appendQueuedQuestion(session, "Question 2").questionQueue).toEqual(["Question 2"]);
  });
});

describe("custom roles", () => {
  it("keeps Other available while offering IT role presets", () => {
    expect(JOB_ROLES).toContain("Other");
    expect(JOB_ROLES).toContain("IT Support Specialist");
    expect(JOB_ROLES).toContain("Cybersecurity Analyst");
    expect(JOB_ROLES).toContain("Cloud Engineer");
  });

  it("uses default role signals for custom roles", () => {
    expect(getRoleExpectations("Healthcare Data Scientist")).toContain("role-specific examples");
  });

  it("supports evaluating typed roles that are not in the preset list", () => {
    const evaluation = buildFallbackEvaluation({
      role: "Robotics Program Manager",
      transcript: "I owned a cross-functional launch, aligned stakeholders, and improved delivery by 20 percent.",
      speechMetrics: {
        fillerCount: 0,
        fillerWords: [],
        speakingPace: 130
      },
      faceMetrics: sampleFace({
        eyeContact: 82,
        headStability: 80,
        engagementScore: 84
      }),
      resume: null
    });

    expect(evaluation.relevance).toBeGreaterThan(0);
    expect(evaluation.feedback).toContain("Robotics Program Manager");
  });
});

describe("LLM response normalization", () => {
  it("coerces malformed evaluation list fields into render-safe arrays", () => {
    const fallback = buildFallbackEvaluation({
      role: "Software Engineer",
      transcript: "I built a React dashboard and improved performance by 30 percent.",
      speechMetrics: {
        fillerCount: 0,
        fillerWords: [],
        speakingPace: 130
      },
      faceMetrics: sampleFace({
        headStability: 78,
        engagementScore: 82
      }),
      resume: SAMPLE_RESUME
    });

    const evaluation = normalizeAnswerEvaluation(
      {
        clarity: "87" as unknown as number,
        rewriteHighlights: "Added clearer impact and role alignment." as unknown as string[],
        missingResumeHighlights: "Python" as unknown as string[],
        missedOpportunityDetails: "Mention backend credibility." as unknown as typeof fallback.missedOpportunityDetails
      },
      fallback
    );

    expect(evaluation.clarity).toBe(87);
    expect(evaluation.rewriteHighlights).toEqual(["Added clearer impact and role alignment."]);
    expect(evaluation.missingResumeHighlights).toEqual(["Python"]);
    expect(Array.isArray(evaluation.missedOpportunityDetails)).toBe(true);
  });

  it("coerces malformed final report list fields into render-safe arrays", () => {
    const fallback = buildFallbackFinalReport(buildSession("Software Engineer", "Medium", "Skip Resume", null));
    const report = normalizeFinalReport(
      {
        strengths: "Clear communication" as unknown as string[],
        interviewerNotes: "Needs more metrics" as unknown as string[],
        overallScore: "70" as unknown as number
      },
      fallback
    );

    expect(report.overallScore).toBe(70);
    expect(report.strengths).toEqual(["Clear communication"]);
    expect(report.interviewerNotes).toEqual(["Needs more metrics"]);
  });
});

describe("liveConfidenceFromSignals", () => {
  it("returns a stronger score for balanced pace and high engagement", () => {
    const score = liveConfidenceFromSignals({
      role: "Software Engineer",
      transcript: "Situation task action result. I built a React dashboard and improved performance by 30 percent.",
      speechMetrics: {
        fillerCount: 0,
        fillerWords: [],
        speakingPace: 128
      },
      faceMetrics: sampleFace({
        eyeContact: 86,
        headStability: 82,
        engagementScore: 84
      })
    });

    expect(score).toBeGreaterThan(70);
  });
});

describe("advanceHiringStage", () => {
  it("moves the user forward on strong answers", () => {
    expect(advanceHiringStage("Phone Screen", 82)).toBe("Technical Round");
  });
});

describe("buildFallbackFinalReport", () => {
  it("produces a recruiter-style report with emotional summary and outcome", () => {
    const session: InterviewSession = {
      id: "session-1",
      role: "Software Engineer",
      difficulty: "Medium",
      resumeMode: "Use Sample Resume",
      resume: SAMPLE_RESUME,
      startedAt: new Date().toISOString(),
      currentQuestion: null,
      questionQueue: [],
      interviewComplete: true,
      currentStage: "Final Round",
      hiringOutcome: "Selected",
      liveConfidence: 79,
      memory: {
        strengthSignals: ["Role alignment", "Structured storytelling"],
        weakAreas: ["Specificity"],
        missingResumePoints: ["Python"],
        toneSummary: "Clear communicator with improving depth",
        strictness: 68,
        interviewerMood: "Professional and observant"
      },
      turns: [
        {
          id: "turn-1",
          question: "Tell me about a project.",
          transcript: "I built a dashboard in React and improved performance by 30 percent.",
          durationSeconds: 45,
          speechMetrics: { fillerCount: 0, fillerWords: [], speakingPace: 118 },
          faceMetrics: sampleFace({ headStability: 78, engagementScore: 79 }),
          evaluation: {
            clarity: 82,
            relevance: 84,
            structure: 76,
            confidence: 80,
            engagement: 79,
            liveConfidence: 81,
            feedback: "Strong answer.",
            missedOpportunity: "Could quantify ownership more.",
            missingResumeHighlights: ["Python"],
            missedOpportunityDetails: [
              {
                exactThing: "You should have explicitly mentioned Python.",
                source: "Alex Johnson's resume",
                whyItMattered: "It strengthens backend credibility.",
                impactScoreIncrease: 14
              }
            ],
            improvedAnswer: "Lead with context and impact.",
            rewriteHighlights: ["add clearer ownership", "add stronger metric"],
            interviewerReaction: "That's interesting. Let's go deeper.",
            perceivedTone: "Clear communicator with improving depth",
            pressureLabel: "Calm under pressure"
          }
        }
      ]
    };

    const report = buildFallbackFinalReport(session);

    expect(report.overallScore).toBeGreaterThan(70);
    expect(report.hiringOutcome).toBe("Selected");
    expect(report.emotionalSummary.length).toBeGreaterThan(10);
    expect(report.interviewerNotes.length).toBeGreaterThan(0);
  });
});
