"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FinalReport, FunnelOutcome } from "@/lib/interview-types";
import { useInterviewSession } from "@/lib/session-store";

type OutcomeTone = {
  label: string;
  accent: string;
  soft: string;
  text: string;
  symbol: string;
};

const OUTCOME_TONES: Record<FunnelOutcome, OutcomeTone> = {
  Selected: {
    label: "Accepted",
    accent: "#10b981",
    soft: "rgba(16,185,129,0.16)",
    text: "text-emerald-400",
    symbol: "OK"
  },
  Borderline: {
    label: "Borderline",
    accent: "#f59e0b",
    soft: "rgba(245,158,11,0.18)",
    text: "text-amber-300",
    symbol: "!"
  },
  Rejected: {
    label: "Rejected",
    accent: "#fb7185",
    soft: "rgba(251,113,133,0.18)",
    text: "text-rose-400",
    symbol: "X"
  }
};

const SCORE_COLORS = {
  Overall: "#6d4de6",
  Clarity: "#168ce5",
  Relevance: "#12a982",
  Confidence: "#f47b2d",
  Engagement: "#f6af2f"
} satisfies Record<string, string>;

function SummaryIcon({
  name,
  className = "h-5 w-5"
}: {
  name: "message" | "check" | "trend" | "spark" | "chevron";
  className?: string;
}) {
  const commonProps = {
    className,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
    "aria-hidden": true
  };

  if (name === "message") {
    return (
      <svg {...commonProps}>
        <path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v4A3.5 3.5 0 0 1 15.5 14H11l-4.5 4v-4.3A3.5 3.5 0 0 1 5 10.5Z" />
        <path d="M9 7h6" />
        <path d="M9 10h4" />
      </svg>
    );
  }

  if (name === "check") {
    return (
      <svg {...commonProps}>
        <path d="m6 12 4 4 8-8" />
      </svg>
    );
  }

  if (name === "trend") {
    return (
      <svg {...commonProps}>
        <path d="M4 17h16" />
        <path d="m6 14 4-4 3 3 5-6" />
        <path d="M15 7h3v3" />
      </svg>
    );
  }

  if (name === "spark") {
    return (
      <svg {...commonProps}>
        <path d="M12 3v4" />
        <path d="M12 17v4" />
        <path d="M3 12h4" />
        <path d="M17 12h4" />
        <path d="m6.5 6.5 2.8 2.8" />
        <path d="m14.7 14.7 2.8 2.8" />
        <path d="m17.5 6.5-2.8 2.8" />
        <path d="m9.3 14.7-2.8 2.8" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function scoreToTen(value: number) {
  return Math.max(0, Math.min(10, value / 10));
}

function scoreLabel(value: number) {
  if (value >= 75) return "Excellent";
  if (value >= 65) return "Good";
  if (value >= 50) return "Below average";
  return "Needs work";
}

function ScoreCard({ label, value }: { label: keyof typeof SCORE_COLORS; value: number }) {
  const color = SCORE_COLORS[label];
  const score = scoreToTen(value);

  return (
    <div className="rounded-2xl bg-slate-50 px-5 py-5 shadow-sm">
      <p className="text-center text-sm font-semibold text-ink">{label}</p>
      <div className="mt-5 flex items-center justify-center gap-4">
        <div
          className="grid h-16 w-16 shrink-0 place-items-center rounded-full"
          style={{ background: `conic-gradient(${color} ${value * 3.6}deg, #edf2f7 0deg)` }}
        >
          <div className="h-10 w-10 rounded-full bg-white" />
        </div>
        <div>
          <p className="text-3xl font-semibold text-ink">{score.toFixed(1)}</p>
          <p className="text-sm text-slate-500">/ 10</p>
        </div>
      </div>
      <p className="mt-4 text-center text-sm font-medium" style={{ color }}>
        {scoreLabel(value)}
      </p>
    </div>
  );
}

function ListItem({ item, tone }: { item: string; tone: "good" | "improve" }) {
  const isGood = tone === "good";

  return (
    <div className="flex gap-4">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${isGood ? "bg-teal-50 text-teal-700" : "bg-rose-50 text-rose-600"}`}>
        <SummaryIcon name={isGood ? "check" : "trend"} />
      </div>
      <div>
        <p className="font-semibold text-ink">{item}</p>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          {isGood ? "This helped your answer feel more credible." : "This would make the answer more concrete and easier to trust."}
        </p>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const router = useRouter();
  const { session, resetSession } = useInterviewSession();
  const [report, setReport] = useState<FinalReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [missedOpen, setMissedOpen] = useState(false);

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

  const interviewerNotes = useMemo(() => report?.interviewerNotes.join(" ") ?? "", [report]);

  if (!session) {
    return null;
  }

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto max-w-7xl rounded-3xl border border-slate-200/80 bg-white/85 p-5 shadow-panel backdrop-blur sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-sm font-bold text-white">AI</div>
            <h1 className="text-2xl font-semibold">Interview Summary</h1>
          </div>
          <Link
            href="/"
            onClick={resetSession}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-ink shadow-sm transition hover:border-teal-200 hover:text-teal-700"
          >
            Start a new session
          </Link>
        </header>

        {isLoading || !report ? (
          <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-8 text-slate-600">Generating your final hiring report...</div>
        ) : (
          <div className="mt-6 space-y-5">
            {(() => {
              const tone = OUTCOME_TONES[report.hiringOutcome];

              return (
                <section className="overflow-hidden rounded-3xl bg-ink p-8 text-white shadow-panel sm:p-10">
                  <div
                    className="grid gap-8 lg:grid-cols-[1fr_18rem] lg:items-center"
                    style={{
                      background: `radial-gradient(circle at 84% 40%, ${tone.soft}, transparent 34%)`
                    }}
                  >
                    <div>
                      <p className={`text-xs font-bold uppercase tracking-[0.22em] ${tone.text}`}>Hiring outcome</p>
                      <p className={`mt-5 text-6xl font-semibold tracking-tight ${tone.text}`}>{tone.label}</p>
                      <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-100">{report.emotionalSummary}</p>
                    </div>
                    <div className="hidden justify-self-center lg:block">
                      <div
                        className="grid h-44 w-44 place-items-center rounded-full border-[0.55rem] text-5xl font-semibold"
                        style={{ borderColor: tone.accent, color: tone.accent }}
                      >
                        {tone.symbol}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })()}

            <section className="rounded-3xl border border-slate-200 bg-white p-6">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">Score breakdown</p>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <ScoreCard label="Overall" value={report.overallScore} />
                <ScoreCard label="Clarity" value={report.clarity} />
                <ScoreCard label="Relevance" value={report.relevance} />
                <ScoreCard label="Confidence" value={report.confidence} />
                <ScoreCard label="Engagement" value={report.engagement} />
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-7">
              <div className="flex gap-5">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-50 text-sky-600">
                  <SummaryIcon name="message" />
                </div>
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">Interviewer notes</p>
                  <p className="mt-3 text-base leading-8 text-slate-700">{interviewerNotes}</p>
                </div>
              </div>
            </section>

            <div className="grid overflow-hidden rounded-3xl border border-slate-200 bg-white lg:grid-cols-2">
              <section className="p-6 sm:p-7">
                <h2 className="text-lg font-semibold text-ink">What you did well</h2>
                <div className="mt-6 space-y-7">
                  {report.strengths.map((item) => (
                    <ListItem key={item} item={item} tone="good" />
                  ))}
                </div>
              </section>

              <section className="border-t border-slate-200 p-6 sm:p-7 lg:border-l lg:border-t-0">
                <h2 className="text-lg font-semibold text-ink">What to improve</h2>
                <div className="mt-6 space-y-7">
                  {report.weaknesses.map((item) => (
                    <ListItem key={item} item={item} tone="improve" />
                  ))}
                </div>
              </section>
            </div>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-7">
              <button
                type="button"
                onClick={() => setMissedOpen((current) => !current)}
                className="flex w-full items-start justify-between gap-5 text-left"
                aria-expanded={missedOpen}
              >
                <div className="flex gap-5">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-700">
                    <SummaryIcon name="spark" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-ink">Missed opportunities</h2>
                    <p className="mt-2 max-w-5xl text-sm leading-7 text-slate-600">{report.missedOpportunitySummary}</p>
                  </div>
                </div>
                <span className="mt-1 inline-flex shrink-0 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700">
                  {missedOpen ? "Hide details" : "Expand details"}
                  <SummaryIcon name="chevron" className={`h-4 w-4 transition-transform ${missedOpen ? "rotate-180" : ""}`} />
                </span>
              </button>

              {missedOpen ? (
                <div className="mt-6 grid gap-5 border-t border-slate-200 pt-6 lg:grid-cols-2">
                  <div>
                    <h3 className="font-semibold text-ink">Best improved answer</h3>
                    <p className="mt-3 rounded-2xl bg-teal-50 px-4 py-4 text-sm leading-7 text-teal-950">{report.bestImprovedAnswer}</p>
                  </div>
                  <div>
                    <h3 className="font-semibold text-ink">Suggested improvements</h3>
                    <div className="mt-3 space-y-2">
                      {report.suggestedNextImprovements.map((item) => (
                        <div key={item} className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-7">
              <h2 className="text-xl font-semibold text-ink">Answer timeline</h2>
              <div className="mt-5 space-y-4">
                {session.turns.map((turn, index) => (
                  <article key={turn.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Question {index + 1}</p>
                    <p className="mt-2 font-semibold text-ink">{turn.question}</p>
                    <p className="mt-4 text-sm font-semibold text-slate-500">Answer</p>
                    <p className="mt-2 text-sm leading-7 text-slate-700">{turn.transcript}</p>
                    <p className="mt-4 text-sm font-semibold text-slate-500">Interviewer&apos;s thoughts</p>
                    <p className="mt-2 rounded-2xl bg-white px-4 py-3 text-sm leading-7 text-teal-900">{turn.evaluation.interviewerReaction}</p>
                  </article>
                ))}
              </div>
            </section>

            <footer className="border-t border-slate-200 py-8 text-center">
              <p className="text-lg font-semibold text-ink">Keep practicing!</p>
              <p className="mt-2 text-sm text-slate-500">Review the feedback, refine your approach, and try again.</p>
              <Link
                href="/"
                onClick={resetSession}
                className="mt-5 inline-flex rounded-2xl bg-teal-600 px-12 py-3 font-semibold text-white transition hover:bg-teal-700"
              >
                Start a new session
              </Link>
            </footer>
          </div>
        )}
      </div>
    </main>
  );
}
