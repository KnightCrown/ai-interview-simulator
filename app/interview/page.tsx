"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FeedbackPanel, type CoachingThought } from "@/components/feedback-panel";
import { Avatar2D } from "@/components/avatar-2d";
import { TypingQuestion } from "@/components/typing-question";
import { ThemeToggle } from "@/components/theme-toggle";
import { TechSpecsButton } from "@/components/tech-specs-button";
import {
  AnswerEvaluation,
  CandidateMoodSnapshot,
  FaceEmotionDominant,
  FaceEmotionScores,
  InterviewSession,
  InterviewTurn,
  ScheduleSlot
} from "@/lib/interview-types";
import { liveConfidenceFromSignals } from "@/lib/interview-scoring";
import { transformScheduleForEmptyAnswer, getReaskedSlotIndices } from "@/lib/interview-engine";
import { buildReaskQuestion, pickRandomReaction } from "@/lib/empty-answer-responses";
import { isTranscriptSubstantive } from "@/lib/transcript-utils";
import { useFaceTracking } from "@/hooks/useFaceTracking";
import { useInterviewerSpeech } from "@/hooks/useInterviewerSpeech";
import { useSmoothedLiveMetric } from "@/hooks/useSmoothedLiveMetric";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { createEmptyMoodCounts, getDominantMoodFromCounts } from "@/lib/candidate-mood";
import { loadMediaDevicePreferences, saveMediaDevicePreferences } from "@/lib/media-device-preferences";
import { useInterviewSession } from "@/lib/session-store";

const BASE_TOTAL_QUESTIONS = 5;
const ANSWER_SECONDS = 60;
const QUESTION_HANDOFF_DELAY_MS = 700;
const CANDIDATE_MOOD_SAMPLE_MS = 2000;

type MainVideo = "interviewer" | "candidate";

/**
 * Returns a colour for the confidence ring that smoothly interpolates:
 *   ≤30  → red  (#ef4444)
 *   30→70 → orange (#f97316) fading to green (#22c55e)
 *   ≥70  → green (#22c55e)
 */
