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
  ScheduleSlot,
  ScheduleSlotKind,
  SpeechMetrics
} from "@/lib/interview-types";
import { buildReaskQuestion, pickRandomReaction } from "@/lib/empty-answer-responses";
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

  if (strictness >= 70 || previousWeakAreas.length > 0) {
    return `I'm still concerned about ${(previousWeakAreas[0] ?? "depth").toLowerCase()}. I need stronger evidence before I would feel confident moving this forward.`;
  }

  if (liveConfidence >= 80) {
    return `I'm hearing real strength for this ${role} interview. I trust the direction, and now I want to pressure-test the depth behind it.`;
  }

  if (liveConfidence <= 50) {
    return "I'm concerned the answer is still too broad. I need one concrete example with clearer ownership and impact.";
  }

  return "I'm interested, but I'm still looking for clearer personal ownership and a sharper link between the work and the outcome.";
}

/**
 * Resolve the slot kind for the question being generated. When the caller
 * supplies an explicit `slotKind`, that wins. Otherwise the slot is looked up
 * in the session's schedule. If neither is available (legacy callers), we fall
 * back to the legacy fixed pattern: slots 1 and 3 were follow-ups, others new.
 */
export function resolveSlotKind(
  session: Pick<InterviewSession, "schedule">,
  targetSlotIndex: number,
  override?: ScheduleSlotKind
): ScheduleSlotKind {
  if (override) {
    return override;
  }
  const slot = session.schedule?.[targetSlotIndex];
  if (slot) {
    return slot.kind;
  }
  if (targetSlotIndex === 2) {
    return { kind: "follow-up", followsSlotIndex: 0 };
  }
  if (targetSlotIndex === 3) {
    return { kind: "follow-up", followsSlotIndex: 1 };
  }
  return { kind: "new" };
}

