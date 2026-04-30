import OpenAI from "openai";
import {
  AnswerEvaluation,
  CandidateMoodSnapshot,
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
import { isTranscriptSubstantive } from "@/lib/transcript-utils";

function buildInterviewerReaction(input: {
  role: JobRole;
  liveConfidence: number;
  previousWeakAreas: string[];
  strictness: number;
}) {
  const { role, liveConfidence, previousWeakAreas, strictness } = input;

  if (liveConfidence >= 80) {
    return `I'm hearing real strength for this ${role} interview. I trust the direction, and now I want to pressure-test the depth behind it.`;
  }

  if (strictness >= 70 || previousWeakAreas.length > 0) {
    return `I'm still concerned about ${(previousWeakAreas[0] ?? "depth").toLowerCase()}. I need stronger evidence before I would feel confident moving this forward.`;
  }

  if (liveConfidence <= 50) {
    return "I'm concerned the answer is still too broad. I need one concrete example with clearer ownership and impact.";
  }

  return "I'm interested, but I'm still looking for clearer personal ownership and a sharper link between the work and the outcome.";
}

export function buildFallbackQuestion(
  session: InterviewSession,
  options: { targetTurnIndex?: number; pendingAnswer?: string | null } = {}
) {
  const { role, turns, memory, difficulty } = session;
  const stage = options.targetTurnIndex ?? turns.length;
  const previousAnswer = options.pendingAnswer?.trim() || turns.at(-1)?.transcript || "";
  const previousWeakArea = memory.weakAreas[0];
  const isFollowUpQuestion = stage === 1 || stage === 3;

  if (isFollowUpQuestion && !isTranscriptSubstantive(previousAnswer)) {
    return `I still need a real answer to what I asked—you haven't spoken to it yet. Let me ask again directly: give me one concrete ${role} example where you owned the outcome, what constraint you faced, and what measurably changed. I am listening for specifics, not a headline.`;
  }

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

  if (stage === 0 || !isFollowUpQuestion) {
    return prompt;
  }

  let tail = "";

  if (stage > 0 && previousAnswer) {
    if (memory.strictness >= 70 && previousWeakArea) {
      tail = ` Earlier you left me wanting more around ${previousWeakArea}. Address that directly.`;
    } else {
      tail = ` Earlier you mentioned ${previousAnswer.split(" ").slice(0, 8).join(" ")}... Can you expand on that?`;
    }
  }

  if (stage === 3 && turns.length >= 2) {
    const priorInterviewerFeedback = turns[turns.length - 2]?.evaluation?.feedback?.trim();
    if (priorInterviewerFeedback) {
      tail = `${tail} In your prior feedback to the candidate (after the answer before their last one), you said: ${priorInterviewerFeedback}`;
    }
  }

  return `${prompt}${tail}`;
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

function buildEmptyAnswerEvaluation(input: {
  role: JobRole;
  transcript: string;
  speechMetrics: SpeechMetrics;
  faceMetrics: InterviewTurn["faceMetrics"];
  resume: ResumeProfile | null;
  strictness?: number;
  previousWeakAreas?: string[];
}): AnswerEvaluation {
  const { role, transcript, speechMetrics, faceMetrics, resume } = input;
  const clarity = 5;
  const relevance = 4;
  const structure = 5;
  const confidence = 6;
  const engagement = clampScore(faceMetrics.engagementScore * 0.2 - speechMetrics.fillerCount * 3, 1, 22);
  const liveConfidence = 8;
  const missingResumeHighlights = inferMissingHighlights(transcript, resume);
  const missedOpportunityDetails = buildMissedOpportunityDetails(role, transcript, resume);
  const missedOpportunity =
    missedOpportunityDetails[0]?.exactThing ??
    "There was no answer content to evaluate—this costs credibility fast in a real loop.";
  const improvedAnswer = buildImprovedAnswer(role, resume, missingResumeHighlights, transcript || " ");

  return {
    clarity,
    relevance,
    structure,
    confidence,
    engagement,
    liveConfidence,
    feedback:
      "No substantive answer was captured—you submitted without addressing the question. In a real interview that reads as disengagement or lack of preparation. Speak out loud with at least one concrete example next time.",
    missedOpportunity,
    missingResumeHighlights,
    missedOpportunityDetails,
    improvedAnswer,
    rewriteHighlights: buildRewriteHighlights(transcript, improvedAnswer),
    interviewerReaction:
      "I'm concerned—they didn't answer my question at all. That signals they're either unprepared or not taking this seriously, and I can't move forward without substance. I need them to engage directly or this process doesn't work.",
    perceivedTone: "Disengaged / non-responsive",
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
      strengthDescriptions: ["The session was configured and ready to go."],
      weaknesses: ["No answer data yet"],
      weaknessDescriptions: ["Complete at least three answers to generate a meaningful evaluation."],
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
    strengthDescriptions: strengths.map(() => "This came through in your answers and worked in your favour with the interviewer."),
    weaknesses,
    weaknessDescriptions: weaknesses.map(() => "Strengthening this area would make your answers more persuasive and easier to act on."),
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

let missingOpenAiKeyLogged = false;

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    if (process.env.NODE_ENV === "development" && !missingOpenAiKeyLogged) {
      missingOpenAiKeyLogged = true;
      console.warn(
        "[interview-engine] OPENAI_API_KEY is missing or empty — LLM questions and grading fall back to built-in templates. Add OPENAI_API_KEY to .env.local."
      );
    }
    return null;
  }

  return new OpenAI({ apiKey });
}

async function generateWithOpenAI(prompt: string) {
  const client = getClient();
  if (!client) {
    return null;
  }

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt
    });

    const text = response.output_text?.trim();
    return text || null;
  } catch (error) {
    console.error("[interview-engine] OpenAI request failed:", error instanceof Error ? error.message : error);
    return null;
  }
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

  const strengths = asStringArray(parsed.strengths, fallback.strengths);
  const weaknesses = asStringArray(parsed.weaknesses, fallback.weaknesses);

  const rawStrengthDescriptions = asStringArray(parsed.strengthDescriptions, fallback.strengthDescriptions);
  const rawWeaknessDescriptions = asStringArray(parsed.weaknessDescriptions, fallback.weaknessDescriptions);

  // Ensure description arrays are the same length as their paired item arrays,
  // padding with fallback values if the LLM returned fewer entries.
  const strengthDescriptions = strengths.map(
    (_, i) => rawStrengthDescriptions[i] ?? fallback.strengthDescriptions[i] ?? fallback.strengthDescriptions[0]
  );
  const weaknessDescriptions = weaknesses.map(
    (_, i) => rawWeaknessDescriptions[i] ?? fallback.weaknessDescriptions[i] ?? fallback.weaknessDescriptions[0]
  );

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
    strengths,
    strengthDescriptions,
    weaknesses,
    weaknessDescriptions,
    interviewerNotes: asStringArray(parsed.interviewerNotes, fallback.interviewerNotes),
    suggestedNextImprovements: asStringArray(parsed.suggestedNextImprovements, fallback.suggestedNextImprovements)
  };
}

