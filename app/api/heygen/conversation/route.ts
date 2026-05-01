import { NextResponse } from "next/server";
import { runConversationTurn } from "@/lib/heygen-engine";
import type { ConversationRequest } from "@/lib/heygen-types";

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
 * - `shouldEndInterview`   true after MAIN_QUESTION_CAP (2) timed live questions; client routes to /results
 */
export async function POST(request: Request) {
  let body: Partial<ConversationRequest>;
  try {
    body = (await request.json()) as Partial<ConversationRequest>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.session) {
    return NextResponse.json({ error: "session is required." }, { status: 400 });
  }

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
    console.error("[heygen conversation]", err);
    return NextResponse.json({ error: "Conversation turn failed." }, { status: 500 });
  }

  return NextResponse.json(decision);
}
