import { NextResponse } from "next/server";
import { applyTurnToSession, evaluateAnswer } from "@/lib/interview-engine";
import { CandidateMoodSnapshot, InterviewSession, InterviewTurn } from "@/lib/interview-types";

/**
 * Evaluates a single submitted answer and applies the resulting turn to the session.
 *
 * As of the schedule-driven pipeline, this route NO LONGER generates the next
 * question — that is handled by the client's pre-fetch loop against
 * `/api/interview/question/prefetch`. The route's response only updates
 * evaluation, memory, and turn history. `currentQuestion` and `questionQueue`
 * are preserved verbatim from the inbound session because the client owns
 * scheduling now.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    session: InterviewSession;
    transcript: string;
    durationSeconds: number;
    speechMetrics: InterviewTurn["speechMetrics"];
    faceMetrics: InterviewTurn["faceMetrics"];
    candidateMood?: CandidateMoodSnapshot | null;
  };

  const turnId = crypto.randomUUID();

  const evaluation = await evaluateAnswer({
    role: body.session.role,
    difficulty: body.session.difficulty,
    transcript: body.transcript,
    speechMetrics: body.speechMetrics,
    faceMetrics: body.faceMetrics,
    candidateMood: body.candidateMood ?? null,
    resume: body.session.resume,
    previousTurns: body.session.turns,
    memory: body.session.memory
  });

  const turn: InterviewTurn = {
    id: turnId,
    question: body.session.currentQuestion ?? "Interview question unavailable.",
    transcript: body.transcript,
    durationSeconds: body.durationSeconds,
    speechMetrics: body.speechMetrics,
    faceMetrics: body.faceMetrics,
    candidateMood: body.candidateMood ?? undefined,
    evaluation
  };

  const nextSession = applyTurnToSession(body.session, turn);

  return NextResponse.json({
    session: {
      ...nextSession,
      currentQuestion: body.session.currentQuestion,
      questionQueue: body.session.questionQueue
    },
    evaluation
  });
}