export function buildFallbackQuestion(
  session: InterviewSession,
  options: {
    targetTurnIndex?: number;
    pendingAnswer?: string | null;
    slotKind?: ScheduleSlotKind;
  } = {}
) {
  const { role, turns, memory, difficulty } = session;
  const stage = options.targetTurnIndex ?? turns.length;
  const slotKind = resolveSlotKind(session, stage, options.slotKind);

  // Re-ask slots are built deterministically from the canned preamble + the
  // original question text in [`lib/empty-answer-responses.ts`](lib/empty-answer-responses.ts).
  if (slotKind.kind === "re-ask") {
    const sourceTurn = turns[slotKind.reasksSlotIndex];
    const originalQuestion = sourceTurn?.question ?? "";
    return buildReaskQuestion(originalQuestion);
  }

  const previousAnswer = options.pendingAnswer?.trim() || turns.at(-1)?.transcript || "";
  const previousWeakArea = memory.weakAreas[0];
  const isFollowUpQuestion = slotKind.kind === "follow-up";

  if (isFollowUpQuestion) {
    const followsTurn = turns[slotKind.followsSlotIndex];
    const followedAnswer = followsTurn?.transcript?.trim() ?? "";
    if (!isTranscriptSubstantive(followedAnswer)) {
      return `I still need a real answer to what I asked—you haven't spoken to it yet. Let me ask again directly: give me one concrete ${role} example where you owned the outcome, what constraint you faced, and what measurably changed. I am listening for specifics, not a headline.`;
    }
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

  if (slotKind.kind === "follow-up") {
    const followsTurn = turns[slotKind.followsSlotIndex];
    const followedAnswer = followsTurn?.transcript?.trim() ?? "";
    const basePrompt = `Following up on what you just said about that ${role} work — what tradeoff did you have to manage, and how did you decide? ${direction.followUp}`;

    let tail = "";
    if (memory.strictness >= 70 && previousWeakArea) {
      tail = ` Earlier you left me wanting more around ${previousWeakArea}. Address that directly.`;
    } else if (followedAnswer) {
      tail = ` Earlier you mentioned ${followedAnswer.split(" ").slice(0, 8).join(" ")}... Can you expand on that?`;
    }

    const priorTurnFeedback = followsTurn?.evaluation?.feedback?.trim();
    if (priorTurnFeedback) {
      tail = `${tail} You earlier reflected: ${priorTurnFeedback}`;
    }

    return `${basePrompt}${tail}`;
  }

  // slotKind.kind === "new": pick a stage-appropriate fallback by index.
  const newPrompts: Record<number, string> = {
    0: `Walk me through ${direction.opening} project that best proves you can succeed as a ${role}. I am listening for ${roleSignals}.`,
    1: `Tell me about a different ${role} situation where you had to make a real decision. ${direction.followUp}`,
    2: `If a ${role} project you owned started slipping, how would you communicate risk and recover momentum? ${direction.followUp}`,
    3: `What is a moment in your ${role} work that you would handle differently today, and why? ${direction.followUp}`,
    4: `Final question: why should a hiring team move you to the next round for this ${role} role? ${difficulty === "Hard" ? "Give me evidence that would survive a skeptical debrief." : ""}`
  };

  return newPrompts[stage] ?? newPrompts[4];
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

// EMPTY_ANSWER_REACTIONS now lives in [`lib/empty-answer-responses.ts`](lib/empty-answer-responses.ts)
// so that the client can use the same canned list to render an instant on-screen
// reaction without waiting on OpenAI.

const EMPTY_ANSWER_FEEDBACK = [
  "You submitted without speaking to the question. In a real interview loop that registers as disengagement — even a rough, imperfect answer is far better than silence. Next time, lead with one concrete example before anything else.",
  "Nothing was captured. Interviewers have no material to advocate for a candidate who doesn't respond. Start your answer immediately, even if you need to think aloud first.",
  "A blank answer is the costliest mistake in an interview — it removes any chance of evaluation. Speak up, even briefly: one specific example from your experience is enough to anchor the conversation.",
  "No answer was given. Silence or early submission signals unpreparedness to a hiring team. The fix is simple: commit to speaking the moment the timer starts, and lead with a real example."
];

function pickRandom<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
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
    `No answer was given — speaking to even one concrete ${role} example would have given the evaluation something to work with.`;
  const improvedAnswer = buildImprovedAnswer(role, resume, missingResumeHighlights, transcript || " ");

  return {
    clarity,
    relevance,
    structure,
    confidence,
    engagement,
    liveConfidence,
    feedback: pickRandom(EMPTY_ANSWER_FEEDBACK),
    missedOpportunity,
    missingResumeHighlights,
    missedOpportunityDetails,
    improvedAnswer,
    rewriteHighlights: buildRewriteHighlights(transcript, improvedAnswer),
    interviewerReaction: pickRandomReaction(),
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

async function generateWithOpenAI(prompt: string, label: string = "openai") {
  const client = getClient();
  if (!client) {
    return null;
  }

  const isDev = process.env.NODE_ENV !== "production";
  const startedAt = isDev ? performance.now() : 0;

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt
    });

    if (isDev) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      console.log(`[openai] ${label} ms=${elapsedMs}`);
    }

    const text = response.output_text?.trim();
    return text || null;
  } catch (error) {
    if (isDev) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      console.log(`[openai] ${label} ms=${elapsedMs} status=error`);
    }
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

