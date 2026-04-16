import OpenAI from "openai";
import {
  AnswerEvaluation,
  FaceMetrics,
  FinalReport,
  InterviewSession,
  InterviewTurn,
  JobRole,
  ResumeProfile,
  SpeechMetrics
} from "@/lib/interview-types";
import { ROLE_EXPECTATIONS } from "@/lib/sample-data";

const TURN_LIMIT = 5;

function clampScore(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function detectStarStructure(transcript: string) {
  const lower = transcript.toLowerCase();
  let score = 35;

  if (lower.includes("situation") || lower.includes("context")) score += 15;
  if (lower.includes("task") || lower.includes("goal")) score += 15;
  if (lower.includes("action") || lower.includes("i built") || lower.includes("i led")) score += 20;
  if (lower.includes("result") || lower.includes("improved") || lower.includes("impact")) score += 15;

  return clampScore(score, 1, 100);
}

function keywordCoverageScore(transcript: string, keywords: string[]) {
  if (keywords.length === 0) {
    return 60;
  }

  const lower = transcript.toLowerCase();
  const hits = keywords.filter((keyword) =>
    keyword
      .toLowerCase()
      .split(/\s+/)
      .some((part) => lower.includes(part))
  ).length;

  return clampScore((hits / keywords.length) * 100);
}

function confidenceFromMetrics(speechMetrics: SpeechMetrics, faceMetrics: FaceMetrics) {
  const fillerPenalty = Math.min(25, speechMetrics.fillerCount * 4);
  const paceBonus = speechMetrics.speakingPace >= 95 && speechMetrics.speakingPace <= 170 ? 10 : 0;
  return clampScore(faceMetrics.engagementScore - fillerPenalty + paceBonus);
}

function inferMissingHighlights(transcript: string, resume: ResumeProfile | null) {
  if (!resume) {
    return [];
  }

  const lower = transcript.toLowerCase();
  return [...resume.skills, ...resume.experience].filter((entry) => !lower.includes(entry.toLowerCase()));
}

function buildImprovedAnswer(role: JobRole, resume: ResumeProfile | null, missingHighlights: string[]) {
  const resumeLine = resume
    ? `I'd connect this to my background as ${resume.role}, especially ${missingHighlights.slice(0, 2).join(" and ")}.`
    : "I'd ground the answer in a concrete example, a clear action I owned, and a measurable result.";

  return `A stronger ${role} answer would open with the situation, explain the decision you owned, and close with impact. ${resumeLine} Then I'd tie the story back to why that makes me effective in this role.`;
}

export function buildFallbackQuestion(role: JobRole, turns: InterviewTurn[]) {
  const stage = turns.length;
  const previousAnswer = turns.at(-1)?.transcript ?? "";

  const prompts: Record<number, string> = {
    0: `Tell me about a project that best demonstrates your fit for the ${role} role.`,
    1: "What tradeoff did you manage in that work, and how did you decide what to prioritize?",
    2: "If that project started slipping, how would you communicate risk and recover momentum?",
    3: "What would you do differently if you could revisit that experience today?",
    4: `Why should a hiring manager feel confident that you can create impact quickly in this ${role} role?`
  };

  if (stage > 0 && previousAnswer) {
    return `${prompts[stage] ?? prompts[4]} Please connect it to something specific you just mentioned.`;
  }

  return prompts[stage] ?? prompts[4];
}

export function buildFallbackEvaluation(input: {
  role: JobRole;
  transcript: string;
  speechMetrics: SpeechMetrics;
  faceMetrics: FaceMetrics;
  resume: ResumeProfile | null;
}): AnswerEvaluation {
  const { role, transcript, speechMetrics, faceMetrics, resume } = input;
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
  const missedOpportunity =
    missingResumeHighlights.length > 0
      ? `You did not connect your answer to ${missingResumeHighlights.slice(0, 2).join(" and ")}, which could have made your fit more concrete.`
      : `You could make the answer stronger by quantifying impact and linking it directly to ${role} expectations.`;

  return {
    clarity,
    relevance,
    structure,
    confidence,
    engagement,
    feedback: `Your answer was most effective when it sounded specific and grounded. To improve, reduce filler words and tie your story more directly to the ${role} role.`,
    missedOpportunity,
    missingResumeHighlights,
    improvedAnswer: buildImprovedAnswer(role, resume, missingResumeHighlights)
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
      hiringLikelihood: "Fail"
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

  let hiringLikelihood: FinalReport["hiringLikelihood"] = "Fail";
  if (overallScore >= 75) hiringLikelihood = "Pass";
  else if (overallScore >= 55) hiringLikelihood = "Borderline";

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
    hiringLikelihood
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

export async function generateQuestion(input: {
  role: JobRole;
  turns: InterviewTurn[];
  resume: ResumeProfile | null;
}) {
  const fallback = buildFallbackQuestion(input.role, input.turns);
  const openAiResponse = await generateWithOpenAI(`
You are an interview simulator for a ${input.role} role.
Generate exactly one concise interview question.
Make it dynamic based on the previous answers below.
Reference the candidate's prior answer if helpful.
Candidate resume context: ${JSON.stringify(input.resume)}
Previous turns: ${JSON.stringify(
    input.turns.map((turn) => ({
      question: turn.question,
      answer: turn.transcript,
      feedback: turn.evaluation.feedback
    }))
  )}
`);

  return openAiResponse?.trim() || fallback;
}

export async function evaluateAnswer(input: {
  role: JobRole;
  transcript: string;
  speechMetrics: SpeechMetrics;
  faceMetrics: FaceMetrics;
  resume: ResumeProfile | null;
  previousTurns: InterviewTurn[];
}) {
  const fallback = buildFallbackEvaluation(input);
  const openAiResponse = await generateWithOpenAI(`
You are grading a ${input.role} interview answer.
Return strict JSON with keys:
clarity, relevance, structure, confidence, engagement, feedback, missedOpportunity, missingResumeHighlights, improvedAnswer

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
    const parsed = JSON.parse(openAiResponse) as AnswerEvaluation;
    return {
      ...fallback,
      ...parsed,
      missingResumeHighlights: parsed.missingResumeHighlights ?? fallback.missingResumeHighlights
    };
  } catch {
    return fallback;
  }
}

export async function finalizeInterview(session: InterviewSession) {
  const fallback = buildFallbackFinalReport(session);
  const openAiResponse = await generateWithOpenAI(`
You are producing a final interview report.
Return strict JSON with keys:
overallScore, clarity, relevance, confidence, engagement, missedOpportunitySummary, bestImprovedAnswer, hiringLikelihood

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

export function buildSession(role: JobRole, resumeMode: "Use Sample Resume" | "Skip Resume", resume: ResumeProfile | null): InterviewSession {
  return {
    id: crypto.randomUUID(),
    role,
    resumeMode,
    resume,
    startedAt: new Date().toISOString(),
    turns: [],
    currentQuestion: null,
    interviewComplete: false
  };
}

export function shouldCompleteInterview(turns: InterviewTurn[]) {
  return turns.length >= TURN_LIMIT;
}
