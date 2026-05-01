import OpenAI from "openai";
import {
  AnswerEvaluation,
  CandidateMoodSnapshot,
  FaceMetrics,
  InterviewSession,
  InterviewTurn,
  SpeechMetrics
} from "@/lib/interview-types";
import {
  applyTurnToSession,
  evaluateAnswer,
  generateQuestion
} from "@/lib/interview-engine";
import {
  ConversationClassification,
  ConversationDecision,
  ConversationLogEntry
} from "@/lib/heygen-types";
import { isTranscriptSubstantive } from "@/lib/transcript-utils";

/**
 * Soft cap on the number of MAIN questions the live avatar will ask before
 * wrapping up and routing to /results. The user picked 3 in the planning step.
 *
 * Greeting and follow-up utterances do NOT count toward this cap. Only utterances
 * the orchestrator classifies as `next_main_question` increment the counter.
 */
export const MAIN_QUESTION_CAP = 3;

/**
 * After this many interviewer follow-up utterances on the same main question,
 * we advance to the next main question (or wrap-up at cap) even if the model
 * still wants another follow-up — avoids endless probing on vague answers.
 */
export const MAX_FOLLOW_UPS_BEFORE_ADVANCE = 2;

/** Count avatar lines classified `follow_up` since the latest `next_main_question`. */
export function countFollowUpAvatarTurnsSinceLastMainQuestion(log: ConversationLogEntry[]): number {
  let lastMainIdx = -1;
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.role === "avatar" && e.classification === "next_main_question") {
      lastMainIdx = i;
    }
  }
  if (lastMainIdx === -1) return 0;
  let count = 0;
  for (let i = lastMainIdx + 1; i < log.length; i++) {
    const e = log[i];
    if (e.role === "avatar" && e.classification === "follow_up") {
      count++;
    }
  }
  return count;
}

/**
 * Result returned by `decideNextUtterance`. The orchestrator route (or test
 * harness) is responsible for turning this decision into a `ConversationDecision`
 * by running `evaluateAnswer` and `generateQuestion` when needed.
 */
export interface OrchestratorDecisionRaw {
  isQuestionComplete: boolean;
  classification: ConversationClassification;
  /**
   * A brief acknowledgement / transition phrase the avatar can say before the
   * next main question (when classification is `next_main_question` or
   * `wrap_up`). Empty when the LLM omitted it.
   */
  transitionPhrase: string;
  /**
   * The actual follow-up question text. Only meaningful when classification
   * is `follow_up`. Empty otherwise.
   */
  followUpText: string;
  /**
   * Free-form wrap-up sentence. Only meaningful when classification is
   * `wrap_up`. Empty otherwise.
   */
  wrapUpText: string;
}

export type LLMRunner = (prompt: string, label: string) => Promise<string | null>;

let missingOpenAiKeyLogged = false;

function defaultClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    if (process.env.NODE_ENV === "development" && !missingOpenAiKeyLogged) {
      missingOpenAiKeyLogged = true;
      console.warn(
        "[heygen-engine] OPENAI_API_KEY missing — orchestrator falls back to deterministic decisions. Add OPENAI_API_KEY to .env.local."
      );
    }
    return null;
  }
  return new OpenAI({ apiKey });
}

const defaultRunLLM: LLMRunner = async (prompt, label) => {
  const client = defaultClient();
  if (!client) return null;

  const isDev = process.env.NODE_ENV !== "production";
  const startedAt = isDev ? performance.now() : 0;
  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt
    });
    if (isDev) {
      console.log(`[openai] ${label} ms=${Math.round(performance.now() - startedAt)}`);
    }
    const text = response.output_text?.trim();
    return text || null;
  } catch (err) {
    console.error("[heygen-engine] OpenAI request failed:", err instanceof Error ? err.message : err);
    return null;
  }
};

