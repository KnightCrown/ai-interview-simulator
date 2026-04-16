"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FeedbackPanel } from "@/components/feedback-panel";
import { MetricsCard } from "@/components/metrics-card";
import { AnswerEvaluation, InterviewSession } from "@/lib/interview-types";
import { useFaceTracking } from "@/hooks/useFaceTracking";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useInterviewSession } from "@/lib/session-store";

export default function InterviewPage() {
  const router = useRouter();
  const { session, setSession } = useInterviewSession();
  const speech = useSpeechRecognition();
  const face = useFaceTracking();
  const [latestEvaluation, setLatestEvaluation] = useState<AnswerEvaluation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!session) {
      router.replace("/");
    }
  }, [router, session]);

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
    setSession(data.session);
    setLatestEvaluation(data.evaluation);
    setIsSubmitting(false);

    if (data.session.interviewComplete) {
      router.push("/results");
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6">
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

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="space-y-6">
          <div className="panel p-6">
            <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Current question</p>
            <h2 className="mt-3 text-2xl font-semibold leading-snug text-ink">{session.currentQuestion}</h2>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="panel overflow-hidden p-4">
              <div className="overflow-hidden rounded-3xl bg-ink">
                <video ref={face.videoRef} autoPlay muted playsInline className="aspect-video w-full object-cover opacity-90" />
              </div>
              <div className="mt-4 text-sm text-slate-600">
                {face.permissionError
                  ? `Webcam tracking unavailable: ${face.permissionError}`
                  : face.isReady
                    ? "Face Mesh is tracking eye contact and head stability."
                    : "Preparing webcam analysis..."}
              </div>
            </div>

            <MetricsCard speech={speech.metrics} face={face.metrics} />
          </div>

          <div className="panel p-6">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={speech.isListening ? speech.stopListening : speech.startListening}
                disabled={!speech.isSupported || isSubmitting}
                className="rounded-2xl bg-teal-600 px-5 py-3 font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {speech.isListening ? "Stop response" : "Start response"}
              </button>
              <button
                type="button"
                onClick={submitAnswer}
                disabled={!speech.transcript.trim() || isSubmitting}
                className="rounded-2xl border border-slate-300 px-5 py-3 font-semibold text-ink transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSubmitting ? "Evaluating..." : "Submit answer"}
              </button>
              <div className="text-sm text-slate-500">
                {speech.isSupported ? `${speech.elapsedSeconds}s recorded` : "Speech recognition is not supported in this browser."}
              </div>
            </div>

            <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Live transcript</p>
              <p className="mt-3 min-h-24 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                {`${speech.transcript} ${speech.interimTranscript}`.trim() || "Start speaking to populate the transcript box in real time."}
              </p>
            </div>
          </div>
        </section>

        <FeedbackPanel evaluation={latestEvaluation} />
      </div>
    </main>
  );
}