function buildSequentialQuestionInstructions(session: InterviewSession, targetTurnIndex: number) {
  const { role, turns } = session;
  const isFollowUpQuestion = targetTurnIndex === 1 || targetTurnIndex === 3;
  const lastAnswer = turns.at(-1)?.transcript?.trim() ?? "";
  const lastAnswerEmpty = !isTranscriptSubstantive(lastAnswer);

  if (targetTurnIndex === 0) {
    return `SEQUENTIAL QUESTION RULES — Question 1 only:
- Ground the question in the job role, resume/CV context, difficulty, and role expectation signals below.
- Do not reference any prior interview answers, transcripts, or feedback (there are none yet).
- Do not pretend the candidate already spoke.`;
  }

  if (isFollowUpQuestion && lastAnswerEmpty) {
    return `SEQUENTIAL QUESTION RULES — Question ${targetTurnIndex + 1}:
- The candidate did NOT provide a substantive answer to your previous question (blank, silence, or empty submission).
- Your question MUST open by stating clearly that they have not answered what you asked (firm but professional—no sarcasm).
- Briefly restate or paraphrase the core of your prior question, then ask it again in fresh wording.
- Insist on a concrete, spoken answer with specifics relevant to ${JSON.stringify(role)}. Do not invent substance from their prior "answer"—there was none to build on.
- Do not greet, thank, or use pleasantries.`;
  }

  if (!isFollowUpQuestion) {
    const emptyPriorNote = lastAnswerEmpty
      ? `
- The candidate's immediately prior answer was missing or non-substantive. Acknowledge that briefly if appropriate, but move forward with a new competency—do not pretend they answered well.
`
      : "";

    return `SEQUENTIAL QUESTION RULES — Question ${targetTurnIndex + 1}:
- This question should be a fresh, standalone question (not a direct follow-up).
- Keep it role-specific and resume-aware, but do NOT anchor it to the immediately previous answer as a direct follow-up.
- You MUST still use prior interview context (earlier questions, answers, and feedback) to avoid repeating what has already been covered.
- Introduce a new angle or competency that has not been adequately tested yet, similar to how a real interviewer broadens coverage across the interview.
- If a competency has already been explored deeply, move to another relevant area instead of re-asking the same thing.
- Do not greet/reintroduce yourself or use filler openers.${emptyPriorNote}`;
  }

  return `SEQUENTIAL QUESTION RULES — Question ${targetTurnIndex + 1}:
- This question must be a direct follow-up to what the candidate just said.
- Probe deeper, clarify tradeoffs, challenge assumptions, or pressure-test evidence from the latest answer.
- Candidate's most recent answer: ${JSON.stringify(lastAnswer)}
- Keep the job role and resume/CV context in mind: role ${JSON.stringify(role)}`;
}

