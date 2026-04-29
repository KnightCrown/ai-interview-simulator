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
import { getRoleExpectations } from "@/lib/sample-data";

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
  const { role, turns, memory, difficulty } = session;
  const stage = turns.length;
  const previousAnswer = turns.at(-1)?.transcript ?? "";
  const previousWeakArea = memory.weakAreas[0];
  const roleSignals = getRoleExpectations(role).join(", ");
  const difficultyDirections = {
    Easy: {
      opening: "a clear, approachable",
      followUp: "Keep the prompt focused and confidence-building."
    },
    Medium: {
      opening: "a realistic",
      followUp: "Ask for concrete examples, tradeoffs, and impact."
    },
    Hard: {
      opening: "a challenging",
      followUp: "Press for depth, ambiguity, tradeoffs, and specific evidence."
    }
  } satisfies Record<InterviewSession["difficulty"], { opening: string; followUp: string }>;
  const direction = difficultyDirections[difficulty] ?? difficultyDirections.Medium;

  const prompts: Record<number, string> = {
    0: `Walk me through ${direction.opening} project that best proves you can succeed as a ${role}. I am listening for ${roleSignals}.`,
    1: `Earlier you mentioned that work. What tradeoff did you have to manage, and how did you decide? ${direction.followUp}`,
    2: `If that project started slipping, how would you communicate risk and recover momentum in a ${role} role? ${direction.followUp}`,
    3: `You have been strongest when you sound concrete. What would you do differently if you revisited that situation today? ${direction.followUp}`,
    4: `Final question: why should a hiring team move you to the next round for this ${role} role? ${difficulty === "Hard" ? "Give me evidence that would survive a skeptical debrief." : ""}`
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
  const expectations = getRoleExpectations(role);
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

function parseJsonObject<T>(content: string): Partial<T> | null {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1] ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Partial<T>;
  } catch {
    return null;
  }
}

function asString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asScore(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? clampScore(numeric, 1, 100) : fallback;
}

function asStringArray(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object" && "text" in item) return String(item.text).trim();
        return "";
      })
      .filter(Boolean);

    return items.length > 0 ? items : fallback;
  }

  if (typeof value === "string" && value.trim()) {
    const items = value
      .split(/\n|;|•/)
      .map((item) => item.trim())
      .filter(Boolean);

    return items.length > 0 ? items : [value.trim()];
  }

  return fallback;
}

function asMissedOpportunityDetails(value: unknown, fallback: AnswerEvaluation["missedOpportunityDetails"]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const details = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const detail = item as Record<string, unknown>;
      return {
        exactThing: asString(detail.exactThing, ""),
        source: asString(detail.source, "Interview answer"),
        whyItMattered: asString(detail.whyItMattered, "It would make the answer more specific and credible."),
        impactScoreIncrease: asScore(detail.impactScoreIncrease, 10)
      };
    })
    .filter((detail): detail is AnswerEvaluation["missedOpportunityDetails"][number] => Boolean(detail?.exactThing));

  return details.length > 0 ? details : fallback;
}

export function normalizeAnswerEvaluation(parsed: Partial<AnswerEvaluation>, fallback: AnswerEvaluation): AnswerEvaluation {
  return {
    clarity: asScore(parsed.clarity, fallback.clarity),
    relevance: asScore(parsed.relevance, fallback.relevance),
    structure: asScore(parsed.structure, fallback.structure),
    confidence: asScore(parsed.confidence, fallback.confidence),
    engagement: asScore(parsed.engagement, fallback.engagement),
    liveConfidence: asScore(parsed.liveConfidence, fallback.liveConfidence),
    feedback: asString(parsed.feedback, fallback.feedback),
    missedOpportunity: asString(parsed.missedOpportunity, fallback.missedOpportunity),
    missingResumeHighlights: asStringArray(parsed.missingResumeHighlights, fallback.missingResumeHighlights),
    missedOpportunityDetails: asMissedOpportunityDetails(parsed.missedOpportunityDetails, fallback.missedOpportunityDetails),
    improvedAnswer: asString(parsed.improvedAnswer, fallback.improvedAnswer),
    rewriteHighlights: asStringArray(parsed.rewriteHighlights, fallback.rewriteHighlights),
    interviewerReaction: asString(parsed.interviewerReaction, fallback.interviewerReaction),
    perceivedTone: asString(parsed.perceivedTone, fallback.perceivedTone),
    pressureLabel: asString(parsed.pressureLabel, fallback.pressureLabel)
  };
}

