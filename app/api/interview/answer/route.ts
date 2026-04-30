import { NextResponse } from "next/server";
import { applyTurnToSession, evaluateAnswer, generateQuestion, shouldCompleteInterview } from "@/lib/interview-engine";
import { AnswerEvaluation, CandidateMoodSnapshot, InterviewSession, InterviewTurn } from "@/lib/interview-types";

// Neutral placeholder evaluation used only inside the optimistic in-flight turn we
// hand to generateQuestion while the real evaluation is still in flight on the other
// branch of the Promise.all. It is replaced with the real evaluation before any
// session state is persisted, so it never reaches the client or memory updater.
const PLACEHOLDER_EVAL: AnswerEvaluation = {
  clarity: 50,
  relevance: 50,
  structure: 50,
  confidence: 50,
  engagement: 50,
  liveConfidence: 50,
  feedback: "",
  missedOpportunity: "",
  missingResumeHighlights: [],
  missedOpportunityDetails: [],
  improvedAnswer: "",
  rewriteHighlights: [],
  interviewerReaction: "",
  perceivedTone: "",
  pressureLabel: ""
};

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
  const baseTurn = {
    id: turnId,
    question: body.session.currentQuestion ?? "Interview question unavailable.",
    transcript: body.transcript,
    durationSeconds: body.durationSeconds,
    speechMetrics: body.speechMetrics,
    faceMetrics: body.faceMetrics,
    candidateMood: body.candidateMood ?? undefined
  } as const;

  const inflightTurn: InterviewTurn = {
    ...baseTurn,
    evaluation: PLACEHOLDER_EVAL
  };

  const optimisticTurns = [...body.session.turns, inflightTurn];
  const interviewWillComplete = shouldCompleteInterview(optimisticTurns);
  const optimisticSession: InterviewSession = {
    ...body.session,
    turns: optimisticTurns,
    questionQueue: []
  };

  const [evaluation, nextQuestion] = await Promise.all([
    evaluateAnswer({
      role: body.session.role,
      difficulty: body.session.difficulty,
      transcript: body.transcript,
      speechMetrics: body.speechMetrics,
      faceMetrics: body.faceMetrics,
      candidateMood: body.candidateMood ?? null,
      resume: body.session.resume,
      previousTurns: body.session.turns,
      memory: body.session.memory
    }),
    interviewWillComplete
      ? Promise.resolve(null)
      : generateQuestion({
          session: optimisticSession,
          targetTurnIndex: optimisticTurns.length
        })
  ]);

  const turn: InterviewTurn = {
    ...baseTurn,
    evaluation
  };

  const nextSession = applyTurnToSession(
    {
      ...body.session,
      questionQueue: []
    },
    turn
  );

  return NextResponse.json({
    session: {
      ...nextSession,
      currentQuestion: nextQuestion,
      questionQueue: []
    },
    evaluation
  });
}