function buildSequentialQuestionInstructions(
  session: InterviewSession,
  targetSlotIndex: number,
  slotKind: ScheduleSlotKind
) {
  const { role, turns } = session;

  if (slotKind.kind === "new") {
    if (targetSlotIndex === 0) {
      return `SEQUENTIAL QUESTION RULES — Question 1 only:
- Ground the question in the job role, resume/CV context, difficulty, and role expectation signals below.
- Do not reference any prior interview answers, transcripts, or feedback (there are none yet).
- Do not pretend the candidate already spoke.`;
    }

    return `SEQUENTIAL QUESTION RULES — Question ${targetSlotIndex + 1}:
- This question should be a fresh, standalone question (not a direct follow-up).
- Keep it role-specific and resume-aware, but do NOT anchor it to the immediately previous answer as a direct follow-up.
- You MUST still use prior interview context (earlier questions and answers) to avoid repeating what has already been covered.
- Introduce a new angle or competency that has not been adequately tested yet.
- Do not greet/reintroduce yourself or use filler openers.`;
  }

  if (slotKind.kind === "re-ask") {
    // Re-ask slots are built deterministically and never reach this function in
    // generateQuestion, but keep a defensive branch so future direct callers
    // (or test fixtures) get a sensible prompt.
    const sourceTurn = turns[slotKind.reasksSlotIndex];
    const sourceQuestion = sourceTurn?.question ?? "";
    return `SEQUENTIAL QUESTION RULES — Re-ask of question ${slotKind.reasksSlotIndex + 1}:
- The candidate did not provide a substantive answer to question ${slotKind.reasksSlotIndex + 1}.
- Re-ask the same competency with a brief, professional preamble and lightly different wording.
- Original question text: ${JSON.stringify(sourceQuestion)}
- Do not greet, thank, or use pleasantries.`;
  }

  // slotKind.kind === "follow-up"
  const followsTurn = turns[slotKind.followsSlotIndex];
  const followedAnswer = followsTurn?.transcript?.trim() ?? "";
  const followedQuestion = followsTurn?.question?.trim() ?? "";
  const followedAnswerEmpty = !isTranscriptSubstantive(followedAnswer);

  if (followedAnswerEmpty) {
    // Should not normally happen — empty answers route through transformScheduleForEmptyAnswer
    // and become re-ask slots before they reach generateQuestion. This branch is a safety net.
    return `SEQUENTIAL QUESTION RULES — Question ${targetSlotIndex + 1}:
- The candidate's answer to question ${slotKind.followsSlotIndex + 1} was empty or non-substantive.
- Briefly note that they did not address it, then ask a fresh follow-up that probes the same competency.
- Insist on a concrete, spoken answer with specifics relevant to ${JSON.stringify(role)}.
- Do not greet, thank, or use pleasantries.`;
  }

  return `SEQUENTIAL QUESTION RULES — Question ${targetSlotIndex + 1}:
- This question must be a direct follow-up to the candidate's answer to question ${slotKind.followsSlotIndex + 1}.
- Probe deeper, clarify tradeoffs, challenge assumptions, or pressure-test evidence from THAT specific answer (not necessarily the most recent answer).
- Question ${slotKind.followsSlotIndex + 1} that they answered: ${JSON.stringify(followedQuestion)}
- Their answer to question ${slotKind.followsSlotIndex + 1}: ${JSON.stringify(followedAnswer)}
- Keep the job role and resume/CV context in mind: role ${JSON.stringify(role)}.
- Do not greet/reintroduce yourself or use filler openers.`;
}

