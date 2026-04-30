import { describe, expect, it } from "vitest";
import {
  MAX_SLOTS,
  appendQueuedQuestion,
  buildBaseSchedule,
  buildFallbackEvaluation,
  buildFallbackFinalReport,
  buildFallbackQuestion,
  buildSession,
  getNextQueuedQuestionTargetIndex,
  getReaskedSlotIndices,
  normalizeAnswerEvaluation,
  normalizeFinalReport,
  transformScheduleForEmptyAnswer
} from "@/lib/interview-engine";
import { advanceHiringStage, liveConfidenceFromSignals } from "@/lib/interview-scoring";
import { FaceMetrics, InterviewSession, ScheduleSlot } from "@/lib/interview-types";
import { JOB_ROLES, SAMPLE_RESUME, getRoleExpectations } from "@/lib/sample-data";

function sampleFace(overrides: Partial<FaceMetrics> = {}): FaceMetrics {
  const base: FaceMetrics = {
    eyeContact: 80,
    headStability: 80,
    engagementScore: 80,
    emotion: { happy: 12, sad: 12, nervous: 12, neutral: 76, dominant: "neutral" }
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
    // The reaction should be in first-person and feel like a real interviewer's
    // running thought — not a detached, third-person commentary template.
    expect(evaluation.interviewerReaction).toBeTruthy();
    const reaction = evaluation.interviewerReaction.toLowerCase();
    expect(reaction).not.toContain("the interviewer likely");
    expect(reaction).not.toContain("the interviewer would");
    expect(reaction).not.toContain("the candidate");
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

  it("uses a re-ask fallback when the followed slot's answer was empty on a follow-up stage", () => {
    // Slot 2 in the base schedule is { kind: "follow-up", followsSlotIndex: 0 }.
    // If turn[0] has no substantive answer, the fallback should call that out.
    const base = buildSession("Software Engineer", "Medium", "Skip Resume", null);
    const session: InterviewSession = {
      ...base,
      turns: [
        {
          id: "t1",
          question: "Q1",
          transcript: "",
          durationSeconds: 5,
          speechMetrics: { fillerCount: 0, fillerWords: [], speakingPace: 120 },
          faceMetrics: sampleFace(),
          evaluation: {
            clarity: 50,
            relevance: 50,
            structure: 50,
            confidence: 50,
            engagement: 50,
            liveConfidence: 50,
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
    const question = buildFallbackQuestion(session, { targetTurnIndex: 2 });

    expect(question).toContain("haven't spoken");
    expect(question).toContain("Software Engineer");
  });

  it("question 4 fallback (follow-up to slot 1) weaves in the followed turn's feedback", () => {
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

    // Slot 3 is now { kind: "follow-up", followsSlotIndex: 1 }, so the fallback
    // should pull feedback from turn[1] (Q2), not the legacy turns.length-2 hack.
    expect(question).toContain("Feedback after Q2.");
  });

  it("question 5 (final 'new' slot) remains a fresh question, not a follow-up", () => {
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

    const question = buildFallbackQuestion(session, { targetTurnIndex: 4 });

    // Slot 4 is { kind: "new" }, so it should not splice in any prior-feedback tail.
    expect(question).not.toContain("Earlier you mentioned");
    expect(question).not.toContain("Need more metrics from Q1.");
    expect(question).not.toContain("Feedback after Q2.");
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

  it("produces a valid follow-up question when the followed turn carries a placeholder evaluation", () => {
    // Slot 2 is { kind: "follow-up", followsSlotIndex: 0 }. Even when turn[0]'s
    // evaluation is still the parallel-path placeholder (empty strings, neutral
    // scores), the follow-up fallback must produce a real question grounded in
    // the role.
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

    const question = buildFallbackQuestion(session, { targetTurnIndex: 2 });

    expect(question).toContain("Software Engineer");
    expect(question.length).toBeGreaterThan(20);
    expect(question).not.toContain("haven't spoken");
  });

  it("produces a valid fresh closing-stage question regardless of placeholder evaluations earlier in the run", () => {
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

    // Slot 4 is the final { kind: "new" } closing slot in the base schedule.
    const question = buildFallbackQuestion(session, { targetTurnIndex: 4 });

    expect(question).toMatch(/Software Engineer|next round|hiring/);
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
  it("returns empty strengths and weaknesses when the session has no turns", () => {
    const session = buildSession("Software Engineer", "Medium", "Skip Resume", null);

    const report = buildFallbackFinalReport(session);

    expect(report.strengths).toEqual([]);
    expect(report.strengthDescriptions).toEqual([]);
    expect(report.weaknesses).toEqual([]);
    expect(report.weaknessDescriptions).toEqual([]);
    expect(report.overallScore).toBe(0);
    expect(report.hiringOutcome).toBe("Rejected");
    expect(report.missedOpportunitySummary).toMatch(/no interview answers/i);
  });

  it("returns empty strengths and weaknesses when every turn has a non-substantive transcript", () => {
    const session = buildSession("Software Engineer", "Medium", "Skip Resume", null);
    session.turns = [
      {
        id: "turn-empty",
        question: "Tell me about a project.",
        transcript: "   ",
        durationSeconds: 0,
        speechMetrics: { fillerCount: 0, fillerWords: [], speakingPace: 0 },
        faceMetrics: sampleFace(),
        evaluation: {
          clarity: 0,
          relevance: 0,
          structure: 0,
          confidence: 0,
          engagement: 0,
          liveConfidence: 0,
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
    ];

    const report = buildFallbackFinalReport(session);

    expect(report.strengths).toEqual([]);
    expect(report.weaknesses).toEqual([]);
    expect(report.overallScore).toBe(0);
  });

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
      schedule: [],
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

describe("buildBaseSchedule", () => {
  it("returns the canonical 5-slot schedule [new, new, fu→0, fu→1, new]", () => {
    const schedule = buildBaseSchedule();
    expect(schedule).toHaveLength(5);
    expect(schedule[0].kind).toEqual({ kind: "new" });
    expect(schedule[1].kind).toEqual({ kind: "new" });
    expect(schedule[2].kind).toEqual({ kind: "follow-up", followsSlotIndex: 0 });
    expect(schedule[3].kind).toEqual({ kind: "follow-up", followsSlotIndex: 1 });
    expect(schedule[4].kind).toEqual({ kind: "new" });
    schedule.forEach((slot, idx) => {
      expect(slot.index).toBe(idx);
      expect(slot.question).toBeNull();
    });
  });
});

describe("transformScheduleForEmptyAnswer", () => {
  // Helper to compare schedules by kind and follow/reask targets only — index
  // numbers are re-assigned by the transform and shouldn't be brittle in tests.
  function shape(schedule: ScheduleSlot[]) {
    return schedule.map((slot) => slot.kind);
  }

  it("Empty Q2: removes fu→1, inserts reask→1 after slot 1, appends fu→1", () => {
    const result = transformScheduleForEmptyAnswer(buildBaseSchedule(), 1);
    expect(shape(result)).toEqual([
      { kind: "new" },
      { kind: "new" },
      { kind: "re-ask", reasksSlotIndex: 1 },
      { kind: "follow-up", followsSlotIndex: 0 },
      { kind: "new" },
      { kind: "follow-up", followsSlotIndex: 1 }
    ]);
    expect(result).toHaveLength(6);
    result.forEach((slot, idx) => expect(slot.index).toBe(idx));
  });

  it("Empty Q1: removes fu→0, inserts reask→0 after slot 0, appends fu→0", () => {
    const result = transformScheduleForEmptyAnswer(buildBaseSchedule(), 0);
    expect(shape(result)).toEqual([
      { kind: "new" },
      { kind: "re-ask", reasksSlotIndex: 0 },
      { kind: "new" },
      { kind: "follow-up", followsSlotIndex: 1 },
      { kind: "new" },
      { kind: "follow-up", followsSlotIndex: 0 }
    ]);
    expect(result).toHaveLength(6);
  });

  it("Empty Q4 (a follow-up itself): no displaced follow-up, just inserts reask→3", () => {
    const result = transformScheduleForEmptyAnswer(buildBaseSchedule(), 3);
    expect(shape(result)).toEqual([
      { kind: "new" },
      { kind: "new" },
      { kind: "follow-up", followsSlotIndex: 0 },
      { kind: "follow-up", followsSlotIndex: 1 },
      { kind: "re-ask", reasksSlotIndex: 3 },
      { kind: "new" }
    ]);
    expect(result).toHaveLength(6);
  });

  it("does not transform a slot that was itself a re-ask (no second-chance loop)", () => {
    const baseAfterFirstReask = transformScheduleForEmptyAnswer(buildBaseSchedule(), 1);
    // Slot 2 in the new schedule is now { kind: "re-ask", reasksSlotIndex: 1 }.
    const result = transformScheduleForEmptyAnswer(baseAfterFirstReask, 2);
    expect(result).toBe(baseAfterFirstReask);
  });

  it("does not transform when the slot has already been re-asked once", () => {
    // Build a schedule where slot 1 has previously been re-asked, then slot 1
    // is empty again. The 1-per-question cap should reject the new transform.
    const previouslyReasked = transformScheduleForEmptyAnswer(buildBaseSchedule(), 1);
    // Reset the empty slot to a fresh "new" so the second call can target it again
    // without being rejected as a re-ask.
    const reasked = getReaskedSlotIndices(previouslyReasked);
    const result = transformScheduleForEmptyAnswer(previouslyReasked, 1, reasked);
    expect(result).toBe(previouslyReasked);
  });

  it("respects MAX_SLOTS = 7 cap and rejects further insertions", () => {
    // First empty answer: 5 -> 6 slots.
    let working = transformScheduleForEmptyAnswer(buildBaseSchedule(), 1);
    // Second empty answer on slot 0 (Q1): 6 -> 7 slots.
    working = transformScheduleForEmptyAnswer(working, 0);
    expect(working.length).toBe(MAX_SLOTS);

    // Third empty answer would push to 8 — must be rejected.
    // We need a slot that is not itself a re-ask and hasn't been re-asked yet.
    // After the two transforms, slots 4 (new) is fresh. Mark it empty.
    const reasked = getReaskedSlotIndices(working);
    const result = transformScheduleForEmptyAnswer(working, 4, reasked);
    expect(result).toBe(working);
    expect(result.length).toBe(MAX_SLOTS);
  });
});

describe("getReaskedSlotIndices", () => {
  it("collects every re-asked slot index from the schedule", () => {
    let schedule = transformScheduleForEmptyAnswer(buildBaseSchedule(), 1);
    schedule = transformScheduleForEmptyAnswer(schedule, 0);
    const reasked = getReaskedSlotIndices(schedule);
    expect(reasked.has(0)).toBe(true);
    expect(reasked.has(1)).toBe(true);
    expect(reasked.size).toBe(2);
  });

  it("returns an empty set for the base schedule", () => {
    expect(getReaskedSlotIndices(buildBaseSchedule()).size).toBe(0);
  });
});
