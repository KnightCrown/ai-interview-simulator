import OpenAI from "openai";
import {
  AnswerEvaluation,
  FinalReport,
  HiringLikelihood,
  InterviewSession,
  InterviewTurn,
  JobRole,
  ResumeProfile,
  SpeechMetrics
} from "@/lib/interview-types";
import {
  advanceHiringStage,
  buildDemoTranscript,
  buildImprovedAnswer,
  buildMissedOpportunityDetails,
  buildRewriteHighlights,
  clampScore,
  confidenceFromMetrics,
  createInitialMemory,
  deriveHiringOutcome,
  derivePerceivedTone,
  derivePressureLabel,
  detectStarStructure,
  inferMissingHighlights,
  keywordCoverageScore,
  liveConfidenceFromSignals,
  TURN_LIMIT,
  updateMemory
} from "@/lib/interview-scoring";
import { ROLE_EXPECTATIONS } from "@/lib/sample-data";

function buildInterviewerReaction(input: {
  role: JobRole;
  liveConfidence: number;
  previousWeakAreas: string[];
  strictness: number;
}) {
  const { role, liveConfidence, previousWeakAreas, strictness } = input;

  if (liveConfidence >= 80) {
    return `That's interesting. You're sounding strong for this ${role} interview, so let's go deeper.`;
  }

  if (strictness >= 70 || previousWeakAreas.length > 0) {
    return `Can you be more specific? Earlier I was still looking for stronger evidence around ${previousWeakAreas[0] ?? "depth"}.`;
  }

  if (liveConfidence <= 50) {
    return "You're on the right track, but slow down and give me one concrete example with impact.";
  }

  return "That's good, but I want to go deeper on how you personally drove the outcome.";
}

export function buildFallbackQuestion(session: InterviewSession) {
  const { role, turns, memory } = session;
  const stage = turns.length;
  const previousAnswer = turns.at(-1)?.transcript ?? "";
  const previousWeakArea = memory.weakAreas[0];

  const prompts: Record<number, string> = {
    0: `Walk me through a project that best proves you can succeed as a ${role}.`,
    1: `Earlier you mentioned that work. What tradeoff did you have to manage, and how did you decide?`,
    2: `If that project started slipping, how would you communicate risk and recover momentum?`,
    3: `You have been strongest when you sound concrete. What would you do differently if you revisited that situation today?`,
    4: `Final question: why should a hiring team move you to the next round for this ${role} role?`
  };

  const prompt = prompts[stage] ?? prompts[4];

  if (stage > 0 && previousAnswer) {
    if (memory.strictness >= 70 && previousWeakArea) {
      return `${prompt} Earlier you left me wanting more around ${previousWeakArea}. Address that directly.`;
    }

    return `${prompt} Earlier you mentioned ${previousAnswer.split(" ").slice(0, 8).join(" ")}... Can you expand on that?`;
  }

  return prompt;
}

export function buildFallbackEvaluation(input: {
  role: JobRole;
  transcript: string;
  speechMetrics: SpeechMetrics;
  faceMetrics: InterviewTurn["faceMetrics"];
  resume: ResumeProfile | null;
  strictness?: number;
  previousWeakAreas?: string[];
}): AnswerEvaluation {
  const { role, transcript, speechMetrics, faceMetrics, resume, strictness = 55, previousWeakAreas = [] } = input;
  const expectations = ROLE_EXPECTATIONS[role];
  const missingResumeHighlights = inferMissingHighlights(transcript, resume);
  const clarity = clampScore(
    transcript.split(/\s+/).filter(Boolean).length * 2 +
      faceMetrics.headStability * 0.15 -
      speechMetrics.fillerCount * 6,
    1,
    100
  );
  const relevance = clampScore(keywordCoverageScore(transcript, expectations), 1, 100);
  const structure = detectStarStructure(transcript);
  const engagement = faceMetrics.engagementScore;
  const confidence = confidenceFromMetrics(speechMetrics, faceMetrics);
  const liveConfidence = liveConfidenceFromSignals({ role, transcript, speechMetrics, faceMetrics });
  const missedOpportunityDetails = buildMissedOpportunityDetails(role, transcript, resume);
  const missedOpportunity =
    missedOpportunityDetails[0]?.exactThing ??
    `You could make the answer stronger by quantifying impact and linking it directly to ${role} expectations.`;
  const improvedAnswer = buildImprovedAnswer(role, resume, missingResumeHighlights, transcript);
  const perceivedTone = derivePerceivedTone({ clarity, relevance, structure, confidence });
  const interviewerReaction = buildInterviewerReaction({
    role,
    liveConfidence,
    previousWeakAreas,
    strictness
  });

  return {
    clarity,
    relevance,
    structure,
    confidence,
    engagement,
    liveConfidence,
    feedback: `You sounded most persuasive when you were specific. To improve, reduce filler words, tighten the story arc, and tie your example more directly to the ${role} role.`,
    missedOpportunity,
    missingResumeHighlights,
    missedOpportunityDetails,
    improvedAnswer,
    rewriteHighlights: buildRewriteHighlights(transcript, improvedAnswer),
    interviewerReaction,
    perceivedTone,
    pressureLabel: derivePressureLabel(liveConfidence)
  };
}

