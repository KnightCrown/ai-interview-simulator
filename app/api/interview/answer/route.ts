import { NextResponse } from "next/server";
import { evaluateAnswer, generateQuestion, shouldCompleteInterview } from "@/lib/interview-engine";
import { InterviewSession, InterviewTurn } from "@/lib/interview-types";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    session: InterviewSession;
    transcript: string;
    durationSeconds: number;
    speechMetrics: InterviewTurn["speechMetrics"];
    faceMetrics: InterviewTurn["faceMetrics"];
  };

  const evaluation = await evaluateAnswer({
    role: body.session.role,
    transcript: body.transcript,
    speechMetrics: body.speechMetrics,
    faceMetrics: body.faceMetrics,
    resume: body.session.resume,
    previousTurns: body.session.turns
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

  const turns = [...body.session.turns, turn];
  const interviewComplete = shouldCompleteInterview(turns);
  const nextQuestion = interviewComplete
    ? null
    : await generateQuestion({
        role: body.session.role,
        turns,
        resume: body.session.resume
      });

  return NextResponse.json({
    session: {
      ...body.session,
      turns,
      currentQuestion: nextQuestion,
      interviewComplete
    },
    evaluation
  });
}
