"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ConfidenceMeter } from "@/components/confidence-meter";
import { FeedbackPanel } from "@/components/feedback-panel";
import { FunnelTracker } from "@/components/funnel-tracker";
import { MetricsCard } from "@/components/metrics-card";
import { ReplayImproveCard } from "@/components/replay-improve-card";
import { TypingQuestion } from "@/components/typing-question";
import { AnswerEvaluation, InterviewSession, InterviewTurn } from "@/lib/interview-types";
import { buildDemoTurn } from "@/lib/interview-engine";
import { liveConfidenceFromSignals } from "@/lib/interview-scoring";
import { useFaceTracking } from "@/hooks/useFaceTracking";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useInterviewSession } from "@/lib/session-store";

export default function InterviewPage() {
  const router = useRouter();
  const { session, setSession } = useInterviewSession();
  const speech = useSpeechRecognition();
  const face = useFaceTracking();
  const [latestEvaluation, setLatestEvaluation] = useState<AnswerEvaluation | null>(null);
  const [latestTurn, setLatestTurn] = useState<InterviewTurn | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [demoIndex, setDemoIndex] = useState(0);

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
    if (!session?.demoMode || isSubmitting || session.interviewComplete || demoIndex >= 5) {
      return;
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

      if (data.session.interviewComplete) {
        router.push("/results");
      }
    }, demoIndex === 0 ? 1200 : 2200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [demoIndex, isSubmitting, router, session, setSession]);

  if (!session) {
    return null;
  }

  const endInterview = () => {
    speech.stopListening();
    setSession({
      ...session,
      interviewComplete: true
    });
    router.push("/results");
  };

  const submitAnswer = async () => {
    if (!speech.transcript.trim() || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    speech.stopListening();

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

    if (data.session.interviewComplete) {
      router.push("/results");
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-4 py-8 sm:px-6">
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

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1fr_0.85fr]">
        <section className="space-y-6">
          <div className="panel overflow-hidden p-4">
            <div className="overflow-hidden rounded-3xl bg-ink">
              <video ref={face.videoRef} autoPlay muted playsInline className="aspect-video w-full object-cover opacity-90" />
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p className="font-semibold text-ink">Interviewer view</p>
              <p>{session.memory.interviewerMood}</p>
              <p>
                {face.permissionError
                  ? `Webcam tracking unavailable: ${face.permissionError}`
                  : face.isReady
                    ? "Face Mesh is tracking eye contact and head stability."
                    : "Preparing webcam analysis..."}
              </p>
            </div>
          </div>

          <ConfidenceMeter value={liveConfidence} />
          <FunnelTracker currentStage={session.currentStage} outcome={session.hiringOutcome} />
          <MetricsCard speech={speech.metrics} face={face.metrics} />
        </section>

        <section className="space-y-6">
          <div className="panel p-6">
            <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Current question</p>
            <h2 className="mt-3 min-h-24 text-2xl font-semibold leading-snug text-ink">
              <TypingQuestion text={session.currentQuestion} />
            </h2>
            <p className="mt-4 text-sm text-slate-500">
              Memory: {session.memory.toneSummary}. Strictness {session.memory.strictness}/100.
            </p>
          </div>

          <div className="panel p-6">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={speech.isListening ? speech.stopListening : speech.startListening}
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
