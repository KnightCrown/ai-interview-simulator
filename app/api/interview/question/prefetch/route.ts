import { NextResponse } from "next/server";
import { appendQueuedQuestion, generateQuestion, getNextQueuedQuestionTargetIndex } from "@/lib/interview-engine";
import { TURN_LIMIT } from "@/lib/interview-scoring";
import { InterviewSession } from "@/lib/interview-types";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    session: InterviewSession;
    pendingAnswer?: string;
    targetTurnIndex?: number;
  };
  const questionQueue = body.session.questionQueue ?? [];
  const targetTurnIndex = body.targetTurnIndex ?? getNextQueuedQuestionTargetIndex(body.session);

  if (body.session.interviewComplete || questionQueue.length > 0 || targetTurnIndex >= TURN_LIMIT) {
    return NextResponse.json({
      session: {
        ...body.session,
        questionQueue
      }
    });
  }

  const question = await generateQuestion({
    session: {
      ...body.session,
      questionQueue
    },
    targetTurnIndex,
    pendingAnswer: body.pendingAnswer
  });

  return NextResponse.json({
    session: appendQueuedQuestion(
      {
        ...body.session,
        questionQueue
      },
      question
    )
  });
}
