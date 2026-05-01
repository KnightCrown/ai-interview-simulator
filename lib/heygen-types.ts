import type {
  AnswerEvaluation,
  CandidateMoodSnapshot,
  FaceMetrics,
  InterviewSession,
  SpeechMetrics
} from "@/lib/interview-types";

/** A single utterance in the live free-flow conversation. */
export interface ConversationLogEntry {
  role: "avatar" | "user";
  text: string;
  timestamp: number;
  /** When `role === "avatar"`, the orchestrator's classification for this utterance. */
  classification?: ConversationClassification;
}

export type ConversationClassification =
  | "greeting"
  | "next_main_question"
  | "follow_up"
  | "wrap_up";

/**
 * One round-trip decision from the OpenAI orchestrator. Drives both what the
 * avatar says next AND whether the just-finished main question should be
 * scored and committed as an `InterviewTurn`.
 */
export interface ConversationDecision {
  replyText: string;
  classification: ConversationClassification;
  /**
   * True when the brain decided the candidate has fully answered the current
   * main question. The conversation route runs `evaluateAnswer` and appends
   * a turn when this flips true. Always false on the first call (`isStart`).
   */
  isQuestionComplete: boolean;
  /**
   * Populated when `isQuestionComplete === true`. The frontend uses this to
   * drive the coaching panel just like the classic /interview route.
   */
  evaluation?: AnswerEvaluation;
  /** True once the cap of MAIN_QUESTION_CAP main questions has been answered. */
  shouldEndInterview: boolean;
  /** Updated session after the turn was applied (when `isQuestionComplete`). */
  session?: InterviewSession;
}

/**
 * Body posted from the live page to /api/heygen/conversation on every
 * end-of-utterance the candidate produces (and once with `isStart=true` on
 * mount).
 */
export interface ConversationRequest {
  session: InterviewSession;
  conversationLog: ConversationLogEntry[];
  latestUserUtterance: string;
  /**
   * Number of MAIN questions the avatar has already asked (greetings and
   * follow-ups do not count). The orchestrator increments this when it
   * returns classification `"next_main_question"` or wraps up.
   */
  mainQuestionsAsked: number;
  /** Text of the main question currently in flight. Null on `isStart`. */
  currentMainQuestion: string | null;
  isStart: boolean;
  speechMetrics?: SpeechMetrics;
  faceMetrics?: FaceMetrics;
  candidateMood?: CandidateMoodSnapshot | null;
  /** Aggregated transcript across all user utterances since the last main question. */
  cumulativeAnswerTranscript?: string;
  /** Wall-clock seconds spent answering the current main question. */
  durationSeconds?: number;
}
