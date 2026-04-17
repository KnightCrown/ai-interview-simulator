"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConfidenceMeter } from "@/components/confidence-meter";
import { FeedbackPanel } from "@/components/feedback-panel";
import { FunnelTracker } from "@/components/funnel-tracker";
import { InterviewerAvatar } from "@/components/interviewer-avatar";
import { MetricsCard } from "@/components/metrics-card";
import { ReplayImproveCard } from "@/components/replay-improve-card";
import { TypingQuestion } from "@/components/typing-question";
import { AnswerEvaluation, InterviewSession, InterviewTurn } from "@/lib/interview-types";
import { buildDemoTurn } from "@/lib/interview-engine";
import { liveConfidenceFromSignals } from "@/lib/interview-scoring";
import { useFaceTracking } from "@/hooks/useFaceTracking";
import { useInterviewerSpeech } from "@/hooks/useInterviewerSpeech";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useInterviewSession } from "@/lib/session-store";

type ViewMode = "candidate-focus" | "interviewer-focus";

export default function InterviewPage() {
  const router = useRouter();
  const { session, setSession } = useInterviewSession();
  const speech = useSpeechRecognition();
  const face = useFaceTracking();
  const interviewerSpeech = useInterviewerSpeech();
  const { speak, stop, mouthLevel, emotion, isSpeaking, status, error } = interviewerSpeech;
  const [latestEvaluation, setLatestEvaluation] = useState<AnswerEvaluation | null>(null);
  const [latestTurn, setLatestTurn] = useState<InterviewTurn | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [demoIndex, setDemoIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("candidate-focus");
  const lastSpokenQuestionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session) {
      router.replace("/");
    }
  }, [router, session]);

  const liveConfidence = useMemo(() => {
    if (!session) {
      return 50;
    }

    return liveConfidenceFromSignals({
      role: session.role,
      transcript: `${speech.transcript} ${speech.interimTranscript}`.trim(),
      speechMetrics: speech.metrics,
      faceMetrics: face.metrics
    });
  }, [face.metrics, session, speech.interimTranscript, speech.metrics, speech.transcript]);

  useEffect(() => {
    if (!session?.currentQuestion || session.demoMode || session.currentQuestion === lastSpokenQuestionRef.current) {
      return;
    }

    lastSpokenQuestionRef.current = session.currentQuestion;
    void speak(session.currentQuestion);
  }, [session?.currentQuestion, session?.demoMode, speak]);

  useEffect(() => {
    if (!session?.demoMode || isSubmitting || session.interviewComplete || demoIndex >= 5) {
      return;
    }

    if (demoIndex === 0 && session.currentQuestion && session.currentQuestion !== lastSpokenQuestionRef.current) {
      lastSpokenQuestionRef.current = session.currentQuestion;
      void speak(session.currentQuestion);
    }

    const timer = window.setTimeout(async () => {
      const demoTurn = buildDemoTurn(session.role, demoIndex, session.resume, session.memory);

      const response = await fetch("/api/interview/answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          session,
          transcript: demoTurn.transcript,
          durationSeconds: demoTurn.durationSeconds,
          speechMetrics: demoTurn.speechMetrics,
          faceMetrics: demoTurn.faceMetrics
        })
      });

      const data = (await response.json()) as { session: InterviewSession; evaluation: AnswerEvaluation };
      const producedTurn = data.session.turns[data.session.turns.length - 1] ?? null;
      setSession(data.session);
      setLatestEvaluation(data.evaluation);
      setLatestTurn(producedTurn);
      setDemoIndex((current) => current + 1);

      if (data.session.currentQuestion) {
        lastSpokenQuestionRef.current = data.session.currentQuestion;
        void speak(data.session.currentQuestion);
      }

      if (data.session.interviewComplete) {
        router.push("/results");
      }
    }, demoIndex === 0 ? 2200 : 3600);

    return () => {
      window.clearTimeout(timer);
    };
  }, [demoIndex, isSubmitting, router, session, setSession, speak]);

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
  };

  const submitAnswer = async () => {
    if (!speech.transcript.trim() || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    speech.stopListening();
    stop();

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

    const data = (await response.json()) as { session: InterviewSession; evaluation: AnswerEvaluation };
    const producedTurn = data.session.turns[data.session.turns.length - 1] ?? null;
    setSession(data.session);
    setLatestEvaluation(data.evaluation);
    setLatestTurn(producedTurn);
    setIsSubmitting(false);

    if (data.session.currentQuestion) {
      lastSpokenQuestionRef.current = data.session.currentQuestion;
      void speak(data.session.currentQuestion);
    }

    if (data.session.interviewComplete) {
      router.push("/results");
    }
  };

  const renderCandidateVideo = (compact = false) => (
    <div className={`relative overflow-hidden rounded-[1.8rem] bg-ink ${compact ? "h-full" : "h-full"}`}>
      <video ref={face.videoRef} autoPlay muted playsInline className="h-full w-full object-cover opacity-90" />
      <div className="absolute left-4 top-4 rounded-full bg-black/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white backdrop-blur">
        Your camera
      </div>
      <div className="absolute bottom-4 left-4 rounded-full bg-black/40 px-3 py-1 text-xs text-slate-100 backdrop-blur">
        {face.permissionError
          ? "Camera degraded"
          : face.isReady
            ? "Engagement tracking active"
            : "Preparing tracking"}
      </div>
    </div>
  );

  return (
    <main className="mx-auto min-h-screen max-w-[1600px] px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-teal-700">Live interview</p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">{session.role} simulation</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-panel">
            Question {session.turns.length + 1} of 5
          </div>
          <button
            type="button"
            onClick={endInterview}
            className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-slate-400"
          >
            End interview
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr_0.85fr]">
        <section className="space-y-6">
          <ConfidenceMeter value={liveConfidence} />
          <FunnelTracker currentStage={session.currentStage} outcome={session.hiringOutcome} />
          <MetricsCard speech={speech.metrics} face={face.metrics} />

          <div className="panel p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Interviewer systems</p>
            <div className="mt-4 grid gap-3">
              <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                3D avatar: {status.webGlSupported ? "ready" : "unavailable"}
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                Browser TTS: {status.speechSupported ? "ready" : "unavailable"}
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                Lip sync analyser: {status.lipSyncReady ? "ready" : "waiting"}
              </div>
            </div>
            {error ? (
              <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</p>
            ) : null}
          </div>
        </section>

        <section className="space-y-6">
          <div className="panel p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Current question</p>
                <p className="mt-3 min-h-24 text-2xl font-semibold leading-snug text-ink">
                  <TypingQuestion text={session.currentQuestion} />
                </p>
              </div>
              <button
                type="button"
                onClick={() => void speak(session.currentQuestion ?? "")}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:border-slate-400"
              >
                Replay interviewer
              </button>
            </div>
            <p className="mt-4 text-sm text-slate-500">
              Memory: {session.memory.toneSummary}. Strictness {session.memory.strictness}/100.
            </p>
          </div>

          <div className="panel p-4">
            <div className="mb-4 flex items-center justify-between gap-3 px-2">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Interview stage view</p>
                <p className="mt-1 text-sm text-slate-600">
                  Click the small interviewer panel to bring the avatar forward. Click your camera preview to swap back.
                </p>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                {viewMode === "candidate-focus" ? "Candidate focus" : "Interviewer focus"}
              </div>
            </div>

            <div className="relative aspect-video overflow-hidden rounded-[2rem] bg-slate-950">
              {viewMode === "candidate-focus" ? (
                <>
                  <div className="h-full w-full">{renderCandidateVideo()}</div>
                  <div className="absolute bottom-4 right-4 h-[34%] w-[26%] min-w-[180px]">
                    <InterviewerAvatar
                      compact
                      className="h-full w-full"
                      mouthLevel={mouthLevel}
                      emotion={emotion}
                      isSpeaking={isSpeaking}
                      onClick={() => setViewMode("interviewer-focus")}
                      title="AI interviewer"
                    />
                  </div>
                </>
              ) : (
                <>
                  <InterviewerAvatar
                    className="h-full w-full"
                    mouthLevel={mouthLevel}
                    emotion={emotion}
                    isSpeaking={isSpeaking}
                    onClick={() => setViewMode("candidate-focus")}
                    title="AI interviewer"
                  />
                  <button
                    type="button"
                    onClick={() => setViewMode("candidate-focus")}
                    className="absolute bottom-4 left-4 h-[32%] w-[24%] min-w-[180px] overflow-hidden rounded-[1.6rem] border border-white/15 shadow-2xl"
                  >
                    {renderCandidateVideo(true)}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="panel p-6">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={startCandidateResponse}
                disabled={!speech.isSupported || isSubmitting || session.demoMode}
                className="rounded-2xl bg-teal-600 px-5 py-3 font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {speech.isListening ? "Stop response" : "Start response"}
              </button>
              <button
                type="button"
                onClick={submitAnswer}
                disabled={!speech.transcript.trim() || isSubmitting || session.demoMode}
                className="rounded-2xl border border-slate-300 px-5 py-3 font-semibold text-ink transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSubmitting ? "Evaluating..." : "Submit answer"}
              </button>
              <div className="text-sm text-slate-500">
                {session.demoMode
                  ? "Demo mode is auto-running a sample interview."
                  : speech.isSupported
                    ? `${speech.elapsedSeconds}s recorded`
                    : "Speech recognition is not supported in this browser."}
              </div>
            </div>

            <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Live transcript</p>
              <p className="mt-3 min-h-32 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                {session.demoMode
                  ? "Demo mode is automatically stepping through strong sample answers so judges can experience the product immediately."
                  : `${speech.transcript} ${speech.interimTranscript}`.trim() || "Start speaking to populate the transcript box in real time."}
              </p>
            </div>
          </div>

          <ReplayImproveCard turn={latestTurn} />
        </section>

        <FeedbackPanel evaluation={latestEvaluation} />
      </div>
    </main>
  );
}
