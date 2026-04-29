import {
  AnswerEvaluation,
  FaceMetrics,
  FunnelOutcome,
  HiringStage,
  InterviewMemory,
  InterviewTurn,
  JobRole,
  MissedOpportunityDetail,
  ResumeProfile,
  SpeechMetrics
} from "@/lib/interview-types";
import { SAMPLE_RESUME, getRoleExpectations } from "@/lib/sample-data";

export const TURN_LIMIT = 5;
export const HIRING_STAGES: HiringStage[] = ["Applied", "Phone Screen", "Technical Round", "Final Round", "Decision"];

export function clampScore(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function detectStarStructure(transcript: string) {
  const lower = transcript.toLowerCase();
  let score = 35;

  if (lower.includes("situation") || lower.includes("context") || lower.includes("at the time")) score += 15;
  if (lower.includes("task") || lower.includes("goal") || lower.includes("needed to")) score += 15;
  if (lower.includes("action") || lower.includes("i built") || lower.includes("i led") || lower.includes("i decided")) score += 20;
  if (lower.includes("result") || lower.includes("improved") || lower.includes("impact") || lower.includes("reduced")) score += 15;

  return clampScore(score, 1, 100);
}

export function keywordCoverageScore(transcript: string, keywords: string[]) {
  if (keywords.length === 0) {
    return 60;
  }

  const lower = transcript.toLowerCase();
  const hits = keywords.filter((keyword) =>
    keyword
      .toLowerCase()
      .split(/\s+/)
      .some((part) => lower.includes(part))
  ).length;

  return clampScore((hits / keywords.length) * 100);
}

export function speakingPaceStabilityScore(speakingPace: number) {
  if (speakingPace >= 105 && speakingPace <= 155) return 90;
  if (speakingPace >= 90 && speakingPace <= 170) return 72;
  if (speakingPace >= 75 && speakingPace <= 185) return 58;
  return 40;
}

export function liveConfidenceFromSignals(input: {
  role: JobRole;
  transcript: string;
  speechMetrics: SpeechMetrics;
  faceMetrics: FaceMetrics;
}) {
  const { role, transcript, speechMetrics, faceMetrics } = input;
  const structure = detectStarStructure(transcript);
  const relevance = keywordCoverageScore(transcript, getRoleExpectations(role));
  const pace = speakingPaceStabilityScore(speechMetrics.speakingPace);
  const fillerPenalty = Math.min(28, speechMetrics.fillerCount * 4);
  const eyeContact = faceMetrics.eyeContact;

  return clampScore((pace * 0.18 + (100 - fillerPenalty) * 0.16 + eyeContact * 0.22 + structure * 0.2 + relevance * 0.24));
}

export function confidenceFromMetrics(speechMetrics: SpeechMetrics, faceMetrics: FaceMetrics) {
  const fillerPenalty = Math.min(25, speechMetrics.fillerCount * 4);
  const paceBonus = speechMetrics.speakingPace >= 95 && speechMetrics.speakingPace <= 170 ? 10 : 0;
  return clampScore(faceMetrics.engagementScore - fillerPenalty + paceBonus);
}

export function inferMissingHighlights(transcript: string, resume: ResumeProfile | null) {
  if (!resume) {
    return [];
  }

  const lower = transcript.toLowerCase();
  return [...resume.skills, ...resume.experience].filter((entry) => !lower.includes(entry.toLowerCase()));
}

export function buildMissedOpportunityDetails(role: JobRole, transcript: string, resume: ResumeProfile | null) {
  const missingResume = inferMissingHighlights(transcript, resume);
  const expectations = getRoleExpectations(role);
  const lower = transcript.toLowerCase();
  const inferredGap = expectations.find((item) => !item.split(/\s+/).some((part) => lower.includes(part)));

  const details: MissedOpportunityDetail[] = missingResume.slice(0, 2).map((item, index) => ({
    exactThing: `You should have explicitly mentioned ${item}.`,
    source: resume ? `${resume.name}'s resume` : "resume context",
    whyItMattered: `It directly supports your fit for the ${role} role and would make your answer more concrete.`,
    impactScoreIncrease: 18 - index * 4
  }));

  if (details.length === 0 && inferredGap) {
    details.push({
      exactThing: `You should have connected your answer to ${inferredGap}.`,
      source: "role expectation",
      whyItMattered: `Interviewers for ${role} roles look for this signal when deciding whether to move candidates forward.`,
      impactScoreIncrease: 12
    });
  }

  return details;
}

export function buildRewriteHighlights(transcript: string, improvedAnswer: string) {
  const originalWords = new Set(transcript.toLowerCase().split(/\W+/).filter(Boolean));
  const additions = improvedAnswer
    .split(/[.!?]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((sentence) =>
      sentence
        .toLowerCase()
        .split(/\W+/)
        .some((word) => word && !originalWords.has(word))
    );

  return additions.slice(0, 3);
}

export function buildImprovedAnswer(role: JobRole, resume: ResumeProfile | null, missingHighlights: string[], transcript: string) {
  const quantifier = /\d/.test(transcript) ? "tighten the numbers you already mentioned" : "add a measurable result";
  const resumeLine = resume
    ? `I'd connect this to my background as ${resume.role}, especially ${missingHighlights.slice(0, 2).join(" and ") || "my strongest matching projects"}.`
    : "I'd ground the answer in a concrete example, a clear action I owned, and a measurable result.";

  return `A stronger ${role} answer would open with the situation, explain the decision you owned, ${quantifier}, and close with impact. ${resumeLine} Then I'd tie the story back to why that makes me effective in this role.`;
}

export function derivePerceivedTone(evaluation: Pick<AnswerEvaluation, "confidence" | "clarity" | "relevance" | "structure">) {
  if (evaluation.confidence >= 78 && evaluation.structure < 60) return "Confident but vague";
  if (evaluation.relevance >= 78 && evaluation.structure < 70) return "Strong technically, weak storytelling";
  if (evaluation.clarity >= 76 && evaluation.relevance >= 68) return "Clear communicator with improving depth";
  return "Promising, but still searching for sharper examples";
}

export function derivePressureLabel(liveConfidence: number) {
  if (liveConfidence >= 76) return "Calm under pressure";
  if (liveConfidence >= 56) return "Some pressure building";
  return "High pressure moment";
}

export function advanceHiringStage(currentStage: HiringStage, answerStrength: number) {
  const currentIndex = HIRING_STAGES.indexOf(currentStage);
  if (currentIndex === -1) {
    return "Applied";
  }

  if (answerStrength >= 78) {
    return HIRING_STAGES[Math.min(HIRING_STAGES.length - 1, currentIndex + 1)];
  }

  if (answerStrength <= 45) {
    return HIRING_STAGES[Math.max(0, currentIndex - 1)];
  }

  return currentStage;
}

export function deriveHiringOutcome(overallScore: number): FunnelOutcome {
  if (overallScore >= 75) return "Selected";
  if (overallScore >= 55) return "Borderline";
  return "Rejected";
}

export function createInitialMemory(): InterviewMemory {
  return {
    strengthSignals: [],
    weakAreas: [],
    missingResumePoints: [],
    toneSummary: "Unknown",
    strictness: 55,
    interviewerMood: "Professional and observant"
  };
}

export function updateMemory(memory: InterviewMemory, turn: InterviewTurn) {
  const nextStrengths = [...memory.strengthSignals];
  const nextWeakAreas = [...memory.weakAreas];
  const nextMissing = [...memory.missingResumePoints];

  if (turn.evaluation.relevance >= 75) {
    nextStrengths.push("Role alignment");
  }
  if (turn.evaluation.structure >= 75) {
    nextStrengths.push("Structured storytelling");
  }
  if (turn.evaluation.clarity < 65) {
    nextWeakAreas.push("Specificity");
  }
  if (turn.evaluation.confidence < 60) {
    nextWeakAreas.push("Executive presence");
  }
  nextMissing.push(...turn.evaluation.missingResumeHighlights);

  const strictness = clampScore(memory.strictness + (turn.evaluation.liveConfidence >= 75 ? 8 : -6));

  return {
    strengthSignals: Array.from(new Set(nextStrengths)).slice(-4),
    weakAreas: Array.from(new Set(nextWeakAreas)).slice(-4),
    missingResumePoints: Array.from(new Set(nextMissing)).slice(-4),
    toneSummary: turn.evaluation.perceivedTone,
    strictness,
    interviewerMood:
      strictness >= 70 ? "Sharper and more skeptical" : strictness <= 45 ? "Encouraging and supportive" : "Professional and observant"
  };
}

export function buildSafeResumePreview(resume: ResumeProfile | null) {
  return resume ?? SAMPLE_RESUME;
}
