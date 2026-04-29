"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FeedbackPanel } from "@/components/feedback-panel";
import { InterviewerAvatar } from "@/components/interviewer-avatar";
import { TypingQuestion } from "@/components/typing-question";
import { AnswerEvaluation, InterviewSession } from "@/lib/interview-types";
import { liveConfidenceFromSignals } from "@/lib/interview-scoring";
import { useFaceTracking } from "@/hooks/useFaceTracking";
import { useInterviewerSpeech } from "@/hooks/useInterviewerSpeech";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useInterviewSession } from "@/lib/session-store";

const TOTAL_QUESTIONS = 5;
const ANSWER_SECONDS = 60;

type MainVideo = "interviewer" | "candidate";

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

export default function InterviewPage() {
  const router = useRouter();
  const { session, setSession } = useInterviewSession();
  const speech = useSpeechRecognition();
  const face = useFaceTracking();
  const interviewerSpeech = useInterviewerSpeech();
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
  const { speak, stop, mouthLevel, emotion, isSpeaking } = interviewerSpeech;
  const [latestEvaluation, setLatestEvaluation] = useState<AnswerEvaluation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCoaching, setShowCoaching] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [mainVideo, setMainVideo] = useState<MainVideo>("interviewer");
  const [answerSecondsRemaining, setAnswerSecondsRemaining] = useState(ANSWER_SECONDS);
  const lastSpokenQuestionRef = useRef<string | null>(null);
  const autoSubmittedRef = useRef(false);
  const submitAnswerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!session) {
      router.replace("/");
    }
  }, [router, session]);

  const currentTranscript = `${transcript} ${interimTranscript}`.trim();
  const visibleTranscript = showTranscript ? currentTranscript : "";
  const repeatedFillerWords = getRepeatedFillerWords(currentTranscript, speechMetrics.fillerWords);
  const speakingPaceLabel = getSpeakingPaceLabel(speechMetrics.speakingPace);
  const currentQuestionNumber = session ? Math.min(session.turns.length + 1, TOTAL_QUESTIONS) : 1;
  const answerDurationSeconds = Math.max(1, ANSWER_SECONDS - answerSecondsRemaining);

  const liveConfidence = useMemo(() => {
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

  const submitAnswer = useCallback(async () => {
    if (!session || isSubmitting) {
      return;
    }

    const transcriptForEvaluation = visibleTranscript.trim();

    setIsSubmitting(true);
    setSubmitError(null);
    setCaptureEnabled(false);
    setShowTranscript(false);
    stop();

    try {
      const response = await fetch("/api/interview/answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          session,
          transcript: transcriptForEvaluation,
          durationSeconds: answerDurationSeconds,
          speechMetrics,
          faceMetrics: face.metrics
        })
      });

      if (!response.ok) {
        throw new Error("The answer could not be evaluated. Please try again.");
      }

      const data = (await response.json()) as { session: InterviewSession; evaluation: AnswerEvaluation };
      resetTranscript();
      setSession(data.session);
      setLatestEvaluation(data.evaluation);
      setShowCoaching(true);
      setAnswerSecondsRemaining(ANSWER_SECONDS);
      autoSubmittedRef.current = false;

      if (data.session.interviewComplete) {
        router.push("/results");
      }
    } catch (error) {
      setCaptureEnabled(true);
      setShowTranscript(true);
      setSubmitError(error instanceof Error ? error.message : "The answer could not be evaluated. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [answerDurationSeconds, face.metrics, isSubmitting, resetTranscript, router, session, setCaptureEnabled, setSession, speechMetrics, stop, visibleTranscript]);

  useEffect(() => {
    submitAnswerRef.current = () => {
      void submitAnswer();
    };
  }, [submitAnswer]);

  useEffect(() => {
    if (!session?.currentQuestion || session.currentQuestion === lastSpokenQuestionRef.current) {
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
  }, [resetTranscript, session?.currentQuestion, setCaptureEnabled, speak, stop, stopListening]);

  useEffect(() => {
    if (!showTranscript || isSubmitting || session?.interviewComplete) {
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
  }, [answerSecondsRemaining, isSubmitting, session?.interviewComplete, showTranscript]);

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
    <main className="min-h-screen bg-[#f7f9fc] text-ink">

      <header className="border-b border-slate-200/80 bg-white/90 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-[118rem] flex-col gap-4 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <div className="flex items-center gap-4">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-sm font-bold text-white">AI</div>
            <h1 className="text-base font-semibold sm:text-lg">{session.role} Simulation</h1>
          </div>

          <div className="justify-self-center text-center">
            <p className="text-sm font-medium">Question {currentQuestionNumber} of {TOTAL_QUESTIONS}</p>
            <div className="mt-3 flex items-center justify-center gap-3">
              {Array.from({ length: TOTAL_QUESTIONS }).map((_, index) => {
                const step = index + 1;
                const isActive = step <= currentQuestionNumber;

                return (
                  <div key={step} className="flex items-center gap-3">
                    <span className={`h-3 w-3 rounded-full ${isActive ? "bg-teal-600" : "bg-slate-200"}`} />
                    {step < TOTAL_QUESTIONS ? (
                      <span className={`h-1 w-14 rounded-full ${step < currentQuestionNumber ? "bg-teal-600" : "bg-slate-200"}`} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-start lg:justify-end">
            <button
              type="button"
              onClick={endInterview}
              className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-red-600 shadow-sm transition hover:border-red-200 hover:bg-red-50"
            >
              End interview
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[118rem] gap-6 px-5 py-8 lg:grid-cols-[16rem_minmax(0,68rem)_13rem]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-panel lg:sticky lg:top-8 lg:h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Live insights</p>

          <div className="mt-10">
            <p className="text-sm font-semibold">Confidence</p>
            <div className="mt-6 flex items-center gap-5">
              <div
                className="grid h-24 w-24 shrink-0 place-items-center rounded-full"
                style={{ background: `conic-gradient(#14a38b ${liveConfidence * 3.6}deg, #eef2f7 0deg)` }}
              >
                <div className="h-16 w-16 rounded-full bg-white" />
              </div>
              <div>
                <p className="text-4xl font-semibold">{liveConfidence}<span className="text-base font-medium text-slate-400"> /100</span></p>
                <p className="mt-2 text-sm font-semibold text-teal-600">{liveConfidence >= 70 ? "Strong" : liveConfidence >= 55 ? "Good" : "Warming up"}</p>
              </div>
            </div>
            <p className="mt-7 text-sm text-slate-500">Eye Contact: {face.metrics.eyeContact}</p>
          </div>

          <div className="mt-10 space-y-8 border-t border-slate-200 pt-8">
            <div>
              <p className="text-sm font-semibold">Words per Min</p>
              <p className="mt-4 text-3xl font-semibold">{speechMetrics.speakingPace}</p>
              <p className="mt-1 text-sm text-slate-500">{speakingPaceLabel}</p>
            </div>

            <div className="border-t border-slate-200 pt-8">
              <p className="text-sm font-semibold">Speaking time</p>
              <p className="mt-4 text-3xl font-semibold">{formatTime(elapsedSeconds)}</p>
              <p className="mt-1 text-sm text-slate-500">min</p>
            </div>

            <div className="border-t border-slate-200 pt-8">
              <p className="text-sm font-semibold">Filler Words</p>
              <p className="mt-4 text-3xl font-semibold">{speechMetrics.fillerCount}</p>
              {repeatedFillerWords.length > 0 ? (
                <p className="mt-1 text-sm text-slate-500">
                  {repeatedFillerWords.map((item) => `${item.word} (${item.count})`).join(", ")}
                </p>
              ) : null}
            </div>
          </div>
        </aside>

        <section className="space-y-5">
          <div className="relative mx-auto aspect-video max-h-[46vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-slate-950 shadow-panel">
            {mainVideo === "interviewer" ? (
              <InterviewerAvatar
                className="h-full w-full rounded-2xl border-0 shadow-none"
                mouthLevel={mouthLevel}
                emotion={emotion}
                isSpeaking={isSpeaking}
                title="AI interviewer"
                showLabels={false}
              />
            ) : null}

            <video
              ref={face.videoRef}
              autoPlay
              muted
              playsInline
              onClick={() => setMainVideo("interviewer")}
              className={mainVideo === "candidate" ? "h-full w-full cursor-pointer object-cover" : "sr-only"}
            />

            {mainVideo === "candidate" ? (
              <div className="absolute bottom-4 right-4 h-[34%] w-[28%] min-w-40">
                <InterviewerAvatar
                  compact
                  className="h-full w-full rounded-xl border border-white/20 shadow-2xl"
                  mouthLevel={mouthLevel}
                  emotion={emotion}
                  isSpeaking={isSpeaking}
                  onClick={() => setMainVideo("interviewer")}
                  title="AI interviewer"
                  showLabels={false}
                />
              </div>
            ) : null}

            {mainVideo === "interviewer" ? (
              <button
                type="button"
                onClick={() => setMainVideo("candidate")}
                className="absolute bottom-4 right-4 grid h-12 w-12 place-items-center rounded-xl bg-black/55 text-white backdrop-blur transition hover:bg-black/70"
                aria-label="Show candidate camera"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 7h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
                  <path d="m17 10 5-3v10l-5-3" />
                </svg>
              </button>
            ) : null}

            {mainVideo === "candidate" ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void face.cycleCamera();
                }}
                className="absolute right-4 top-4 grid h-12 w-12 place-items-center rounded-xl bg-black/55 text-white backdrop-blur transition hover:bg-black/70"
                aria-label="Switch camera device"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 0 1-15.5 6.2" />
                  <path d="M3 12A9 9 0 0 1 18.5 5.8" />
                  <path d="M18 3v4h-4" />
                  <path d="M6 21v-4h4" />
                </svg>
              </button>
            ) : null}

            <div className="absolute bottom-5 left-5 rounded-xl bg-black/55 px-4 py-2 text-sm font-semibold text-white backdrop-blur">
              <span className="mr-2 inline-block h-3 w-3 rounded-full bg-teal-400 align-middle" />
              {mainVideo === "interviewer" ? "Interviewing" : "Candidate camera"}
            </div>
          </div>

          <div className="mx-auto w-full max-w-4xl rounded-2xl border border-slate-200 bg-white px-8 py-6 shadow-panel">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Interviewer question</p>
                <p className="mt-4 text-xl font-bold leading-snug text-ink sm:text-2xl">
                  <TypingQuestion text={session.currentQuestion} />
                </p>
              </div>

              {showTranscript ? (
                <div className="rounded-xl bg-slate-50 px-4 py-3 text-right">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Time left</p>
                  <p className="mt-1 text-2xl font-semibold">{formatTime(answerSecondsRemaining)}</p>
                </div>
              ) : null}
            </div>

            {showTranscript ? (
              <div className="mt-6 border-t border-slate-200 pt-5">
                <p className="min-h-20 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                  {visibleTranscript || "Your answer will appear here in real time."}
                </p>
              </div>
            ) : null}

            <div className="mt-6 flex flex-col items-center border-t border-slate-200 pt-5">
              <button
                type="button"
                onClick={() => void submitAnswer()}
                disabled={!showTranscript || isSubmitting}
                className="min-h-12 w-full max-w-xs rounded-xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isSubmitting ? "Evaluating..." : "Submit early"}
              </button>
              <p className="mt-3 text-sm text-slate-500">
                {speechIsSupported ? "Answer timer starts when the interviewer finishes speaking." : "Speech recognition is not supported in this browser."}
              </p>
              {submitError ? <p className="mt-3 text-sm font-medium text-red-600">{submitError}</p> : null}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <button
            type="button"
            onClick={() => setShowCoaching((current) => !current)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-semibold shadow-panel transition hover:border-teal-200 hover:text-teal-700"
          >
            {showCoaching ? "Hide coaching" : "Show coaching"}
          </button>

          {showCoaching ? (
            <div className="fixed right-5 top-24 z-30 max-h-[calc(100vh-7rem)] w-[min(26rem,calc(100vw-2.5rem))] overflow-y-auto">
              <FeedbackPanel evaluation={latestEvaluation} />
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
