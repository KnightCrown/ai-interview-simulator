export type JobRole = string;
export type InterviewDifficulty = "Easy" | "Medium" | "Hard";
export type ResumeMode = "Use Sample Resume" | "Skip Resume";
export type HiringStage = "Applied" | "Phone Screen" | "Technical Round" | "Final Round" | "Decision";
export type FunnelOutcome = "Selected" | "Borderline" | "Rejected";
export type HiringLikelihood = "Pass" | "Borderline" | "Fail";

export interface ResumeProfile {
  name: string;
  role: string;
  skills: string[];
  experience: string[];
}

export type FaceEmotionDominant = "happy" | "sad" | "nervous" | "neutral";

export interface FaceEmotionScores {
  happy: number;
  sad: number;
  nervous: number;
  dominant: FaceEmotionDominant;
}

export interface FaceMetrics {
  eyeContact: number;
  headStability: number;
  engagementScore: number;
  emotion: FaceEmotionScores;
}

/** Aggregated apparent mood during a single answer window (client-side). */
export interface CandidateMoodSnapshot {
  dominant: FaceEmotionDominant;
  averages: {
    happy: number;
    sad: number;
    nervous: number;
  };
  framesSampled: number;
}

export interface SpeechMetrics {
  fillerCount: number;
  fillerWords: string[];
  speakingPace: number;
}

export interface MissedOpportunityDetail {
  exactThing: string;
  source: string;
  whyItMattered: string;
  impactScoreIncrease: number;
}

export interface AnswerEvaluation {
  clarity: number;
  relevance: number;
  structure: number;
  confidence: number;
  engagement: number;
  liveConfidence: number;
  feedback: string;
  missedOpportunity: string;
  missingResumeHighlights: string[];
  missedOpportunityDetails: MissedOpportunityDetail[];
  improvedAnswer: string;
  rewriteHighlights: string[];
  interviewerReaction: string;
  perceivedTone: string;
  pressureLabel: string;
}

export interface InterviewTurn {
  id: string;
  question: string;
  transcript: string;
  durationSeconds: number;
  speechMetrics: SpeechMetrics;
  faceMetrics: FaceMetrics;
  candidateMood?: CandidateMoodSnapshot;
  evaluation: AnswerEvaluation;
}

export interface InterviewMemory {
  strengthSignals: string[];
  weakAreas: string[];
  missingResumePoints: string[];
  toneSummary: string;
  strictness: number;
  interviewerMood: string;
}

export interface InterviewSession {
  id: string;
  role: JobRole;
  difficulty: InterviewDifficulty;
  resumeMode: ResumeMode;
  resume: ResumeProfile | null;
  startedAt: string;
  turns: InterviewTurn[];
  currentQuestion: string | null;
  questionQueue: string[];
  interviewComplete: boolean;
  currentStage: HiringStage;
  hiringOutcome: FunnelOutcome | null;
  liveConfidence: number;
  memory: InterviewMemory;
}

export interface FinalReport {
  overallScore: number;
  clarity: number;
  relevance: number;
  confidence: number;
  engagement: number;
  missedOpportunitySummary: string;
  bestImprovedAnswer: string;
  hiringLikelihood: HiringLikelihood;
  hiringOutcome: FunnelOutcome;
  emotionalSummary: string;
  strengths: string[];
  weaknesses: string[];
  interviewerNotes: string[];
  suggestedNextImprovements: string[];
}
