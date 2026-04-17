"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FunnelTracker } from "@/components/funnel-tracker";
import { FinalReport } from "@/lib/interview-types";
import { useInterviewSession } from "@/lib/session-store";
import { ScorePill } from "@/components/score-pill";

export default function ResultsPage() {
  const router = useRouter();
  const { session, resetSession } = useInterviewSession();
  const [report, setReport] = useState<FinalReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!session) {
      router.replace("/");
      return;
    }

    let isMounted = true;

    async function loadReport() {
      const response = await fetch("/api/interview/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ session })
      });

      const data = (await response.json()) as { report: FinalReport };
      if (isMounted) {
        setReport(data.report);
        setIsLoading(false);
      }
    }

    void loadReport();

    return () => {
      isMounted = false;
    };
  }, [router, session]);

  if (!session) {
    return null;
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <div className="space-y-8">
        <div className="panel p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-teal-700">Final hiring report</p>
              <h1 className="mt-2 text-4xl font-semibold text-ink">Interview summary for {session.role}</h1>
              <p className="mt-3 max-w-3xl text-slate-600">
                This report is written to feel like a recruiter readout: what landed, what missed, and how the candidate came across under pressure.
              </p>
            </div>
            <Link href="/" onClick={resetSession} className="rounded-2xl border border-slate-300 px-5 py-3 font-semibold text-ink">
              Start a new session
            </Link>
          </div>
        </div>

        {isLoading || !report ? (
          <div className="panel p-8 text-slate-600">Generating your final hiring report...</div>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
              <div className="rounded-[2rem] bg-ink p-8 text-white shadow-panel">
                <p className="text-sm uppercase tracking-[0.24em] text-teal-200">Hiring outcome</p>
                <p className="mt-4 text-5xl font-semibold">{report.hiringOutcome}</p>
                <p className="mt-3 text-lg text-slate-200">Hiring likelihood: {report.hiringLikelihood}</p>
                <p className="mt-6 text-sm leading-7 text-slate-200">{report.emotionalSummary}</p>
              </div>

              <div className="panel p-6">
                <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Score breakdown</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ScorePill label="Overall" value={report.overallScore} />
                  <ScorePill label="Clarity" value={report.clarity} />
                  <ScorePill label="Relevance" value={report.relevance} />
                  <ScorePill label="Confidence" value={report.confidence} />
                  <ScorePill label="Engagement" value={report.engagement} />
                </div>
                <div className="mt-6">
                  <FunnelTracker currentStage={session.currentStage} outcome={report.hiringOutcome} />
                </div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="panel p-6">
                <h2 className="text-xl font-semibold text-ink">Strengths</h2>
                <div className="mt-4 space-y-2">
                  {report.strengths.map((item) => (
                    <div key={item} className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                      {item}
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel p-6">
                <h2 className="text-xl font-semibold text-ink">Weaknesses</h2>
                <div className="mt-4 space-y-2">
                  {report.weaknesses.map((item) => (
                    <div key={item} className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-950">
                      {item}
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="panel p-6">
                <h2 className="text-xl font-semibold text-ink">Missed opportunities</h2>
                <p className="mt-4 text-sm leading-7 text-slate-700">{report.missedOpportunitySummary}</p>
                <h3 className="mt-6 font-semibold text-ink">Best AI rewrite</h3>
                <p className="mt-3 rounded-3xl bg-teal-50 px-4 py-4 text-sm leading-7 text-teal-950">{report.bestImprovedAnswer}</p>
              </section>

              <section className="panel p-6">
                <h2 className="text-xl font-semibold text-ink">Interviewer notes</h2>
                <div className="mt-4 space-y-2">
                  {report.interviewerNotes.map((note) => (
                    <div key={note} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      {note}
                    </div>
                  ))}
                </div>
                <h3 className="mt-6 font-semibold text-ink">Suggested next improvements</h3>
                <div className="mt-4 space-y-2">
                  {report.suggestedNextImprovements.map((item) => (
                    <div key={item} className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
                      {item}
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="panel p-6">
              <h2 className="text-xl font-semibold text-ink">Answer timeline</h2>
              <div className="mt-5 space-y-4">
                {session.turns.map((turn, index) => (
                  <div key={turn.id} className="rounded-3xl border border-slate-200 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Question {index + 1}</p>
                    <p className="mt-2 font-medium text-ink">{turn.question}</p>
                    <p className="mt-3 text-sm leading-7 text-slate-600">{turn.transcript}</p>
                    <p className="mt-3 text-sm font-medium text-teal-800">{turn.evaluation.interviewerReaction}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