export function buildFallbackFinalReport(session: InterviewSession): FinalReport {
  const turns = session.turns;

  if (turns.length === 0) {
    return {
      overallScore: 0,
      clarity: 0,
      relevance: 0,
      confidence: 0,
      engagement: 0,
      missedOpportunitySummary: "No interview answers were captured.",
      bestImprovedAnswer: "Try another session to generate a tailored improved answer.",
      hiringLikelihood: "Fail",
      hiringOutcome: "Rejected",
      emotionalSummary: "Hard to assess because the interview ended before any full answer was captured.",
      strengths: ["Session setup complete"],
      weaknesses: ["No answer data yet"],
      interviewerNotes: ["The candidate ended the interview before a full evaluation could be formed."],
      suggestedNextImprovements: ["Complete at least three answers to generate a fuller recruiter-style report."]
    };
  }

  const average = (selector: (turn: InterviewTurn) => number) =>
    clampScore(turns.reduce((sum, turn) => sum + selector(turn), 0) / turns.length);

  const clarity = average((turn) => turn.evaluation.clarity);
  const relevance = average((turn) => turn.evaluation.relevance);
  const confidence = average((turn) => turn.evaluation.confidence);
  const engagement = average((turn) => turn.evaluation.engagement);
  const overallScore = clampScore((clarity + relevance + confidence + engagement) / 4);
  const mostCommonGap = turns
    .flatMap((turn) => turn.evaluation.missingResumeHighlights)
    .reduce<Record<string, number>>((acc, item) => {
      acc[item] = (acc[item] ?? 0) + 1;
      return acc;
    }, {});
  const [gap] = Object.entries(mostCommonGap).sort((a, b) => b[1] - a[1])[0] ?? [];
  const bestImprovedAnswer =
    turns.slice().sort((a, b) => b.evaluation.structure - a.evaluation.structure)[0]?.evaluation.improvedAnswer ??
    "Use a STAR-based answer with specific impact.";

  let hiringLikelihood: HiringLikelihood = "Fail";
  if (overallScore >= 75) hiringLikelihood = "Pass";
  else if (overallScore >= 55) hiringLikelihood = "Borderline";

  const strengths = Array.from(new Set(session.memory.strengthSignals.length ? session.memory.strengthSignals : ["Professional baseline communication"]));
  const weaknesses = Array.from(new Set(session.memory.weakAreas.length ? session.memory.weakAreas : ["Depth under pressure"]));

  return {
    overallScore,
    clarity,
    relevance,
    confidence,
    engagement,
    missedOpportunitySummary: gap
      ? `Your most repeated missed opportunity was not highlighting ${gap}.`
      : "The biggest opportunity is making each answer more role-specific and impact-oriented.",
    bestImprovedAnswer,
    hiringLikelihood,
    hiringOutcome: deriveHiringOutcome(overallScore),
    emotionalSummary:
      overallScore >= 75
        ? "You came across as composed, credible, and capable of handling interview pressure."
        : overallScore >= 55
          ? "You came across as promising, but your strongest ideas did not always land with enough depth."
          : "You came across as thoughtful but underpowered, with too many moments where the impact of your work stayed unclear.",
    strengths,
    weaknesses,
    interviewerNotes: [
      `The interviewer ended the process feeling ${session.memory.interviewerMood.toLowerCase()}.`,
      `Tone across the interview read as: ${session.memory.toneSummary}.`,
      `The strongest progression signal was the candidate's position in the funnel at ${session.currentStage}.`
    ],
    suggestedNextImprovements: [
      "Lead answers with one clear example before expanding.",
      "Quantify impact earlier instead of saving it for the end.",
      "Use resume evidence more aggressively when questions match past work."
    ]
  };
}

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  return new OpenAI({ apiKey });
}

async function generateWithOpenAI(prompt: string) {
  const client = getClient();
  if (!client) {
    return null;
  }

  const response = await client.responses.create({
    model: "gpt-4.1-mini",
    input: prompt
  });

  return response.output_text;
}

export async function generateQuestion(input: { session: InterviewSession }) {
  const fallback = buildFallbackQuestion(input.session);
  const openAiResponse = await generateWithOpenAI(`
You are an interviewer running a realistic ${input.session.role} interview.
Behave like a real person with memory, light personality, and evolving strictness.
Generate exactly one concise interview question.
Reference previous answers when helpful.
Memory: ${JSON.stringify(input.session.memory)}
Current stage: ${input.session.currentStage}
Previous turns: ${JSON.stringify(
    input.session.turns.map((turn) => ({
      question: turn.question,
      answer: turn.transcript,
      feedback: turn.evaluation.feedback,
      reaction: turn.evaluation.interviewerReaction,
      weakAreas: turn.evaluation.missingResumeHighlights
    }))
  )}
Resume context: ${JSON.stringify(input.session.resume)}
`);

  return openAiResponse?.trim() || fallback;
}

