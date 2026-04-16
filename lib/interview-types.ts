export type JobRole =
  | "Software Engineer"
  | "Product Manager"
  | "Data Analyst"
  | "UX Designer"
  | "Marketing Manager";

export type ResumeMode = "Use Sample Resume" | "Skip Resume";

export interface ResumeProfile {
  name: string;
  role: string;
  skills: string[];
  experience: string[];
}

export interface FaceMetrics {
  eyeContact: number;
  headStability: number;
  engagementScore: number;
}

export interface SpeechMetrics {
  fillerCount: number;
  fillerWords: string[];
  speakingPace: number;
}

export interface AnswerEvaluation {
  clarity: number;
  relevance: number;
  structure: number;
  confidence: number;
  engagement: number;
  feedback: string;
  missedOpportunity: string;
  missingResumeHighlights: string[];
  improvedAnswer: string;
}

export interface InterviewTurn {
  id: string;
  question: string;
  transcript: string;
  durationSeconds: number;
  speechMetrics: SpeechMetrics;
  faceMetrics: FaceMetrics;
  evaluation: AnswerEvaluation;
}

export interface InterviewSession {
  id: string;
  role: JobRole;
  resumeMode: ResumeMode;
  resume: ResumeProfile | null;
  startedAt: string;
  turns: InterviewTurn[];
  currentQuestion: string | null;
  interviewComplete: boolean;
}

export interface FinalReport {
  overallScore: number;
  clarity: number;
  relevance: number;
  confidence: number;
  engagement: number;
  missedOpportunitySummary: string;
  bestImprovedAnswer: string;
  hiringLikelihood: "Pass" | "Borderline" | "Fail";
}
