import { NextResponse } from "next/server";
import { applyTurnToSession, buildFallbackQuestion, evaluateAnswer } from "@/lib/interview-engine";
import { InterviewSession, InterviewTurn } from "@/lib/interview-types";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    session: InterviewSession;
    transcript: string;
    durationSeconds: number;
    speechMetrics: InterviewTurn["speechMetrics"];
    faceMetrics: InterviewTurn["faceMetrics"];
  };

  const questionQueue = body.session.questionQueue ?? [];
  const [readyQuestion, ...remainingQuestionQueue] = questionQueue;
  const evaluation = await evaluateAnswer({
    role: body.session.role,
    transcript: body.transcript,
    speechMetrics: body.speechMetrics,
    faceMetrics: body.faceMetrics,
    resume: body.session.resume,
    previousTurns: body.session.turns,
    memory: body.session.memory
  });

  const turn: InterviewTurn = {
    id: crypto.randomUUID(),
    question: body.session.currentQuestion ?? "Interview question unavailable.",
    transcript: body.transcript,
    durationSeconds: body.durationSeconds,
    speechMetrics: body.speechMetrics,
    faceMetrics: body.faceMetrics,
    evaluation
  };

  const nextSession = applyTurnToSession(
    {
      ...body.session,
      questionQueue: remainingQuestionQueue
    },
    turn
  );
  const nextQuestion = nextSession.interviewComplete ? null : readyQuestion ?? buildFallbackQuestion(nextSession);

  return NextResponse.json({
    session: {
      ...nextSession,
      currentQuestion: nextQuestion,
      questionQueue: remainingQuestionQueue
    },
    evaluation
  });
}