export function normalizeFinalReport(parsed: Partial<FinalReport>, fallback: FinalReport): FinalReport {
  const hiringLikelihood =
    parsed.hiringLikelihood === "Pass" || parsed.hiringLikelihood === "Borderline" || parsed.hiringLikelihood === "Fail"
      ? parsed.hiringLikelihood
      : fallback.hiringLikelihood;
  const hiringOutcome =
    parsed.hiringOutcome === "Selected" || parsed.hiringOutcome === "Borderline" || parsed.hiringOutcome === "Rejected"
      ? parsed.hiringOutcome
      : fallback.hiringOutcome;

  return {
    overallScore: asScore(parsed.overallScore, fallback.overallScore),
    clarity: asScore(parsed.clarity, fallback.clarity),
    relevance: asScore(parsed.relevance, fallback.relevance),
    confidence: asScore(parsed.confidence, fallback.confidence),
    engagement: asScore(parsed.engagement, fallback.engagement),
    missedOpportunitySummary: asString(parsed.missedOpportunitySummary, fallback.missedOpportunitySummary),
    bestImprovedAnswer: asString(parsed.bestImprovedAnswer, fallback.bestImprovedAnswer),
    hiringLikelihood,
    hiringOutcome,
    emotionalSummary: asString(parsed.emotionalSummary, fallback.emotionalSummary),
    strengths: asStringArray(parsed.strengths, fallback.strengths),
    weaknesses: asStringArray(parsed.weaknesses, fallback.weaknesses),
    interviewerNotes: asStringArray(parsed.interviewerNotes, fallback.interviewerNotes),
    suggestedNextImprovements: asStringArray(parsed.suggestedNextImprovements, fallback.suggestedNextImprovements)
  };
}

export async function generateQuestion(input: { session: InterviewSession }) {
  const fallback = buildFallbackQuestion(input.session);
  const roleExpectations = getRoleExpectations(input.session.role);
  const openAiResponse = await generateWithOpenAI(`
You are an interviewer running a realistic ${input.session.role} interview at ${input.session.difficulty} difficulty.
Behave like a real person with memory, light personality, and evolving strictness.
Generate exactly one concise interview question.
Reference previous answers when helpful.
Role research behavior:
- If the role is not a common preset, silently infer signals from 2-3 representative job descriptions for "${input.session.role}".
- Use likely responsibilities, tools, seniority expectations, success metrics, and common interview loops for that job.
- Do not mention that you performed research. Just ask a practical, role-specific interview question.
Known role expectation signals: ${JSON.stringify(roleExpectations)}
Difficulty behavior:
- Easy: supportive, clear, foundational questions.
- Medium: realistic behavioral and role-specific questions with tradeoffs.
- Hard: rigorous, skeptical, senior-style questions that pressure-test evidence and judgment.
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

Return only a JSON object. Do not wrap it in markdown.
Be specific and slightly more realistic than a tutoring app.
Memory: ${JSON.stringify(input.memory)}
Candidate resume context: ${JSON.stringify(input.resume)}
Previous turns: ${JSON.stringify(input.previousTurns)}
Transcript: ${input.transcript}
Speech metrics: ${JSON.stringify(input.speechMetrics)}
Face metrics: ${JSON.stringify(input.faceMetrics)}
Role expectations: ${JSON.stringify(getRoleExpectations(input.role))}
`);

  if (!openAiResponse) {
    return fallback;
  }

  try {
    const parsed = parseJsonObject<AnswerEvaluation>(openAiResponse);
    if (!parsed) {
      return fallback;
    }

    return normalizeAnswerEvaluation(parsed, fallback);
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

Return only a JSON object. Do not wrap it in markdown.
Session: ${JSON.stringify(session)}
`);

  if (!openAiResponse) {
    return fallback;
  }

  try {
    const parsed = parseJsonObject<FinalReport>(openAiResponse);
    if (!parsed) {
      return fallback;
    }

    return normalizeFinalReport(parsed, fallback);
  } catch {
    return fallback;
  }
}

export function buildSession(role: JobRole, difficulty: InterviewSession["difficulty"], resumeMode: "Use Sample Resume" | "Skip Resume", resume: ResumeProfile | null): InterviewSession {
  return {
    id: crypto.randomUUID(),
    role,
    difficulty,
    resumeMode,
    resume,
    startedAt: new Date().toISOString(),
    turns: [],
    currentQuestion: null,
    interviewComplete: false,
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
