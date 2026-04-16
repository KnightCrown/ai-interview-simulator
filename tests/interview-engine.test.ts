import { describe, expect, it } from "vitest";
import { buildFallbackEvaluation, buildFallbackFinalReport } from "@/lib/interview-engine";
import { InterviewSession } from "@/lib/interview-types";
import { SAMPLE_RESUME } from "@/lib/sample-data";

describe("buildFallbackEvaluation", () => {
  it("surfaces missing resume highlights when the transcript omits them", () => {
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
      resume: SAMPLE_RESUME
    });

    expect(evaluation.missingResumeHighlights).toContain("JavaScript");
    expect(evaluation.improvedAnswer).toContain("stronger Software Engineer answer");
    expect(evaluation.relevance).toBeGreaterThan(0);
  });
});

describe("buildFallbackFinalReport", () => {
  it("averages turn scores into an overall report", () => {
    const session: InterviewSession = {
      id: "session-1",
      role: "Software Engineer",
      resumeMode: "Use Sample Resume",
      resume: SAMPLE_RESUME,
      startedAt: new Date().toISOString(),
      currentQuestion: null,
      interviewComplete: true,
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
            feedback: "Strong answer.",
            missedOpportunity: "Could quantify ownership more.",
            missingResumeHighlights: ["Python"],
            improvedAnswer: "Lead with context and impact."
          }
        }
      ]
    };

    const report = buildFallbackFinalReport(session);

    expect(report.overallScore).toBeGreaterThan(70);
    expect(report.hiringLikelihood).toBe("Pass");
    expect(report.bestImprovedAnswer).toContain("Lead with context");
  });
});