export async function evaluateAnswer(input: {
  role: JobRole;
  transcript: string;
  speechMetrics: SpeechMetrics;
  faceMetrics: InterviewTurn["faceMetrics"];
  resume: ResumeProfile | null;
  previousTurns: InterviewTurn[];
  memory: InterviewSession["memory"];
}) {
  const fallback = buildFallbackEvaluation({
    role: input.role,
    transcript: input.transcript,
    speechMetrics: input.speechMetrics,
    faceMetrics: input.faceMetrics,
    resume: input.resume,
    strictness: input.memory.strictness,
    previousWeakAreas: input.memory.weakAreas
  });
  const openAiResponse = await generateWithOpenAI(`
You are grading a ${input.role} interview answer.
Return strict JSON with keys:
clarity, relevance, structure, confidence, engagement, liveConfidence, feedback, missedOpportunity, missingResumeHighlights, missedOpportunityDetails, improvedAnswer, rewriteHighlights, interviewerReaction, perceivedTone, pressureLabel

Be specific and slightly more realistic than a tutoring app.
Memory: ${JSON.stringify(input.memory)}
Candidate resume context: ${JSON.stringify(input.resume)}
Previous turns: ${JSON.stringify(input.previousTurns)}
Transcript: ${input.transcript}
Speech metrics: ${JSON.stringify(input.speechMetrics)}
Face metrics: ${JSON.stringify(input.faceMetrics)}
Role expectations: ${JSON.stringify(ROLE_EXPECTATIONS[input.role])}
`);

  if (!openAiResponse) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(openAiResponse) as Partial<AnswerEvaluation>;
    return {
      ...fallback,
      ...parsed,
      missingResumeHighlights: parsed.missingResumeHighlights ?? fallback.missingResumeHighlights,
      missedOpportunityDetails: parsed.missedOpportunityDetails ?? fallback.missedOpportunityDetails,
      rewriteHighlights: parsed.rewriteHighlights ?? fallback.rewriteHighlights
    };
  } catch {
    return fallback;
  }
}

export async function finalizeInterview(session: InterviewSession) {
  const fallback = buildFallbackFinalReport(session);
  const openAiResponse = await generateWithOpenAI(`
You are producing a polished final hiring report.
Return strict JSON with keys:
overallScore, clarity, relevance, confidence, engagement, missedOpportunitySummary, bestImprovedAnswer, hiringLikelihood, hiringOutcome, emotionalSummary, strengths, weaknesses, interviewerNotes, suggestedNextImprovements

Session: ${JSON.stringify(session)}
`);

  if (!openAiResponse) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(openAiResponse) as FinalReport;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

export function buildSession(role: JobRole, resumeMode: "Use Sample Resume" | "Skip Resume", resume: ResumeProfile | null, demoMode = false): InterviewSession {
  return {
    id: crypto.randomUUID(),
    role,
    resumeMode,
    resume,
    startedAt: new Date().toISOString(),
    turns: [],
    currentQuestion: null,
    interviewComplete: false,
    demoMode,
    currentStage: "Applied",
    hiringOutcome: null,
    liveConfidence: 50,
    memory: createInitialMemory()
  };
}

export function shouldCompleteInterview(turns: InterviewTurn[]) {
  return turns.length >= TURN_LIMIT;
}

export function applyTurnToSession(session: InterviewSession, turn: InterviewTurn) {
  const turns = [...session.turns, turn];
  const answerStrength = clampScore(
    (turn.evaluation.liveConfidence + turn.evaluation.relevance + turn.evaluation.structure + turn.evaluation.confidence) / 4
  );
  const currentStage = advanceHiringStage(session.currentStage, answerStrength);
  const memory = updateMemory(session.memory, turn);
  const interviewComplete = shouldCompleteInterview(turns);
  const averageConfidence = clampScore(
    turns.reduce((sum, currentTurn) => sum + currentTurn.evaluation.liveConfidence, 0) / turns.length
  );

  return {
    ...session,
    turns,
    currentStage,
    liveConfidence: averageConfidence,
    memory,
    hiringOutcome: interviewComplete ? deriveHiringOutcome(answerStrength) : session.hiringOutcome,
    interviewComplete
  };
}

export function buildDemoTurn(role: JobRole, index: number, resume: ResumeProfile | null, memory: InterviewSession["memory"]) {
  const transcript = buildDemoTranscript(role, index);
  const speechMetrics = {
    fillerCount: index === 1 ? 1 : 0,
    fillerWords: index === 1 ? ["um"] : [],
    speakingPace: 122 + index * 4
  };
  const faceMetrics = {
    eyeContact: 78 + index,
    headStability: 74 + index,
    engagementScore: 76 + index
  };
  const evaluation = buildFallbackEvaluation({
    role,
    transcript,
    speechMetrics,
    faceMetrics,
    resume,
    strictness: memory.strictness,
    previousWeakAreas: memory.weakAreas
  });

  return {
    id: crypto.randomUUID(),
    question: "",
    transcript,
    durationSeconds: 35 + index * 4,
    speechMetrics,
    faceMetrics,
    evaluation
  };
}
