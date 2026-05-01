import { NextResponse } from "next/server";
import { runConversationTurn } from "@/lib/heygen-engine";
import type { ConversationRequest } from "@/lib/heygen-types";
import { formatLiveAvatarLogLine, normalizeLiveAvatarLog } from "@/lib/live-avatar-debug";

const FALLBACK_FACE_METRICS = {
  eyeContact: 50,
  headStability: 50,
  engagementScore: 50,
  emotion: { happy: 0, sad: 0, nervous: 0, neutral: 100, dominant: "neutral" as const }
};

const FALLBACK_SPEECH_METRICS = {
  fillerCount: 0,
  fillerWords: [] as string[],
  speakingPace: 0
};

function logConversationEvent(event: string, details: Record<string, unknown> = {}) {
  console.log(formatLiveAvatarLogLine(normalizeLiveAvatarLog({
    event,
    source: "server-conversation",
    pathname: "/api/heygen/conversation",
    details
  })));
}

/**
 * Free-flow live-avatar orchestrator. Called once on session start (`isStart`)
 * to produce the greeting + first question, then once per candidate
 * end-of-utterance to decide what the avatar says next.
 *
 * Returns a `ConversationDecision` (see lib/heygen-types.ts):
 * - `replyText`            text to feed into streamingAvatar.speak({REPEAT})
 * - `classification`       greeting | follow_up | next_main_question | wrap_up
 * - `isQuestionComplete`   true when a MAIN question was just completed (and scored)
 * - `evaluation`           AnswerEvaluation when isQuestionComplete (drives coaching panel)
 * - `session`              updated InterviewSession when isQuestionComplete
 * - `shouldEndInterview`   true after MAIN_QUESTION_CAP main questions; client routes to /results
 */
export async function POST(request: Request) {
  let body: Partial<ConversationRequest>;
  try {
    body = (await request.json()) as Partial<ConversationRequest>;
  } catch {
    logConversationEvent("invalid_json");
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.session) {
    logConversationEvent("missing_session");
    return NextResponse.json({ error: "session is required." }, { status: 400 });
  }

  logConversationEvent("turn_request_received", {
    isStart: body.isStart === true,
    latestLength: body.latestUserUtterance?.length ?? 0,
    cumulativeLength: body.cumulativeAnswerTranscript?.length ?? 0,
    mainQuestionsAsked: body.mainQuestionsAsked ?? 0,
    currentMainQuestion: body.currentMainQuestion ?? null
  });

  let decision;
  try {
    decision = await runConversationTurn({
      session: body.session,
      conversationLog: body.conversationLog ?? [],
      latestUserUtterance: body.latestUserUtterance ?? "",
      mainQuestionsAsked: body.mainQuestionsAsked ?? 0,
      currentMainQuestion: body.currentMainQuestion ?? null,
      isStart: body.isStart === true,
      cumulativeAnswerTranscript: body.cumulativeAnswerTranscript ?? "",
      durationSeconds: body.durationSeconds ?? 0,
      speechMetrics: body.speechMetrics ?? FALLBACK_SPEECH_METRICS,
      faceMetrics: body.faceMetrics ?? FALLBACK_FACE_METRICS,
      candidateMood: body.candidateMood ?? null
    });
  } catch (err) {
    logConversationEvent("turn_failed", {
      error: err instanceof Error ? err.message : "conversation turn failed"
    });
    return NextResponse.json({ error: "Conversation turn failed." }, { status: 500 });
  }

  logConversationEvent("turn_decision_ready", {
    classification: decision.classification,
    isQuestionComplete: decision.isQuestionComplete,
    shouldEndInterview: decision.shouldEndInterview,
    replyLength: decision.replyText.length
  });

  return NextResponse.json(decision);
}
