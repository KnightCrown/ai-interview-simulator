import { describe, expect, it } from "vitest";
import { buildFallbackEvaluation, buildFallbackFinalReport } from "@/lib/interview-engine";
import { advanceHiringStage, liveConfidenceFromSignals } from "@/lib/interview-scoring";
import { InterviewSession } from "@/lib/interview-types";
import { SAMPLE_RESUME } from "@/lib/sample-data";

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
      faceMetrics: {
        eyeContact: 80,
        headStability: 76,
        engagementScore: 78
      },
      resume: SAMPLE_RESUME,
      strictness: 60,
      previousWeakAreas: ["Specificity"]
    });

    expect(evaluation.missingResumeHighlights).toContain("JavaScript");
    expect(evaluation.missedOpportunityDetails[0]?.impactScoreIncrease).toBeGreaterThan(0);
    expect(evaluation.interviewerReaction).toContain("specific");
    expect(evaluation.liveConfidence).toBeGreaterThan(0);
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
      faceMetrics: {
        eyeContact: 86,
        headStability: 82,
        engagementScore: 84
      }
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
      resumeMode: "Use Sample Resume",
      resume: SAMPLE_RESUME,
      startedAt: new Date().toISOString(),
      currentQuestion: null,
      interviewComplete: true,
      demoMode: false,
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
          faceMetrics: { eyeContact: 80, headStability: 78, engagementScore: 79 },
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