export async function generateQuestion(input: {
  session: InterviewSession;
  targetTurnIndex?: number;
  pendingAnswer?: string | null;
}) {
  const targetTurnIndex = input.targetTurnIndex ?? input.session.turns.length;
  const fallback = buildFallbackQuestion(input.session, {
    targetTurnIndex,
    pendingAnswer: input.pendingAnswer
  });
  const roleExpectations = getRoleExpectations(input.session.role);
  const preparedQuestions = [input.session.currentQuestion, ...(input.session.questionQueue ?? [])].filter(Boolean);
  const sequentialInstructions = buildSequentialQuestionInstructions(input.session, targetTurnIndex);
  const openAiResponse = await generateWithOpenAI(`
You are an interviewer running a realistic ${input.session.role} interview at ${input.session.difficulty} difficulty.
Behave like a real person with memory, light personality, and evolving strictness.
Generate exactly one concise interview question for question ${targetTurnIndex + 1} of ${TURN_LIMIT}.

${sequentialInstructions}

Avoid repeating any question text you already asked. Already-asked or queued wording to avoid: ${JSON.stringify(preparedQuestions)}

Conversation continuity rules:
- Question 1 may open naturally.
- For question 2 or later, do not greet the candidate, reintroduce yourself, say "great/nice to meet you", say "thanks", or use an opener like "for this next question".

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
Full turn history (for extra continuity if needed): ${JSON.stringify(
    input.session.turns.map((turn) => ({
      question: turn.question,
      answer: turn.transcript,
      candidateMood: turn.candidateMood ?? null,
      feedback: turn.evaluation.feedback,
      reaction: turn.evaluation.interviewerReaction,
      weakAreas: turn.evaluation.missingResumeHighlights
    }))
  )}
Most recent completed answer apparent mood (use this like a real interviewer deciding tone and empathy): ${JSON.stringify(input.session.turns.at(-1)?.candidateMood ?? null)}
Resume / CV context: ${JSON.stringify(input.session.resume)}
`);

  return openAiResponse?.trim() || fallback;
}

export function getNextQueuedQuestionTargetIndex(session: InterviewSession) {
  return session.turns.length + 1 + (session.questionQueue ?? []).length;
}

export function appendQueuedQuestion(session: InterviewSession, question: string) {
  const questionQueue = session.questionQueue ?? [];

  if (!question.trim() || questionQueue.includes(question) || session.currentQuestion === question) {
    return session;
  }

  return {
    ...session,
    questionQueue: [...questionQueue, question]
  };
}

