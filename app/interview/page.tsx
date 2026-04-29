"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export default function InterviewPage() {
  const router = useRouter();
  const { session, setSession } = useInterviewSession();
  const speech = useSpeechRecognition();
  const face = useFaceTracking();
  const interviewerSpeech = useInterviewerSpeech();
  const { speak, stop, mouthLevel, emotion, isSpeaking } = interviewerSpeech;
  const [latestEvaluation, setLatestEvaluation] = useState<AnswerEvaluation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCoaching, setShowCoaching] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const lastSpokenQuestionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session) {
      router.replace("/");
    }
  }, [router, session]);

  const currentTranscript = `${speech.transcript} ${speech.interimTranscript}`.trim();
  const spokenWords = countWords(currentTranscript);
  const currentQuestionNumber = session ? Math.min(session.turns.length + 1, TOTAL_QUESTIONS) : 1;

  const liveConfidence = useMemo(() => {
    if (!session) {
      return 50;
    }

    return liveConfidenceFromSignals({
      role: session.role,
      transcript: currentTranscript,
      speechMetrics: speech.metrics,
      faceMetrics: face.metrics
    });
  }, [currentTranscript, face.metrics, session, speech.metrics]);

  useEffect(() => {
    if (!session?.currentQuestion || session.currentQuestion === lastSpokenQuestionRef.current) {
      return;
    }

    lastSpokenQuestionRef.current = session.currentQuestion;
    void speak(session.currentQuestion);
  }, [session?.currentQuestion, speak]);

  if (!session) {
    return null;
  }

  const endInterview = () => {
    speech.stopListening();
    stop();
    setSession({
      ...session,
      interviewComplete: true
    });
    router.push("/results");
  };

  const startCandidateResponse = () => {
    stop();
    if (speech.isListening) {
      speech.stopListening();
      return;
    }

    speech.startListening();
    setSubmitError(null);
    setShowTranscript(true);
  };

  const submitAnswer = async () => {
    if (!speech.transcript.trim() || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    speech.stopListening();
    stop();

    try {
      const response = await fetch("/api/interview/answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          session,
          transcript: speech.transcript.trim(),
          durationSeconds: speech.elapsedSeconds,
          speechMetrics: speech.metrics,
          faceMetrics: face.metrics
        })
      });

      if (!response.ok) {
        throw new Error("The answer could not be evaluated. Please try again.");
      }

      const data = (await response.json()) as { session: InterviewSession; evaluation: AnswerEvaluation };
      setSession(data.session);
      setLatestEvaluation(data.evaluation);
      setShowCoaching(true);

      if (data.session.currentQuestion) {
        lastSpokenQuestionRef.current = data.session.currentQuestion;
        void speak(data.session.currentQuestion);
      }

      if (data.session.interviewComplete) {
        router.push("/results");
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The answer could not be evaluated. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrimaryAction = () => {
    if (speech.isListening) {
      speech.stopListening();
      return;
    }

    if (speech.transcript.trim()) {
      void submitAnswer();
      return;
    }

    startCandidateResponse();
  };

  const primaryLabel = speech.isListening ? "Stop Answer" : speech.transcript.trim() ? "Submit Answer" : "Start Answer";
  const silenceSeconds = speech.isListening && spokenWords === 0 ? speech.elapsedSeconds : 0;

  return (
    <main className="min-h-screen bg-[#f7f9fc] text-ink">
      <video ref={face.videoRef} autoPlay muted playsInline className="sr-only" />

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
          </div>

          <div className="mt-10 space-y-8 border-t border-slate-200 pt-8">
            <div>
              <p className="text-sm font-semibold">Words spoken</p>
              <p className="mt-4 text-3xl font-semibold">{spokenWords}</p>
              <p className="mt-1 text-sm text-slate-500">words</p>
            </div>

            <div className="border-t border-slate-200 pt-8">
              <p className="text-sm font-semibold">Speaking time</p>
              <p className="mt-4 text-3xl font-semibold">{formatTime(speech.elapsedSeconds)}</p>
              <p className="mt-1 text-sm text-slate-500">min</p>
            </div>

            <div className="border-t border-slate-200 pt-8">
              <p className="text-sm font-semibold">Silence</p>
              <p className="mt-4 text-3xl font-semibold">{silenceSeconds}s</p>
              <p className="mt-1 text-sm text-slate-500">last 30s</p>
            </div>
          </div>
        </aside>

        <section className="space-y-6">
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-950 shadow-panel">
            <InterviewerAvatar
              className="h-full w-full rounded-2xl border-0 shadow-none"
              mouthLevel={mouthLevel}
              emotion={emotion}
              isSpeaking={isSpeaking}
              title="AI interviewer"
              showLabels={false}
            />
            <button
              type="button"
              onClick={() => void speak(session.currentQuestion ?? "")}
              className="absolute right-4 top-4 rounded-xl bg-white/20 px-4 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/30"
            >
              Replay
            </button>
            <div className="absolute bottom-5 left-5 rounded-xl bg-black/55 px-4 py-2 text-sm font-semibold text-white backdrop-blur">
              <span className="mr-2 inline-block h-3 w-3 rounded-full bg-teal-400 align-middle" />
              Interviewing
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-8 py-7 shadow-panel">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Interviewer question</p>
            <p className="mt-5 min-h-16 text-2xl font-semibold leading-snug sm:text-3xl">
              <TypingQuestion text={session.currentQuestion} />
            </p>

            <div className="mt-8 flex flex-col items-center">
              <button
                type="button"
                onClick={handlePrimaryAction}
                disabled={!speech.isSupported || isSubmitting}
                className="min-h-16 w-full max-w-sm rounded-2xl bg-teal-600 px-8 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isSubmitting ? "Evaluating..." : primaryLabel}
              </button>
              <p className="mt-4 text-sm text-slate-500">
                {speech.isSupported
                  ? speech.transcript.trim()
                    ? "Click to evaluate your answer"
                    : "Click when you're ready to speak"
                  : "Speech recognition is not supported in this browser."}
              </p>
              {submitError ? <p className="mt-3 text-sm font-medium text-red-600">{submitError}</p> : null}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel">
            <button
              type="button"
              onClick={() => setShowTranscript((current) => !current)}
              className="flex w-full items-center justify-between gap-4 px-8 py-5 text-left"
            >
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Live transcript</span>
              <span className="text-sm text-slate-500">
                {currentTranscript ? "View current answer" : "Will appear here when you start speaking"} {showTranscript ? "Up" : "Down"}
              </span>
            </button>
            {showTranscript ? (
              <div className="border-t border-slate-200 bg-slate-50 px-8 py-5">
                <p className="min-h-20 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                  {currentTranscript || "Start speaking to populate the transcript in real time."}
                </p>
              </div>
            ) : null}
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