export async function generateQuestion(input: {
  session: InterviewSession;
  targetTurnIndex?: number;
  pendingAnswer?: string | null;
  slotKind?: ScheduleSlotKind;
}) {
  const targetTurnIndex = input.targetTurnIndex ?? input.session.turns.length;
  const slotKind = resolveSlotKind(input.session, targetTurnIndex, input.slotKind);

  // Re-ask slots are deterministic — never call OpenAI for them. The instant-build
  // path also keeps audio prefetch viable the moment we know the answer was empty.
  if (slotKind.kind === "re-ask") {
    const sourceTurn = input.session.turns[slotKind.reasksSlotIndex];
    return buildReaskQuestion(sourceTurn?.question ?? "");
  }

  const fallback = buildFallbackQuestion(input.session, {
    targetTurnIndex,
    pendingAnswer: input.pendingAnswer,
    slotKind
  });
  const roleExpectations = getRoleExpectations(input.session.role);
  const preparedQuestions = [input.session.currentQuestion, ...(input.session.questionQueue ?? [])].filter(Boolean);
  const sequentialInstructions = buildSequentialQuestionInstructions(input.session, targetTurnIndex, slotKind);
  const totalSlots = input.session.schedule?.length ?? TURN_LIMIT;
  const openAiResponse = await generateWithOpenAI(
    `
You are an interviewer running a realistic ${input.session.role} interview at ${input.session.difficulty} difficulty.
Behave like a real person with memory, light personality, and evolving strictness.
Generate exactly one concise interview question for question ${targetTurnIndex + 1} of ${totalSlots}.

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
        q: turn.question,
        a: turn.transcript,
        mood: turn.candidateMood?.dominant ?? null,
        feedback: turn.evaluation.feedback,
        gaps: turn.evaluation.missingResumeHighlights
      }))
    )}
Most recent completed answer apparent mood (use this like a real interviewer deciding tone and empathy): ${JSON.stringify(input.session.turns.at(-1)?.candidateMood ?? null)}
Resume / CV context: ${JSON.stringify(input.session.resume)}
`,
    "generateQuestion"
  );

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

  const openAiResponse = await generateWithOpenAI(
    `
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
Previous turns: ${JSON.stringify(
      input.previousTurns.map((turn) => ({
        q: turn.question,
        a: turn.transcript,
        eval: {
          clarity: turn.evaluation.clarity,
          relevance: turn.evaluation.relevance,
          structure: turn.evaluation.structure
        }
      }))
    )}
Transcript: ${input.transcript || "(no answer — candidate submitted without speaking)"}
Speech metrics: ${JSON.stringify(input.speechMetrics)}
Face metrics: ${JSON.stringify(input.faceMetrics)}
Candidate apparent facial demeanor during this answer (aggregated over the answer window): ${JSON.stringify(input.candidateMood ?? null)}
Interpret demeanor like a real interviewer: guarded, flat, sad-looking, or visibly tense delivery can reasonably affect perceived enthusiasm and confidence even when the words are decent—without inventing facts beyond this signal.
Interview difficulty: ${input.difficulty}
Role expectations: ${JSON.stringify(getRoleExpectations(input.role))}
`,
    "evaluateAnswer"
  );

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
  const openAiResponse = await generateWithOpenAI(
    `
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
`,
    "finalizeInterview"
  );

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

/** Hard cap on schedule length to prevent runaway re-ask insertions. */
export const MAX_SLOTS = 7;

/**
 * Default 5-slot interview schedule:
 *   slot 0 = brand-new (Q1)
 *   slot 1 = brand-new (Q2)
 *   slot 2 = follow-up to slot 0 (Q1)
 *   slot 3 = follow-up to slot 1 (Q2)
 *   slot 4 = brand-new closing question
 */
export function buildBaseSchedule(): ScheduleSlot[] {
  return [
    { index: 0, kind: { kind: "new" }, question: null },
    { index: 1, kind: { kind: "new" }, question: null },
    { index: 2, kind: { kind: "follow-up", followsSlotIndex: 0 }, question: null },
    { index: 3, kind: { kind: "follow-up", followsSlotIndex: 1 }, question: null },
    { index: 4, kind: { kind: "new" }, question: null }
  ];
}

/**
 * Inserts a re-ask of `emptySlotIndex` at slot `emptySlotIndex + 1` and re-orders
 * the remaining slots according to the project's empty-answer policy:
 *
 *   1. Remove the existing follow-up to `emptySlotIndex` (if any) — call this `displaced`.
 *   2. Insert `{ kind: "re-ask" }` immediately after the empty slot.
 *   3. Push every subsequent slot back by one.
 *   4. Append `displaced` (if it existed) to the end of the schedule.
 *   5. Re-number slot indices to match their new positions.
 *
 * Guarded by:
 *   - The empty slot must not itself be a re-ask (no loops).
 *   - `alreadyReaskedSlotIndices` must not contain `emptySlotIndex`.
 *   - Resulting schedule must not exceed `MAX_SLOTS`.
 *
 * Returns the input schedule unchanged when a guard rejects the transform.
 */
export function transformScheduleForEmptyAnswer(
  schedule: ScheduleSlot[],
  emptySlotIndex: number,
  alreadyReaskedSlotIndices: Set<number> = new Set()
): ScheduleSlot[] {
  if (emptySlotIndex < 0 || emptySlotIndex >= schedule.length) {
    return schedule;
  }
  const emptySlot = schedule[emptySlotIndex];
  if (emptySlot.kind.kind === "re-ask") {
    return schedule;
  }
  if (alreadyReaskedSlotIndices.has(emptySlotIndex)) {
    return schedule;
  }

  const followupIndex = schedule.findIndex(
    (slot) => slot.kind.kind === "follow-up" && slot.kind.followsSlotIndex === emptySlotIndex
  );
  const willAppend = followupIndex !== -1;
  // Net change in length: +1 for the inserted re-ask, -1 if we lift a follow-up out
  // and re-append it (no net change), +1 if there was no follow-up to displace.
  const projectedLength = schedule.length + (willAppend ? 0 : 1) + 1 - (willAppend ? 1 : 0);
  // The "+1 -1" pair is the explicit insert/append accounting; simplify:
  //   if (willAppend): length stays the same +1 for insert -1 for remove +1 for append = +1
  //   if (!willAppend): length +1 for insert
  // So projectedLength = schedule.length + 1 in both cases. We still cap at MAX_SLOTS.
  if (projectedLength > MAX_SLOTS) {
    return schedule;
  }

  const working = schedule.slice();
  let displaced: ScheduleSlot | null = null;
  if (willAppend) {
    displaced = { ...working[followupIndex], question: null };
    working.splice(followupIndex, 1);
  }

  const insertAt = working.findIndex((slot) => slot.index === emptySlotIndex) + 1;
  working.splice(insertAt, 0, {
    index: -1,
    kind: { kind: "re-ask", reasksSlotIndex: emptySlotIndex },
    question: null
  });

  if (displaced) {
    working.push(displaced);
  }

  // Re-number `index` to match the new positions.
  return working.map((slot, position) => ({ ...slot, index: position }));
}

/**
 * Computes which slot indices have already had a re-ask inserted for them.
 * Used to enforce the "1 re-ask per question" cap.
 */
export function getReaskedSlotIndices(schedule: ScheduleSlot[]): Set<number> {
  const set = new Set<number>();
  for (const slot of schedule) {
    if (slot.kind.kind === "re-ask") {
      set.add(slot.kind.reasksSlotIndex);
    }
  }
  return set;
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
    schedule: buildBaseSchedule(),
    interviewComplete: false,
    currentStage: "Applied",
    hiringOutcome: null,
    liveConfidence: 50,
    memory: createInitialMemory(difficulty)
  };
}

/**
 * Interview is complete when every slot in the schedule has a corresponding turn.
 * The schedule itself can grow (via empty-answer transforms) up to MAX_SLOTS.
 */
export function shouldCompleteInterview(
  turns: InterviewTurn[],
  schedule?: ScheduleSlot[]
): boolean {
  if (schedule && schedule.length > 0) {
    return turns.length >= schedule.length;
  }
  return turns.length >= TURN_LIMIT;
}

export function applyTurnToSession(session: InterviewSession, turn: InterviewTurn) {
  const turns = [...session.turns, turn];
  const answerStrength = clampScore(
    (turn.evaluation.liveConfidence + turn.evaluation.relevance + turn.evaluation.structure + turn.evaluation.confidence) / 4
  );
  const currentStage = advanceHiringStage(session.currentStage, answerStrength);
  const memory = updateMemory(session.memory, turn);
  const interviewComplete = shouldCompleteInterview(turns, session.schedule);
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
