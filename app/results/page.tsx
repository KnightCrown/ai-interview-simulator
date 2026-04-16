"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

    loadReport();

    return () => {
      isMounted = false;
    };
  }, [router, session]);

  if (!session) {
    return null;
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <div className="panel p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-teal-700">Final report</p>
            <h1 className="mt-2 text-4xl font-semibold text-ink">Interview summary for {session.role}</h1>
            <p className="mt-3 text-slate-600">
              {session.turns.length} answers analyzed across speech, content relevance, structure, and on-camera engagement.
            </p>
          </div>
          <Link href="/" onClick={resetSession} className="rounded-2xl border border-slate-300 px-5 py-3 font-semibold text-ink">
            Start a new session
          </Link>
        </div>

        {isLoading || !report ? (
          <div className="mt-8 rounded-3xl bg-slate-50 p-6 text-slate-600">Generating your final hiring report...</div>
        ) : (
          <>
            <div className="mt-8 grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[2rem] bg-ink p-8 text-white">
                <p className="text-sm uppercase tracking-[0.24em] text-teal-200">Overall score</p>
                <p className="mt-4 text-6xl font-semibold">{report.overallScore}</p>
                <p className="mt-4 text-lg text-slate-200">Hiring likelihood: {report.hiringLikelihood}</p>
              </div>
              <div className="panel p-6">
                <div className="flex flex-wrap gap-2">
                  <ScorePill label="Clarity" value={report.clarity} />
                  <ScorePill label="Relevance" value={report.relevance} />
                  <ScorePill label="Confidence" value={report.confidence} />
                  <ScorePill label="Engagement" value={report.engagement} />
                </div>
                <p className="mt-6 text-sm text-slate-600">
                  This score reflects the combined strength of your spoken content, delivery, and visible engagement during the mock interview.
                </p>
              </div>
            </div>

            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <section className="panel p-6">
                <h2 className="text-xl font-semibold text-ink">Missed opportunity summary</h2>
                <p className="mt-4 text-sm leading-7 text-slate-700">{report.missedOpportunitySummary}</p>
              </section>

              <section className="panel p-6">
                <h2 className="text-xl font-semibold text-ink">Best improved answer example</h2>
                <p className="mt-4 rounded-3xl bg-teal-50 px-4 py-4 text-sm leading-7 text-teal-950">{report.bestImprovedAnswer}</p>
              </section>
            </div>

            <section className="mt-8 panel p-6">
              <h2 className="text-xl font-semibold text-ink">Answer timeline</h2>
              <div className="mt-5 space-y-4">
                {session.turns.map((turn, index) => (
                  <div key={turn.id} className="rounded-3xl border border-slate-200 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Question {index + 1}</p>
                    <p className="mt-2 font-medium text-ink">{turn.question}</p>
                    <p className="mt-3 text-sm leading-7 text-slate-600">{turn.transcript}</p>
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