export async function evaluateAnswer(input: {
  role: JobRole;
  difficulty: InterviewSession["difficulty"];
  transcript: string;
  speechMetrics: SpeechMetrics;
  faceMetrics: InterviewTurn["faceMetrics"];
  candidateMood?: CandidateMoodSnapshot | null;
  resume: ResumeProfile | null;
  previousTurns: InterviewTurn[];
  memory: InterviewSession["memory"];
}) {
  const isEmptyAnswer = !isTranscriptSubstantive(input.transcript);

  const fallback = isEmptyAnswer
    ? buildEmptyAnswerEvaluation({
        role: input.role,
        transcript: input.transcript,
        speechMetrics: input.speechMetrics,
        faceMetrics: input.faceMetrics,
        resume: input.resume,
        strictness: input.memory.strictness,
        previousWeakAreas: input.memory.weakAreas
      })
    : buildFallbackEvaluation({
        role: input.role,
        transcript: input.transcript,
        speechMetrics: input.speechMetrics,
        faceMetrics: input.faceMetrics,
        resume: input.resume,
        strictness: input.memory.strictness,
        previousWeakAreas: input.memory.weakAreas
      });

  const emptyAnswerNote = isEmptyAnswer
    ? `CRITICAL: The candidate provided NO substantive answer — the transcript is blank or contains only silence/filler.
- Set all scores to reflect this severely: clarity 1–8, relevance 1–6, structure 1–8, confidence 1–8, engagement 1–20, liveConfidence 1–10.
- Do NOT invent or assume any content from the candidate.
- Write interviewerReaction as a varied, natural first-person internal monologue expressing genuine concern, frustration, or skepticism about the non-engagement. Each session may warrant a different angle — e.g. wondering if they misunderstood, feeling the process is stalling, or noting this is a red flag. Do not repeat stock phrasing.
- perceivedTone must reflect disengagement (e.g. "Disengaged", "Evasive", "Non-responsive", "Unprepared").
- feedback must note that no substantive answer was given and explain the real-world impact on a hiring decision.`
    : "";

  const openAiResponse = await generateWithOpenAI(`
You are grading a ${input.role} interview answer.
Return strict JSON with keys:
clarity, relevance, structure, confidence, engagement, liveConfidence, feedback, missedOpportunity, missingResumeHighlights, missedOpportunityDetails, improvedAnswer, rewriteHighlights, interviewerReaction, perceivedTone, pressureLabel

Return only a JSON object. Do not wrap it in markdown.
Be specific and slightly more realistic than a tutoring app.
Write interviewerReaction as the interviewer's first-person internal monologue. Use language like "I'm concerned...", "I'm looking for...", or "I trust...".
Do not write detached phrases like "the interviewer likely", "the interviewer might", or "the interviewer would".
Keep interviewerReaction to 1-3 direct sentences.
${emptyAnswerNote}
Difficulty calibration (critical):
- Easy: supportive and coach-like. Be lenient on rough edges, and only flag major misses.
- Medium: realistic and professionally skeptical. Do NOT be overly generous. Reserve 85+ scores for clearly exceptional, evidence-backed answers.
- Hard: strict senior-interviewer bar. Be difficult to impress, aggressively penalize vague claims, and require tradeoffs, ownership, and measurable impact for strong scores.
Memory: ${JSON.stringify(input.memory)}
Candidate resume context: ${JSON.stringify(input.resume)}
Previous turns: ${JSON.stringify(input.previousTurns)}
Transcript: ${input.transcript || "(no answer — candidate submitted without speaking)"}
Speech metrics: ${JSON.stringify(input.speechMetrics)}
Face metrics: ${JSON.stringify(input.faceMetrics)}
Candidate apparent facial demeanor during this answer (aggregated over the answer window): ${JSON.stringify(input.candidateMood ?? null)}
Interpret demeanor like a real interviewer: guarded, flat, sad-looking, or visibly tense delivery can reasonably affect perceived enthusiasm and confidence even when the words are decent—without inventing facts beyond this signal.
Interview difficulty: ${input.difficulty}
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
overallScore, clarity, relevance, confidence, engagement, missedOpportunitySummary, bestImprovedAnswer, hiringLikelihood, hiringOutcome, emotionalSummary, strengths, strengthDescriptions, weaknesses, weaknessDescriptions, interviewerNotes, suggestedNextImprovements

Return only a JSON object. Do not wrap it in markdown.

Key requirements:
- strengths: string[] — short labels for what the candidate did well (e.g. "Clear STAR structure").
- strengthDescriptions: string[] — one sentence per strength explaining specifically WHY it helped them in this interview (parallel array, same length as strengths).
- weaknesses: string[] — short labels for what to improve (e.g. "Vague impact claims").
- weaknessDescriptions: string[] — one sentence per weakness explaining the concrete impact it had and why fixing it matters (parallel array, same length as weaknesses).
- Each description should be specific to the candidate's actual answers, not generic filler.

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

export function buildSession(
  role: JobRole,
  difficulty: InterviewSession["difficulty"],
  resumeMode: "Use Sample Resume" | "Skip Resume",
  resume: ResumeProfile | null,
  elevenLabsVoiceId?: string | null
): InterviewSession {
  return {
    id: crypto.randomUUID(),
    role,
    difficulty,
    resumeMode,
    resume,
    elevenLabsVoiceId: elevenLabsVoiceId ?? null,
    startedAt: new Date().toISOString(),
    turns: [],
    currentQuestion: null,
    questionQueue: [],
    interviewComplete: false,
    currentStage: "Applied",
    hiringOutcome: null,
    liveConfidence: 50,
    memory: createInitialMemory(difficulty)
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