function parseJsonObject<T>(content: string): Partial<T> | null {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Partial<T>;
  } catch {
    return null;
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asClassification(
  value: unknown,
  fallback: ConversationClassification
): ConversationClassification {
  if (value === "follow_up" || value === "next_main_question" || value === "wrap_up" || value === "greeting") {
    return value;
  }
  return fallback;
}

/**
 * Pure helper: render the orchestrator prompt. Exported for tests so we can
 * pin the prompt shape and assert on input fields without re-running the LLM.
 */
export function buildOrchestratorPrompt(input: {
  session: InterviewSession;
  conversationLog: ConversationLogEntry[];
  latestUserUtterance: string;
  currentMainQuestion: string | null;
  mainQuestionsAsked: number;
  cumulativeAnswerTranscript: string;
}): string {
  const remainingMain = Math.max(0, MAIN_QUESTION_CAP - input.mainQuestionsAsked);
  const isLastMainQuestion = input.mainQuestionsAsked >= MAIN_QUESTION_CAP;
  const recentLog = input.conversationLog.slice(-12);

  return `
You are the brain of a live AI interviewer rendered as a HeyGen avatar.
You decide what the avatar says next, turn-by-turn, and whether the candidate has fully answered the CURRENT MAIN QUESTION.

Return STRICT JSON with these exact keys (no markdown fences, no commentary):
{
  "isQuestionComplete": boolean,
  "classification": "follow_up" | "next_main_question" | "wrap_up",
  "transitionPhrase": string,
  "followUpText": string,
  "wrapUpText": string
}

Field rules:
- isQuestionComplete: true ONLY when the candidate's cumulative answer to the current main question is genuinely complete (covers a concrete example, role-relevant detail, and at least one piece of evidence/impact). For thin answers ("yeah", short fragments, off-topic asides), set false and ask a focused follow-up.
- classification:
  * "follow_up" when isQuestionComplete is false: ask one short probing question that builds on what the candidate just said.
  * "next_main_question" when isQuestionComplete is true AND we still have main questions remaining (remaining=${remainingMain}).
  * "wrap_up" when isQuestionComplete is true AND ${isLastMainQuestion ? "we are AT the cap and must close out the interview" : "the candidate clearly cannot continue"}. Only choose wrap_up when remaining is 0 OR the candidate has explicitly indicated they want to end.
- transitionPhrase: 1 short sentence (max 12 words) the avatar says BEFORE the next question — only meaningful for "next_main_question" or "wrap_up". A real interviewer's quick acknowledgement: "Got it.", "Thanks — that's helpful.", "Makes sense.". Empty string for "follow_up".
- followUpText: the FULL line the avatar speaks for "follow_up" — one flowing utterance (max ~45 words), first person, present tense. It MUST make it obvious this is a follow-up (not a new topic): always start with a brief bridge, then your probe. Rotate styles across turns — do NOT use the same opener every time — mix these patterns naturally:
  (a) Echo: briefly mirror their words ("You said you owned the rollout…", "When you mentioned the API rewrite…") then ask one sharper question.
  (b) Expansion: phrases like "Let's expand on that for a moment", "I'd like to dig a bit deeper here", "Building on what you just told me".
  (c) Warm interest: "That's interesting — walk me through…", "That's helpful — say more about…", "Okay — staying with that thread…".
  Then flow straight into ONE focused follow-up question (no meta preamble like "as a follow-up question"). Empty string when classification is not "follow_up".
- wrapUpText: a single 1-2 sentence closing line. Only meaningful for "wrap_up". Polite, professional, signals the interview is ending. Empty string otherwise.

Behave like a human interviewer:
- Keep replies short (under ~30 words). The avatar speaks them aloud.
- Never reveal you are an AI or mention HeyGen / OpenAI.
- React specifically to what the candidate just said when probing follow-ups.
- If the candidate is rambling or off-topic, redirect them gently.
- Policy: at most ${MAX_FOLLOW_UPS_BEFORE_ADVANCE} follow-up rounds per main question; the system will advance afterward even if the answer stayed vague — prefer marking isQuestionComplete true once they have given their best effort.
- Difficulty calibration: ${input.session.difficulty}. Easy = supportive coach. Medium = realistic peer. Hard = skeptical senior.

Context:
- Role: ${JSON.stringify(input.session.role)}
- Difficulty: ${input.session.difficulty}
- Resume: ${JSON.stringify(input.session.resume)}
- Memory: ${JSON.stringify(input.session.memory)}
- Main questions already asked: ${input.mainQuestionsAsked} of ${MAIN_QUESTION_CAP}
- Current main question in flight: ${JSON.stringify(input.currentMainQuestion ?? "")}
- Cumulative answer transcript so far for this main question: ${JSON.stringify(input.cumulativeAnswerTranscript)}
- Latest user utterance (most recent only): ${JSON.stringify(input.latestUserUtterance)}
- Recent conversation log (oldest first): ${JSON.stringify(recentLog)}
`;
}

/** Deterministic variety for offline / LLM-failure follow-ups (mirrors prompt patterns). */
function pickFallbackFollowUpText(latest: string, wordCount: number): string {
  if (wordCount === 0) {
    return "Take your time — when you're ready, could you walk me through one specific example from your work?";
  }

  const trimmed = latest.trim();
  const templates: ((latestLine: string) => string)[] = [
    (line) => {
      const clip = line.slice(0, 52);
      const mention =
        clip.length > 14 ? `You mentioned ${clip}${line.length > 52 ? "…" : ""}. ` : "";
      return `${mention}Let's expand on that — could you spell out your role and the outcome you measured?`;
    },
    () =>
      "That's interesting — I'd like to dig a bit deeper. What was the hardest tradeoff, and how did you decide?",
    () =>
      "Building on what you just said — can you give me one concrete example with a timeline or a metric?",
    () =>
      "That's helpful — tell me a bit more about how that showed up for users or for the business.",
    () =>
      "Okay — staying with that thread: what would you do differently if you ran it again?"
  ];

  const idx = Math.abs(trimmed.length + wordCount) % templates.length;
  return templates[idx](trimmed);
}

function fallbackDecision(input: {
  cumulativeAnswerTranscript: string;
  latestUserUtterance: string;
  mainQuestionsAsked: number;
}): OrchestratorDecisionRaw {
  const text = `${input.cumulativeAnswerTranscript} ${input.latestUserUtterance}`.trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const substantive = isTranscriptSubstantive(text) && wordCount >= 30;
  const atCap = input.mainQuestionsAsked >= MAIN_QUESTION_CAP;

  if (substantive && atCap) {
    return {
      isQuestionComplete: true,
      classification: "wrap_up",
      transitionPhrase: "Thanks — that wraps things up on my end.",
      followUpText: "",
      wrapUpText: "I appreciate you taking the time today. We'll review and follow up with feedback shortly."
    };
  }
  if (substantive) {
    return {
      isQuestionComplete: true,
      classification: "next_main_question",
      transitionPhrase: "Thanks — that's helpful.",
      followUpText: "",
      wrapUpText: ""
    };
  }
  return {
    isQuestionComplete: false,
    classification: "follow_up",
    transitionPhrase: "",
    followUpText: pickFallbackFollowUpText(input.latestUserUtterance || input.cumulativeAnswerTranscript, wordCount),
    wrapUpText: ""
  };
}

/**
 * Pure decision logic: take the conversation state and return the
 * orchestrator's raw decision. Falls back to deterministic heuristics when no
 * OpenAI key is configured or the LLM call fails. Exported so tests can pin
 * its behavior.
 */
export async function decideNextUtterance(
  input: {
    session: InterviewSession;
    conversationLog: ConversationLogEntry[];
    latestUserUtterance: string;
    mainQuestionsAsked: number;
    currentMainQuestion: string | null;
    cumulativeAnswerTranscript: string;
  },
  runLLM: LLMRunner = defaultRunLLM
): Promise<OrchestratorDecisionRaw> {
  const fallback = fallbackDecision({
    cumulativeAnswerTranscript: input.cumulativeAnswerTranscript,
    latestUserUtterance: input.latestUserUtterance,
    mainQuestionsAsked: input.mainQuestionsAsked
  });

  const prompt = buildOrchestratorPrompt(input);
  const raw = await runLLM(prompt, "decideNextUtterance");
  if (!raw) return fallback;

  const parsed = parseJsonObject<OrchestratorDecisionRaw>(raw);
  if (!parsed) return fallback;

  const classification = asClassification(parsed.classification, fallback.classification);

  // Defense-in-depth: never let the LLM produce wrap_up when we still have main
  // questions to ask, and never produce next_main_question when we're at the cap.
  let normalizedClassification: ConversationClassification = classification;
  if (normalizedClassification === "wrap_up" && input.mainQuestionsAsked < MAIN_QUESTION_CAP) {
    normalizedClassification = "next_main_question";
  }
  if (normalizedClassification === "next_main_question" && input.mainQuestionsAsked >= MAIN_QUESTION_CAP) {
    normalizedClassification = "wrap_up";
  }

  // The classification tautologically determines isQuestionComplete: follow_up
  // means the answer isn't done yet; the other two branches always close out
  // the current main question.
  const isQuestionComplete = normalizedClassification !== "follow_up";

  return {
    isQuestionComplete,
    classification: normalizedClassification,
    transitionPhrase: asString(parsed.transitionPhrase, ""),
    followUpText: asString(parsed.followUpText, fallback.followUpText),
    wrapUpText: asString(parsed.wrapUpText, fallback.wrapUpText)
  };
}

/**
 * Pure helper: build the InterviewTurn record we materialize when the
 * orchestrator declares a main question complete. The transcript is the
 * cumulative-answer text aggregated across all candidate utterances since the
 * main question was asked.
 */
export function buildCompletedTurn(input: {
  question: string;
  transcript: string;
  durationSeconds: number;
  speechMetrics: SpeechMetrics;
  faceMetrics: FaceMetrics;
  candidateMood: CandidateMoodSnapshot | null;
  evaluation: AnswerEvaluation;
}): InterviewTurn {
  return {
    id: crypto.randomUUID(),
    question: input.question || "Live conversation question",
    transcript: input.transcript,
    durationSeconds: input.durationSeconds,
    speechMetrics: input.speechMetrics,
    faceMetrics: input.faceMetrics,
    candidateMood: input.candidateMood ?? undefined,
    evaluation: input.evaluation
  };
}

/**
 * Compose `evaluateAnswer` + `applyTurnToSession` for the live route. Returns
 * the updated session AND the evaluation so the API route can include both in
 * its response (the page needs the evaluation for the coaching panel).
 */
export async function scoreCompletedMainQuestion(input: {
  session: InterviewSession;
  question: string;
  transcript: string;
  durationSeconds: number;
  speechMetrics: SpeechMetrics;
  faceMetrics: FaceMetrics;
  candidateMood: CandidateMoodSnapshot | null;
}): Promise<{ session: InterviewSession; evaluation: AnswerEvaluation; turn: InterviewTurn }> {
  const evaluation = await evaluateAnswer({
    role: input.session.role,
    difficulty: input.session.difficulty,
    transcript: input.transcript,
    speechMetrics: input.speechMetrics,
    faceMetrics: input.faceMetrics,
    candidateMood: input.candidateMood,
    resume: input.session.resume,
    previousTurns: input.session.turns,
    memory: input.session.memory
  });

  const turn = buildCompletedTurn({
    question: input.question,
    transcript: input.transcript,
    durationSeconds: input.durationSeconds,
    speechMetrics: input.speechMetrics,
    faceMetrics: input.faceMetrics,
    candidateMood: input.candidateMood,
    evaluation
  });

  const nextSession = applyTurnToSession(input.session, turn);
  return { session: nextSession, evaluation, turn };
}

/**
 * High-level orchestrator entry point used by /api/heygen/conversation. Returns
 * the avatar's next utterance + (when the main question is complete) the
 * evaluation and updated session.
 *
 * On `isStart=true`, skips the decision LLM and just generates the first main
 * question via the existing `generateQuestion` helper.
 */
export async function runConversationTurn(input: {
  session: InterviewSession;
  conversationLog: ConversationLogEntry[];
  latestUserUtterance: string;
  mainQuestionsAsked: number;
  currentMainQuestion: string | null;
  isStart: boolean;
  cumulativeAnswerTranscript: string;
  durationSeconds: number;
  speechMetrics: SpeechMetrics;
  faceMetrics: FaceMetrics;
  candidateMood: CandidateMoodSnapshot | null;
  runLLM?: LLMRunner;
}): Promise<ConversationDecision> {
  if (input.isStart) {
    const greeting = `Hello, I'll be your interviewer today. Let's get started.`;
    const firstQuestion = await generateQuestion({
      session: input.session,
      targetTurnIndex: 0,
      slotKind: { kind: "new" }
    });
    return {
      replyText: `${greeting} ${firstQuestion}`.trim(),
      classification: "next_main_question",
      isQuestionComplete: false,
      shouldEndInterview: false
    };
  }

  let decision = await decideNextUtterance(
    {
      session: input.session,
      conversationLog: input.conversationLog,
      latestUserUtterance: input.latestUserUtterance,
      mainQuestionsAsked: input.mainQuestionsAsked,
      currentMainQuestion: input.currentMainQuestion,
      cumulativeAnswerTranscript: input.cumulativeAnswerTranscript
    },
    input.runLLM
  );

  const followUpsSinceMain = countFollowUpAvatarTurnsSinceLastMainQuestion(input.conversationLog);

  if (decision.classification === "follow_up" && followUpsSinceMain >= MAX_FOLLOW_UPS_BEFORE_ADVANCE) {
    const atCap = input.mainQuestionsAsked >= MAIN_QUESTION_CAP;
    decision = {
      isQuestionComplete: true,
      classification: atCap ? "wrap_up" : "next_main_question",
      transitionPhrase: atCap
        ? "Okay — we struggled to get a concrete answer on that last topic, so I'll wrap up here."
        : "Okay — I'm still not hearing a concrete answer here, so let's move on.",
      followUpText: "",
      wrapUpText: atCap
        ? "Thanks for taking the time today. We'll review everything and follow up with feedback shortly."
        : ""
    };
  }

  if (decision.classification === "follow_up") {
    const merged = `${input.cumulativeAnswerTranscript} ${input.latestUserUtterance}`.trim();
    const wc = merged.split(/\s+/).filter(Boolean).length;
    return {
      replyText: decision.followUpText || pickFallbackFollowUpText(input.latestUserUtterance || input.cumulativeAnswerTranscript, wc),
      classification: "follow_up",
      isQuestionComplete: false,
      shouldEndInterview: false
    };
  }

  // Either next_main_question or wrap_up: score the just-finished main question.
  const { session: scoredSession, evaluation } = await scoreCompletedMainQuestion({
    session: input.session,
    question: input.currentMainQuestion ?? "",
    transcript: input.cumulativeAnswerTranscript,
    durationSeconds: input.durationSeconds,
    speechMetrics: input.speechMetrics,
    faceMetrics: input.faceMetrics,
    candidateMood: input.candidateMood
  });

  if (decision.classification === "wrap_up") {
    const wrapUp = decision.wrapUpText || "Thanks for taking the time today. We'll review and follow up with feedback shortly.";
    const transition = decision.transitionPhrase ? `${decision.transitionPhrase} ` : "";
    return {
      replyText: `${transition}${wrapUp}`.trim(),
      classification: "wrap_up",
      isQuestionComplete: true,
      evaluation,
      session: scoredSession,
      shouldEndInterview: true
    };
  }

  // next_main_question: generate the next question and stitch it after the
  // transition phrase.
  const nextTargetIndex = scoredSession.turns.length;
  const nextQuestion = await generateQuestion({
    session: scoredSession,
    targetTurnIndex: nextTargetIndex,
    slotKind: { kind: "new" }
  });
  const transition = decision.transitionPhrase || "Got it.";
  return {
    replyText: `${transition} ${nextQuestion}`.trim(),
    classification: "next_main_question",
    isQuestionComplete: true,
    evaluation,
    session: scoredSession,
    shouldEndInterview: false
  };
}