function getConfidenceColor(score: number): string {
  if (score <= 30) return "#ef4444";
  if (score >= 70) return "#22c55e";
  const t = (score - 30) / 40;
  const r = Math.round(249 + (34 - 249) * t);
  const g = Math.round(115 + (197 - 115) * t);
  const b = Math.round(22 + (94 - 22) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRepeatedFillerWords(transcript: string, fillerWords: string[]) {
  const normalizedTranscript = transcript.toLowerCase();

  return fillerWords
    .map((word) => {
      const matches = normalizedTranscript.match(new RegExp(`\\b${escapeRegExp(word.toLowerCase())}\\b`, "g"));

      return {
        word,
        count: matches?.length ?? 0
      };
    })
    .filter((item) => item.count > 5);
}

function getSpeakingPaceLabel(wordsPerMinute: number) {
  if (wordsPerMinute > 155) {
    return "Speak slower, please";
  }

  if (wordsPerMinute < 105) {
    return "Too slow";
  }

  return "Ideal";
}

function createEmptyEmotionAccum() {
  return {
    happy: 0,
    sad: 0,
    nervous: 0,
    neutral: 0,
    frames: 0,
    counts: createEmptyMoodCounts()
  };
}

export default function InterviewPage() {
  const router = useRouter();
  const { session, setSession } = useInterviewSession();
  const speech = useSpeechRecognition();
  const [preferredVideoDeviceId, setPreferredVideoDeviceId] = useState<string | null>(
    () => loadMediaDevicePreferences()?.videoInputId ?? null
  );
  const face = useFaceTracking(preferredVideoDeviceId);
  const interviewerSpeech = useInterviewerSpeech(session?.elevenLabsVoiceId, session?.difficulty);
  const {
    elapsedSeconds,
    interimTranscript,
    isListening: speechIsListening,
    isSupported: speechIsSupported,
    metrics: speechMetrics,
    resetTranscript,
    setCaptureEnabled,
    startListening,
    stopListening,
    transcript
  } = speech;
  const { speak, stop, prefetchAudio, mouthLevel, emotion, isSpeaking } = interviewerSpeech;
  const [displayedAvatarEmotion, setDisplayedAvatarEmotion] = useState(emotion);
  const [latestEvaluation, setLatestEvaluation] = useState<AnswerEvaluation | null>(null);
  const [coachingThoughts, setCoachingThoughts] = useState<CoachingThought[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCoaching, setShowCoaching] = useState(false);
  // Live-insights overlay defaults on; candidates can hide it with the toggle.
  const [showOverlay, setShowOverlay] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [mainVideo, setMainVideo] = useState<MainVideo>("interviewer");
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const [micMenuOpen, setMicMenuOpen] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>(
    () => loadMediaDevicePreferences()?.audioInputId ?? ""
  );
  const [pendingAnswerCount, setPendingAnswerCount] = useState(0);
  const [answerSecondsRemaining, setAnswerSecondsRemaining] = useState(ANSWER_SECONDS);
  // The mobile gate modal blocks the interview from starting (no TTS, no
  // recording) until the user dismisses it. mobileGateRef is the synchronous
  // companion to the state; the speak effect reads the ref so it sees the
  // gate even on the same render the gate is set during mount.
  const [mobileGateOpen, setMobileGateOpen] = useState(false);
  const mobileGateRef = useRef(false);
  const sessionRef = useRef<InterviewSession | null>(null);
  const confirmedSessionRef = useRef<InterviewSession | null>(null);
  const lastSpokenQuestionRef = useRef<string | null>(null);
  const shouldDelayNextQuestionRef = useRef(false);
  const autoSubmittedRef = useRef(false);
  const submitAnswerRef = useRef<(() => void) | null>(null);
  const answerSubmissionChainRef = useRef<Promise<InterviewSession | null>>(Promise.resolve(null));
  const answerEmotionAccumRef = useRef(createEmptyEmotionAccum());
  const latestCandidateEmotionRef = useRef(face.metrics.emotion);
  const latestAvatarEmotionRef = useRef(emotion);
  // Slot indices currently being generated by /api/interview/question/prefetch.
  // Prevents duplicate concurrent prefetches for the same slot.
  const inflightQuestionPrefetchRef = useRef<Set<number>>(new Set());
  // Question texts we have already kicked off a TTS prefetch for (audio cache key).
  const audioPrefetchKickedRef = useRef<Set<string>>(new Set());
  // Mirrors pendingAnswerCount so async resolution paths can read the latest value
  // instead of a value captured in their effect closure.
  const pendingAnswerCountRef = useRef(0);
  const [displayedCandidateMood, setDisplayedCandidateMood] = useState<FaceEmotionDominant>(face.metrics.emotion.dominant);

  useEffect(() => {
    if (!session) {
      router.replace("/");
    }
  }, [router, session]);

  useEffect(() => {
    sessionRef.current = session;
    if (session && pendingAnswerCount === 0) {
      confirmedSessionRef.current = session;
    }
  }, [pendingAnswerCount, session]);

  useEffect(() => {
    pendingAnswerCountRef.current = pendingAnswerCount;
  }, [pendingAnswerCount]);

  useEffect(() => {
    if (mainVideo !== "candidate") {
      setCameraMenuOpen(false);
      setMicMenuOpen(false);
    }
  }, [mainVideo]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;

    setShowOverlay(true);
    // Setting the ref synchronously alongside the state ensures the speak
    // effect — which runs in the same effect pass on first mount — sees the
    // gate and aborts before triggering TTS or speech capture.
    mobileGateRef.current = true;
    setMobileGateOpen(true);
  }, []);

  const dismissMobileGate = useCallback(() => {
    mobileGateRef.current = false;
    setMobileGateOpen(false);
  }, []);

  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => setAudioDevices(devices.filter((d) => d.kind === "audioinput")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    latestAvatarEmotionRef.current = emotion;
  }, [emotion]);

  useEffect(() => {
    latestCandidateEmotionRef.current = face.metrics.emotion;
  }, [face.metrics.emotion]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDisplayedAvatarEmotion(latestAvatarEmotionRef.current);
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!showTranscript) {
      return;
    }

    answerEmotionAccumRef.current = createEmptyEmotionAccum();

    const sampleMood = () => {
      const emotionSnapshot: FaceEmotionScores = latestCandidateEmotionRef.current;
      answerEmotionAccumRef.current.happy += emotionSnapshot.happy;
      answerEmotionAccumRef.current.sad += emotionSnapshot.sad;
      answerEmotionAccumRef.current.nervous += emotionSnapshot.nervous;
      answerEmotionAccumRef.current.neutral += emotionSnapshot.neutral;
      answerEmotionAccumRef.current.frames += 1;
      answerEmotionAccumRef.current.counts[emotionSnapshot.dominant] += 1;
      setDisplayedCandidateMood(emotionSnapshot.dominant);
    };

    sampleMood();
    const timer = window.setInterval(sampleMood, CANDIDATE_MOOD_SAMPLE_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [showTranscript]);

  const currentTranscript = `${transcript} ${interimTranscript}`.trim();
  const visibleTranscript = showTranscript ? currentTranscript : "";
  const transcriptPlaceholder = showTranscript ? "Your text will appear here." : "Answer timer starts when the interviewer finishes speaking.";
  const repeatedFillerWords = getRepeatedFillerWords(currentTranscript, speechMetrics.fillerWords);
  const speakingPaceLabel = getSpeakingPaceLabel(speechMetrics.speakingPace);
  const totalQuestions = session?.schedule?.length || BASE_TOTAL_QUESTIONS;
  const currentQuestionNumber = session
    ? Math.min(session.turns.length + pendingAnswerCount + 1, totalQuestions)
    : 1;
  const answerDurationSeconds = Math.max(1, ANSWER_SECONDS - answerSecondsRemaining);

  const liveConfidenceRaw = useMemo(() => {
    if (!session) {
      return 50;
    }

    return liveConfidenceFromSignals({
      role: session.role,
      transcript: visibleTranscript,
      speechMetrics,
      faceMetrics: face.metrics
    });
  }, [face.metrics, session, speechMetrics, visibleTranscript]);

  const displayedConfidence = useSmoothedLiveMetric(liveConfidenceRaw, { sampleMs: 2000, animateMs: 1100 });
  const displayedEyeContact = useSmoothedLiveMetric(face.metrics.eyeContact, { sampleMs: 1000, animateMs: 650 });

  useEffect(() => {
    if (!session || !speechIsSupported) {
      return;
    }

    if (showTranscript) {
      if (!speechIsListening) {
        startListening({ reset: true });
      }
      return;
    }

    if (speechIsListening) {
      stopListening();
    }
  }, [session, showTranscript, speechIsListening, speechIsSupported, startListening, stopListening]);

  /**
   * Fire-and-forget background submission of a single answer to /api/interview/answer.
   *
   * The route now ONLY runs the OpenAI evaluation and appends the turn to the session;
   * it no longer generates the next question. The client owns scheduling and audio
   * playback, so the response only contributes:
   *   - the new turn record (memory, scoring, hiringOutcome) -> merged into local session
   *   - the AnswerEvaluation -> drives the coaching panel + reaction overlay
   *
   * The local schedule, currentQuestion, and questionQueue are PRESERVED across the
   * merge: they have already been advanced by submitAnswer() before this runs.
   *
   * Optionally accepts a `preReaction` to display instantly while the OpenAI eval is
   * still in flight (used for empty answers — we don't want the user to see a blank
   * coaching panel for ~9 seconds).
   */
  const queueAnswerSubmission = useCallback(
    (input: {
      submissionSession: InterviewSession;
      transcriptForEvaluation: string;
      durationSeconds: number;
      speechMetrics: InterviewTurn["speechMetrics"];
      faceMetrics: InterviewTurn["faceMetrics"];
      candidateMood: CandidateMoodSnapshot;
      questionBeingAnswered: string | null;
      preReaction?: { id: string; thought: string } | null;
    }) => {
      const previousSubmissionPromise = answerSubmissionChainRef.current;

      if (input.preReaction) {
        const reaction = input.preReaction;
        setCoachingThoughts((current) => [reaction, ...current.filter((item) => item.id !== reaction.id)]);
        setShowCoaching(true);
      }

      const runSubmission = async (previousConfirmedSession: InterviewSession | null) => {
        const baseSession = previousConfirmedSession ?? confirmedSessionRef.current ?? input.submissionSession;
        const sessionForSubmission = {
          ...baseSession,
          currentQuestion: input.questionBeingAnswered,
          // Server doesn't depend on questionQueue any more, but send the latest
          // for backwards compatibility with any consumer reading the request body.
          questionQueue: baseSession.questionQueue ?? []
        };

        const response = await fetch("/api/interview/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session: sessionForSubmission,
            transcript: input.transcriptForEvaluation,
            durationSeconds: input.durationSeconds,
            speechMetrics: input.speechMetrics,
            faceMetrics: input.faceMetrics,
            candidateMood: input.candidateMood
          })
        });

        if (!response.ok) {
          throw new Error("The answer could not be evaluated. Please try again.");
        }

        const data = (await response.json()) as { session: InterviewSession; evaluation: AnswerEvaluation };
        confirmedSessionRef.current = data.session;

        // Preserve client-owned scheduling state across the merge — only fold in the
        // server's new turn record, memory, scoring, and hiringOutcome.
        const currentSession = sessionRef.current ?? data.session;
        const mergedSession: InterviewSession = {
          ...data.session,
          schedule: currentSession.schedule?.length ? currentSession.schedule : data.session.schedule,
          currentQuestion: currentSession.currentQuestion ?? data.session.currentQuestion,
          questionQueue: currentSession.questionQueue ?? data.session.questionQueue
        };

        sessionRef.current = mergedSession;
        setSession(mergedSession);
        setLatestEvaluation(data.evaluation);
        setCoachingThoughts((current) => {
          const id = data.session.turns.at(-1)?.id ?? crypto.randomUUID();
          const next = { id, thought: data.evaluation.interviewerReaction };
          // If a preReaction with the same id exists (empty-answer canned reaction), keep it
          // — the OpenAI reaction is for the final report, not the live UI.
          if (input.preReaction && current.some((item) => item.id === input.preReaction!.id)) {
            return current;
          }
          return [next, ...current.filter((item) => item.id !== id)];
        });
        setShowCoaching(true);
        setPendingAnswerCount((current) => Math.max(0, current - 1));

        return data.session;
      };

      const submissionPromise = previousSubmissionPromise
        .catch(() => confirmedSessionRef.current)
        .then(runSubmission)
        .catch((error) => {
          setPendingAnswerCount((current) => Math.max(0, current - 1));
          setSubmitError(error instanceof Error ? error.message : "The answer could not be evaluated. Please try again.");
          return confirmedSessionRef.current;
        });

      answerSubmissionChainRef.current = submissionPromise;
      return submissionPromise;
    },
    [setSession]
  );

  const submitAnswer = useCallback(async () => {
    if (!session || isSubmitting) {
      return;
    }

    const transcriptForEvaluation = visibleTranscript.trim();
    const answerIsSubstantive = isTranscriptSubstantive(transcriptForEvaluation);

    const accum = answerEmotionAccumRef.current;
    const frameCount = Math.max(1, accum.frames);
    const averages = {
      happy: accum.happy / frameCount,
      sad: accum.sad / frameCount,
      nervous: accum.nervous / frameCount,
      neutral: accum.neutral / frameCount
    };
    const moodDominant = getDominantMoodFromCounts(accum.counts, latestCandidateEmotionRef.current.dominant);
    const candidateMood: CandidateMoodSnapshot = {
      dominant: moodDominant,
      counts: { ...accum.counts },
      averages,
      framesSampled: accum.frames
    };

    setIsSubmitting(true);
    setSubmitError(null);
    setCaptureEnabled(false);
    setShowTranscript(false);
    stop();
    resetTranscript();
    setAnswerSecondsRemaining(ANSWER_SECONDS);
    autoSubmittedRef.current = false;

    // The slot the candidate just answered is the one with index = turns.length
    // (turns are appended only by the server after evaluateAnswer). The schedule
    // mirror on the client is the source of truth for navigation.
    const answeredSlotIndex = session.turns.length + pendingAnswerCount;
    const answeredSlot = session.schedule?.[answeredSlotIndex];
    const answeredQuestion = session.currentQuestion;

    // Run the empty-answer schedule transform if appropriate. We do this BEFORE
    // promoting the next slot so the inserted re-ask question text exists in
    // the schedule that drives the next-question speak effect.
    let workingSchedule: ScheduleSlot[] = session.schedule ?? [];
    let preReaction: { id: string; thought: string } | null = null;
    if (!answerIsSubstantive) {
      const reactionId = crypto.randomUUID();
      preReaction = { id: reactionId, thought: pickRandomReaction() };

      const reaskedSet = getReaskedSlotIndices(workingSchedule);
      const isAlreadyReask = answeredSlot?.kind.kind === "re-ask";
      if (!isAlreadyReask && answeredSlot && answeredQuestion) {
        const transformed = transformScheduleForEmptyAnswer(workingSchedule, answeredSlotIndex, reaskedSet);
        if (transformed !== workingSchedule) {
          // The newly inserted re-ask sits at answeredSlotIndex + 1.
          const reaskQuestion = buildReaskQuestion(answeredQuestion);
          workingSchedule = transformed.map((slot) =>
            slot.kind.kind === "re-ask" && slot.kind.reasksSlotIndex === answeredSlotIndex && slot.question === null
              ? { ...slot, question: reaskQuestion }
              : slot
          );
          // Audio for the re-ask can be prefetched immediately — the question
          // text was built deterministically and isn't waiting on OpenAI.
          void prefetchAudio(reaskQuestion);
        }
      }
    }

    // Promote the next slot's question into currentQuestion. If the prefetch
    // hasn't completed yet, currentQuestion becomes null and the next-question
    // speak effect will pick it up the moment the schedule is updated.
    const nextSlotIndex = answeredSlotIndex + 1;
    const nextSlot = workingSchedule[nextSlotIndex];
    const nextQuestion = nextSlot?.question ?? null;
    const isFinalQuestion = nextSlotIndex >= workingSchedule.length;

    setPendingAnswerCount((current) => current + 1);
    shouldDelayNextQuestionRef.current = !isFinalQuestion;

    const optimisticSession: InterviewSession = {
      ...session,
      schedule: workingSchedule,
      currentQuestion: isFinalQuestion ? session.currentQuestion : nextQuestion,
      questionQueue: []
    };
    sessionRef.current = optimisticSession;
    setSession(optimisticSession);

    void queueAnswerSubmission({
      submissionSession: session,
      transcriptForEvaluation,
      durationSeconds: answerDurationSeconds,
      speechMetrics,
      faceMetrics: face.metrics,
      candidateMood,
      questionBeingAnswered: answeredQuestion,
      preReaction
    }).finally(() => {
      setIsSubmitting(false);
    });

    if (isFinalQuestion) {
      router.push("/results");
    }
  }, [
    answerDurationSeconds,
    face.metrics,
    isSubmitting,
    pendingAnswerCount,
    prefetchAudio,
    queueAnswerSubmission,
    resetTranscript,
    router,
    session,
    setCaptureEnabled,
    setSession,
    speechMetrics,
    stop,
    visibleTranscript
  ]);

  useEffect(() => {
    submitAnswerRef.current = () => {
      void submitAnswer();
    };
  }, [submitAnswer]);

  // Background question + audio prefetch loop.
  //
  // For each slot whose `question` is still null, we kick off a server prefetch
  // request iff its dependencies are satisfied (a follow-up needs the source
  // turn's transcript to exist). Once a question text is set, fire an audio
  // prefetch so /api/interview/tts has the bytes ready before we ever speak it.
  useEffect(() => {
    if (!session?.schedule || session.schedule.length === 0) {
      return;
    }

    const schedule = session.schedule;

    // Audio prefetch — for every slot that already has question text, ensure we
    // have kicked off a TTS prefetch for it.
    for (const slot of schedule) {
      const text = slot.question?.trim();
      if (!text) continue;
      if (audioPrefetchKickedRef.current.has(text)) continue;
      audioPrefetchKickedRef.current.add(text);
      void prefetchAudio(text);
    }

    // Question prefetch — pick the first slot lacking a question whose
    // dependencies are met, and not already in flight.
    const target = schedule.find((slot) => {
      if (slot.question) return false;
      if (inflightQuestionPrefetchRef.current.has(slot.index)) return false;
      if (slot.kind.kind === "follow-up") {
        return !!session.turns[slot.kind.followsSlotIndex];
      }
      // Re-ask slots are filled deterministically by the empty-answer flow,
      // so we skip them here. Brand-new slots have no dependencies.
      return slot.kind.kind === "new";
    });

    if (!target) return;

    inflightQuestionPrefetchRef.current.add(target.index);
    void (async () => {
      try {
        const res = await fetch("/api/interview/question/prefetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session, targetSlotIndex: target.index })
        });
        if (!res.ok) return;
        const data = (await res.json()) as { question: string; targetSlotIndex: number };
        const question = data.question?.trim();
        if (!question) return;

        const currentSession = sessionRef.current;
        if (!currentSession?.schedule) return;
        const updatedSchedule = currentSession.schedule.map((slot) =>
          slot.index === target.index && !slot.question ? { ...slot, question } : slot
        );

        const isCurrent =
          currentSession.currentQuestion === null &&
          currentSession.turns.length + pendingAnswerCountRef.current === target.index;

        const nextSession: InterviewSession = {
          ...currentSession,
          schedule: updatedSchedule,
          currentQuestion: isCurrent ? question : currentSession.currentQuestion
        };
        sessionRef.current = nextSession;
        setSession(nextSession);
      } finally {
        inflightQuestionPrefetchRef.current.delete(target.index);
      }
    })();
  }, [pendingAnswerCount, prefetchAudio, session, setSession]);

  useEffect(() => {
    if (!session?.currentQuestion || session.currentQuestion === lastSpokenQuestionRef.current) {
      return;
    }
    // The mobile gate modal pauses everything until dismissed. Bail out before
    // we touch lastSpokenQuestionRef so the effect re-runs and speaks the
    // question once mobileGateOpen flips to false.
    if (mobileGateRef.current) {
      return;
    }

    const question = session.currentQuestion;
    lastSpokenQuestionRef.current = question;
    autoSubmittedRef.current = false;
    stopListening();
    setCaptureEnabled(false);
    setShowTranscript(false);
    setAnswerSecondsRemaining(ANSWER_SECONDS);
    resetTranscript();

    void (async () => {
      if (shouldDelayNextQuestionRef.current) {
        shouldDelayNextQuestionRef.current = false;
        await new Promise((resolve) => window.setTimeout(resolve, QUESTION_HANDOFF_DELAY_MS));

        if (lastSpokenQuestionRef.current !== question) {
          return;
        }
      }

      try {
        await speak(question);
      } catch {
        stop();
      }

      if (lastSpokenQuestionRef.current !== question) {
        return;
      }

      resetTranscript();
      setAnswerSecondsRemaining(ANSWER_SECONDS);
      setCaptureEnabled(true);
      setShowTranscript(true);
    })();
  }, [mobileGateOpen, resetTranscript, session?.currentQuestion, setCaptureEnabled, speak, stop, stopListening]);

  useEffect(() => {
    if (!showTranscript || session?.interviewComplete) {
      return;
    }

    if (answerSecondsRemaining <= 0) {
      if (!autoSubmittedRef.current) {
        autoSubmittedRef.current = true;
        submitAnswerRef.current?.();
      }
      return;
    }

    const timer = window.setTimeout(() => {
      setAnswerSecondsRemaining((current) => Math.max(0, current - 1));
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [answerSecondsRemaining, session?.interviewComplete, showTranscript]);

  const dismissCoachingThought = useCallback((id: string) => {
    setCoachingThoughts((current) => current.filter((item) => item.id !== id));
  }, []);

  if (!session) {
    return null;
  }

  const endInterview = () => {
    setCaptureEnabled(false);
    stopListening();
    stop();
    setSession({
      ...session,
      interviewComplete: true
    });
    router.push("/results");
  };

  return (
    <main className="min-h-screen bg-[#f7f9fc] text-ink dark:bg-slate-950 dark:text-slate-100">

      {mobileGateOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/45 px-4 backdrop-blur-sm dark:bg-black/65"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-gate-title"
        >
          <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-panel dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={dismissMobileGate}
              aria-label="Dismiss notice and start interview"
              className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-ink dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              x
            </button>

            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-700 dark:text-teal-300">
              Heads up
            </p>
            <h3 id="mobile-gate-title" className="mt-2 text-xl font-semibold text-ink dark:text-white">
              This experience is designed for desktop
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-300">
              You can still take an interview on your phone, but live transcription, the camera-based engagement tracking, and the AI voice can behave inconsistently on mobile browsers. For the smoothest run, open this on a laptop or desktop in Chrome, Edge, or Safari.
            </p>
            {!speechIsSupported ? (
              <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
                Live transcription isn&rsquo;t available in this browser — use Chrome or Safari for the captioned experience.
              </p>
            ) : null}
            <button
              type="button"
              onClick={dismissMobileGate}
              className="mt-5 w-full rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-teal-500 dark:hover:bg-teal-400"
            >
              Continue to interview
            </button>
          </div>
        </div>
      ) : null}

      <header className="border-b border-slate-200/80 bg-white/90 px-5 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-[118rem] flex-col gap-4 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <div className="flex items-center gap-4">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-sm font-bold text-white dark:bg-white dark:text-ink">AI</div>
            <h1 className="text-base font-semibold sm:text-lg dark:text-white">{session.role} Simulation</h1>
          </div>

          <div className="justify-self-center text-center">
            <p className="text-sm font-medium dark:text-slate-200">Question {currentQuestionNumber} of {totalQuestions}</p>
            <div className="mt-3 flex items-center justify-center gap-2 sm:gap-3">
              {Array.from({ length: totalQuestions }).map((_, index) => {
                const step = index + 1;
                const isActive = step <= currentQuestionNumber;

                return (
                  <div key={step} className="flex items-center gap-2 sm:gap-3">
                    <span className={`h-3 w-3 rounded-full ${isActive ? "bg-teal-600 dark:bg-teal-400" : "bg-slate-200 dark:bg-slate-700"}`} />
                    {step < totalQuestions ? (
                      <span className={`h-1 w-7 rounded-full sm:w-14 ${step < currentQuestionNumber ? "bg-teal-600 dark:bg-teal-400" : "bg-slate-200 dark:bg-slate-700"}`} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 lg:justify-end">
            <TechSpecsButton variant="header" />
            <button
              type="button"
              onClick={endInterview}
              className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-red-600 shadow-sm transition hover:border-red-200 hover:bg-red-50 dark:border-slate-700 dark:bg-slate-800 dark:text-rose-300 dark:hover:border-rose-500/40 dark:hover:bg-rose-900/30"
            >
              End interview
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[124rem] gap-6 px-5 py-8 lg:grid-cols-[16rem_minmax(0,68rem)_24rem] lg:grid-rows-[auto_auto]">
        <aside className="order-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-panel dark:border-slate-700 dark:bg-slate-900 lg:order-none lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-8 lg:h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Live insights</p>

          <div className="mt-5">
            <p className="text-sm font-semibold dark:text-white">Confidence</p>
            <div className="mt-3 flex items-center gap-5">
              <div
                className="grid h-24 w-24 shrink-0 place-items-center rounded-full transition-[background] duration-300 ease-out"
                style={{ background: `conic-gradient(${getConfidenceColor(displayedConfidence)} ${displayedConfidence * 3.6}deg, var(--ring-track, #eef2f7) 0deg)` }}
              >
                <div className="h-16 w-16 rounded-full bg-white dark:bg-slate-900" />
              </div>
              <div>
                <p className="text-4xl font-semibold dark:text-white">{displayedConfidence}<span className="text-base font-medium text-slate-400 dark:text-slate-500"> /100</span></p>
                <p className="mt-2 text-sm font-semibold" style={{ color: getConfidenceColor(displayedConfidence) }}>
                  {displayedConfidence >= 70 ? "Strong" : displayedConfidence >= 30 ? "Good" : "Warming up"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowOverlay((current) => !current)}
              aria-pressed={showOverlay}
              className={`mt-5 w-full rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                showOverlay
                  ? "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-500/40 dark:bg-teal-900/30 dark:text-teal-200"
                  : "border-slate-200 bg-white text-slate-600 hover:border-teal-200 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-teal-400/40 dark:hover:text-teal-200"
              }`}
            >
              {showOverlay ? "Overlay on" : "Overlay"}
            </button>

            <p className="mt-5 text-sm text-slate-500 dark:text-slate-400">Eye Contact: {displayedEyeContact}</p>

            <div className="mt-4 space-y-2" aria-live="polite" aria-label="Facial expression breakdown">
              {(
                [
                  { key: "happy",   color: "#14a38b" },
                  { key: "neutral", color: "#94a3b8" },
                  { key: "nervous", color: "#f59e0b" },
                  { key: "sad",     color: "#f43f5e" }
                ] as { key: FaceEmotionDominant; color: string }[]
              ).map(({ key, color }) => {
                const score = Math.round(face.metrics.emotion[key]);
                const isActive = displayedCandidateMood === key;
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className={`w-14 shrink-0 text-xs capitalize ${isActive ? "font-semibold text-ink dark:text-white" : "text-slate-400 dark:text-slate-500"}`}>
                      {key}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-1.5 rounded-full transition-[width] duration-500 ease-out"
                        style={{ width: `${score}%`, backgroundColor: isActive ? color : "#cbd5e1" }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-right text-xs text-slate-400 dark:text-slate-500">{score}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-5 space-y-4 border-t border-slate-200 pt-5 dark:border-slate-800">
            <div>
              <p className="text-sm font-semibold dark:text-white">Words per Min</p>
              <p className="mt-1.5 text-3xl font-semibold dark:text-white">{speechMetrics.speakingPace}</p>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{speakingPaceLabel}</p>
            </div>

            <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
              <p className="text-sm font-semibold dark:text-white">Speaking time</p>
              <p className="mt-1.5 text-3xl font-semibold dark:text-white">{formatTime(elapsedSeconds)}</p>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">min</p>
            </div>

            <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
              <p className="text-sm font-semibold dark:text-white">Filler Words</p>
              <p className="mt-1.5 text-3xl font-semibold dark:text-white">{speechMetrics.fillerCount}</p>
              {repeatedFillerWords.length > 0 ? (
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {repeatedFillerWords.map((item) => `${item.word} (${item.count})`).join(", ")}
                </p>
              ) : null}
            </div>
          </div>
        </aside>

        <section className="contents">
          <div className="relative order-1 mx-auto aspect-video max-h-[46vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-slate-950 shadow-panel lg:col-start-2 lg:row-start-1">
            {mainVideo === "interviewer" ? (
              <Avatar2D
                className="h-full w-full rounded-2xl border-0 shadow-none"
                mouthLevel={mouthLevel}
                emotion={displayedAvatarEmotion}
                isSpeaking={isSpeaking}
                voiceId={session?.elevenLabsVoiceId}
                title="AI interviewer"
                showLabels={false}
              />
            ) : null}

            <div
              onClick={() => setMainVideo(mainVideo === "candidate" ? "interviewer" : "candidate")}
              className={
                mainVideo === "candidate"
                  ? "relative h-full w-full cursor-pointer overflow-hidden"
                  : "absolute bottom-4 right-4 z-10 aspect-video w-[28%] min-w-40 cursor-pointer overflow-hidden rounded-xl border border-white/20 shadow-2xl"
              }
            >
              <video
                ref={face.videoRef}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-cover"
              />
              <canvas
                ref={face.canvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
                aria-hidden="true"
              />
            </div>

            {mainVideo === "candidate" ? (
              <div className="absolute bottom-4 right-4 aspect-video w-[28%] min-w-40">
                <Avatar2D
                  compact
                  className="h-full w-full rounded-xl border border-white/20 shadow-2xl"
                  mouthLevel={mouthLevel}
                  emotion={displayedAvatarEmotion}
                  isSpeaking={isSpeaking}
                  voiceId={session?.elevenLabsVoiceId}
                  onClick={() => setMainVideo("interviewer")}
                  title="AI interviewer"
                  showLabels={false}
                />
              </div>
            ) : null}

            {mainVideo === "candidate" ? (
              <div
                className="absolute right-4 top-4 z-20 flex items-start gap-2"
                onClick={(event) => event.stopPropagation()}
              >
                {/* ── Mic selector ── */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => { setMicMenuOpen((current) => !current); setCameraMenuOpen(false); }}
                    className="grid h-12 w-12 place-items-center rounded-xl bg-black/55 text-white backdrop-blur transition hover:bg-black/70"
                    aria-expanded={micMenuOpen}
                    aria-label="Choose microphone"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                      <line x1="8" y1="22" x2="16" y2="22" />
                    </svg>
                  </button>

                  {micMenuOpen ? (
                    <div className="absolute right-0 mt-2 w-60 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/15 bg-black/75 p-1 text-sm text-white shadow-2xl backdrop-blur">
                      {audioDevices.length > 0 ? (
                        audioDevices.map((device, index) => (
                          <button
                            key={device.deviceId || index}
                            type="button"
                            onClick={() => {
                              setSelectedAudioDeviceId(device.deviceId);
                              saveMediaDevicePreferences({
                                audioInputId: device.deviceId,
                                videoInputId: loadMediaDevicePreferences()?.videoInputId ?? "",
                                mediaPermissionGranted: true
                              });
                              setMicMenuOpen(false);
                            }}
                            className={`block w-full rounded-lg px-3 py-2 text-left transition hover:bg-white/15 ${
                              device.deviceId === selectedAudioDeviceId ? "bg-white/20 font-semibold" : ""
                            }`}
                          >
                            {device.label || `Microphone ${index + 1}`}
                          </button>
                        ))
                      ) : (
                        <p className="px-3 py-2 text-slate-300">No microphones found</p>
                      )}
                    </div>
                  ) : null}
                </div>

                {/* ── Camera selector ── */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => { setCameraMenuOpen((current) => !current); setMicMenuOpen(false); }}
                    className="grid h-12 w-12 place-items-center rounded-xl bg-black/55 text-white backdrop-blur transition hover:bg-black/70"
                    aria-expanded={cameraMenuOpen}
                    aria-label="Choose camera device"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 7h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
                      <path d="m17 10 5-3v10l-5-3" />
                      <path d="M7 12h6" />
                      <path d="M10 9v6" />
                    </svg>
                  </button>

                  {cameraMenuOpen ? (
                    <div className="absolute right-0 mt-2 w-60 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/15 bg-black/75 p-1 text-sm text-white shadow-2xl backdrop-blur">
                      {face.videoDevices.length > 0 ? (
                        face.videoDevices.map((device, index) => (
                          <button
                            key={device.deviceId || index}
                            type="button"
                            onClick={() => {
                              void face.selectCamera(index);
                              saveMediaDevicePreferences({
                                audioInputId: loadMediaDevicePreferences()?.audioInputId ?? "",
                                videoInputId: device.deviceId,
                                mediaPermissionGranted: true
                              });
                              setPreferredVideoDeviceId(device.deviceId);
                              setCameraMenuOpen(false);
                            }}
                            className={`block w-full rounded-lg px-3 py-2 text-left transition hover:bg-white/15 ${
                              index === face.selectedDeviceIndex ? "bg-white/20 font-semibold" : ""
                            }`}
                          >
                            {device.label || `Camera ${index + 1}`}
                          </button>
                        ))
                      ) : (
                        <p className="px-3 py-2 text-slate-300">No camera devices found</p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {showOverlay ? (
              <div className={`pointer-events-none absolute top-4 z-10 flex flex-col gap-2 ${
                mainVideo === "candidate" ? "left-4 items-start" : "right-4 items-end"
              }`}>
                <div className="rounded-xl bg-black/60 px-3 py-2 backdrop-blur">
                  <span
                    className="text-3xl font-bold tabular-nums leading-none"
                    style={{ color: getConfidenceColor(displayedConfidence) }}
                  >
                    {displayedConfidence}
                  </span>
                </div>
                <div className="rounded-xl bg-black/60 px-3 py-1.5 backdrop-blur">
                  <span className="text-base font-semibold tabular-nums text-white leading-none">
                    {speechMetrics.speakingPace}
                    <span className="ml-1 text-xs font-medium text-white/60">WPM</span>
                  </span>
                </div>
                <div className="rounded-xl bg-black/60 px-3 py-1.5 backdrop-blur">
                  <span className="text-sm font-semibold capitalize text-white/90 leading-none">
                    {displayedCandidateMood}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="absolute bottom-5 left-5 rounded-xl bg-black/55 px-4 py-2 text-sm font-semibold text-white backdrop-blur">
              <span className="mr-2 inline-block h-3 w-3 rounded-full bg-teal-400 align-middle" />
              {mainVideo === "interviewer" ? "Interviewing" : "Candidate camera"}
            </div>
          </div>

          <div className="order-2 mx-auto w-full max-w-4xl rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-panel sm:px-8 sm:py-6 lg:col-start-2 lg:row-start-2 dark:border-slate-700 dark:bg-slate-900">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Interviewer question</p>
              <div className="mt-3 flex items-start justify-between gap-5">
                <p className="text-justify text-[1.1rem] font-medium leading-[1.45rem] text-ink dark:text-white">
                  <TypingQuestion text={session.currentQuestion ?? "Preparing next question..."} />
                </p>
                {showTranscript ? (
                  <p className="shrink-0 whitespace-nowrap text-[1.1rem] font-medium leading-[1.45rem] text-ink dark:text-white">
                    {formatTime(answerSecondsRemaining)}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
              <p className="min-h-20 whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-300">
                {visibleTranscript || transcriptPlaceholder}
              </p>
            </div>

            <div className="mt-4 flex flex-col items-end">
              {submitError ? <p className="mb-3 text-sm font-medium text-red-600 dark:text-rose-300">{submitError}</p> : null}
              <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => void submitAnswer()}
                  disabled={!showTranscript || isSubmitting}
                  className="min-h-11 w-full rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-500 sm:w-44"
                >
                  {isSubmitting ? "Evaluating..." : "Submit early"}
                </button>
              </div>
              {!speechIsSupported ? <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Speech recognition is not supported in this browser.</p> : null}
            </div>
          </div>
        </section>

        <aside className="order-4 space-y-4 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:self-start lg:sticky lg:top-8">
          <button
            type="button"
            onClick={() => setShowCoaching((current) => !current)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-semibold shadow-panel transition hover:border-teal-200 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-teal-400/40 dark:hover:text-teal-200"
          >
            {showCoaching ? "Hide coaching" : "Show coaching"}
          </button>

          {showCoaching ? (
            <div className="max-h-[calc(100vh-12rem)] w-full overflow-y-auto">
              <FeedbackPanel latestEvaluation={latestEvaluation} thoughts={coachingThoughts} onDismissThought={dismissCoachingThought} />
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
