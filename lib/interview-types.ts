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
  /** Measured as 100 − max(happy, sad, nervous). High when no other emotion dominates. */
  neutral: number;
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
  counts?: Record<FaceEmotionDominant, number>;
  averages: {
    happy: number;
    sad: number;
    nervous: number;
    neutral: number;
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

/**
 * The semantic role each schedule slot plays in the interview. Drives prompt
 * construction (new vs follow-up) and the empty-answer transformer's behavior.
 */
export type ScheduleSlotKind =
  | { kind: "new" }
  | { kind: "follow-up"; followsSlotIndex: number }
  | { kind: "re-ask"; reasksSlotIndex: number };

export interface ScheduleSlot {
  /** Position of this slot in the running schedule. Re-numbered after empty-answer transforms. */
  index: number;
  kind: ScheduleSlotKind;
  /** Generated question text. Null until the question has been generated (or built from the canned re-ask helper). */
  question: string | null;
}

export interface InterviewSession {
  id: string;
  role: JobRole;
  difficulty: InterviewDifficulty;
  resumeMode: ResumeMode;
  resume: ResumeProfile | null;
  /** ElevenLabs voice id for TTS; set when the session starts. Missing on legacy sessions. */
  elevenLabsVoiceId?: string | null;
  startedAt: string;
  turns: InterviewTurn[];
  currentQuestion: string | null;
  questionQueue: string[];
  /**
   * Pre-planned schedule of upcoming questions. The base schedule is 5 slots
   * ([new, new, fu->0, fu->1, new]); empty-answer transforms can grow it up to MAX_SLOTS.
   */
  schedule: ScheduleSlot[];
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
  /** One description per strength explaining why it worked, parallel to strengths[]. */
  strengthDescriptions: string[];
  weaknesses: string[];
  /** One description per weakness explaining its impact, parallel to weaknesses[]. */
  weaknessDescriptions: string[];
  interviewerNotes: string[];
  suggestedNextImprovements: string[];
}
