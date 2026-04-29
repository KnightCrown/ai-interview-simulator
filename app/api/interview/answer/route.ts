import { NextResponse } from "next/server";
import { applyTurnToSession, evaluateAnswer, generateQuestion } from "@/lib/interview-engine";
import { CandidateMoodSnapshot, InterviewSession, InterviewTurn } from "@/lib/interview-types";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    session: InterviewSession;
    transcript: string;
    durationSeconds: number;
    speechMetrics: InterviewTurn["speechMetrics"];
    faceMetrics: InterviewTurn["faceMetrics"];
    candidateMood?: CandidateMoodSnapshot | null;
  };

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
    id: crypto.randomUUID(),
    question: body.session.currentQuestion ?? "Interview question unavailable.",
    transcript: body.transcript,
    durationSeconds: body.durationSeconds,
    speechMetrics: body.speechMetrics,
    faceMetrics: body.faceMetrics,
    candidateMood: body.candidateMood ?? undefined,
    evaluation
  };

  const nextSession = applyTurnToSession(
    {
      ...body.session,
      questionQueue: []
    },
    turn
  );

  const nextQuestion = nextSession.interviewComplete
    ? null
    : await generateQuestion({
        session: nextSession,
        targetTurnIndex: nextSession.turns.length
      });

  return NextResponse.json({
    session: {
      ...nextSession,
      currentQuestion: nextQuestion,
      questionQueue: []
    },
    evaluation
  });
}
