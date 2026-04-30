"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FinalReport, FunnelOutcome } from "@/lib/interview-types";
import { useInterviewSession } from "@/lib/session-store";
import { ThemeToggle } from "@/components/theme-toggle";
import { TechSpecsButton } from "@/components/tech-specs-button";

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

const SCORE_INFO: Record<keyof typeof SCORE_COLORS, { headline: string; tips: string[] }> = {
  Overall: {
    headline: "Your combined interview performance across all dimensions.",
    tips: [
      "Strong overall scores come from answers that are specific, well-structured, and directly connected to the role.",
      "Consistency matters — a single excellent answer is less impactful than a steady pattern of confident, relevant responses.",
      "Think about each question as a chance to tell a short, persuasive story about your most relevant experience."
    ]
  },
  Clarity: {
    headline: "How easy your answers are to follow and understand.",
    tips: [
      "Use short, complete sentences rather than long, winding ones. Say one thing, then say the next.",
      "Avoid filler words like 'um', 'uh', 'like', and 'you know' — they create noise that obscures your message.",
      "If you need a moment to think, a brief pause sounds far more confident than verbal stalling.",
      "Lead with your point, then explain it. Don't build up to the conclusion — state it first."
    ]
  },
  Relevance: {
    headline: "How directly your answer addresses what the interviewer is looking for.",
    tips: [
      "Before answering, mentally connect the question to the specific role and what success looks like in it.",
      "Use language from the job description. If the role requires 'cross-functional collaboration', use that phrase when it's genuine.",
      "Irrelevant stories — even impressive ones — lower this score. Keep every example tied to the competency being tested.",
      "End answers by explicitly linking back to the role: 'That's why I think this experience maps well to what you're looking for here.'"
    ]
  },
  Confidence: {
    headline: "How composed, assured, and credible you come across.",
    tips: [
      "Speak at a measured pace — around 115 to 145 words per minute feels natural and authoritative. Too fast reads as nervous; too slow loses the room.",
      "Maintain eye contact with the camera rather than looking away when thinking. It signals you're engaged and certain.",
      "Avoid hedging language like 'I think maybe' or 'I guess' — replace them with direct statements.",
      "Posture and facial expression matter. A calm, upright position with a natural expression reads as confident even before you speak."
    ]
  },
  Engagement: {
    headline: "How present, interested, and invested you appear throughout the interview.",
    tips: [
      "Stay physically still and face-forward. Constant movement or looking around signals distraction.",
      "Show genuine reactions — a natural smile when appropriate, a thoughtful expression when listening.",
      "Don't let your energy drop between questions. Interviewers notice when candidates visibly disengage after an answer they're unsure about.",
      "Treat each question as equally important, even if you feel the last answer went well or poorly."
    ]
  }
};

function ScoreCard({ label, value, onInfo }: { label: keyof typeof SCORE_COLORS; value: number; onInfo: () => void }) {
  const color = SCORE_COLORS[label];
  const score = scoreToTen(value);

  return (
    <div className="relative rounded-2xl bg-slate-50 px-5 py-5 shadow-sm dark:bg-slate-800/70">
      <div className="flex items-start justify-between gap-1">
        <p className="flex-1 text-center text-sm font-semibold text-ink dark:text-white">{label}</p>
        <button
          type="button"
          onClick={onInfo}
          aria-label={`Learn what affects your ${label} score`}
          className="shrink-0 grid h-5 w-5 place-items-center rounded-full border border-slate-300 text-[10px] font-bold text-slate-400 transition hover:border-slate-400 hover:text-slate-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-400 dark:hover:text-slate-200"
        >
          i
        </button>
      </div>
      <div className="mt-4 flex items-center justify-center gap-4">
        <div
          className="grid h-16 w-16 shrink-0 place-items-center rounded-full"
          style={{ background: `conic-gradient(${color} ${value * 3.6}deg, var(--ring-track) 0deg)` }}
        >
          <div className="h-10 w-10 rounded-full bg-white dark:bg-slate-900" />
        </div>
        <div>
          <p className="text-3xl font-semibold text-ink dark:text-white">{score.toFixed(1)}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">/ 10</p>
        </div>
      </div>
      <p className="mt-4 text-center text-sm font-medium" style={{ color }}>
        {scoreLabel(value)}
      </p>
    </div>
  );
}

function ListItem({ item, description, tone }: { item: string; description: string; tone: "good" | "improve" }) {
  const isGood = tone === "good";

  return (
    <div className="flex gap-4">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${isGood ? "bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" : "bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300"}`}>
        <SummaryIcon name={isGood ? "check" : "trend"} />
      </div>
      <div>
        <p className="font-semibold text-ink dark:text-white">{item}</p>
        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const router = useRouter();
  const { session, resetSession } = useInterviewSession();
  const [report, setReport] = useState<FinalReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"feedback" | "opportunities" | "timeline">("feedback");
  const [activeInfo, setActiveInfo] = useState<keyof typeof SCORE_COLORS | null>(null);
  const infoPanelRef = useRef<HTMLDivElement | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

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

  useEffect(() => {
    if (!isLoading) {
      setLoadingProgress(100);
      return;
    }

    const timer = window.setInterval(() => {
      setLoadingProgress((current) => {
        if (current >= 88) return current;
        // Organic increments — fast at first, slows near the cap
        const increment = Math.random() * (current < 50 ? 10 : current < 75 ? 5 : 2) + 1;
        return Math.min(88, current + increment);
      });
    }, 350);

    return () => window.clearInterval(timer);
  }, [isLoading]);

  const LOADING_MESSAGES = [
    "Reviewing your answers…",
    "Analysing your confidence signals…",
    "Checking speaking pace and clarity…",
    "Building your hiring outcome…",
    "Identifying missed opportunities…",
    "Preparing your personalised feedback…"
  ];

  useEffect(() => {
    if (!isLoading) return;

    const timer = window.setInterval(() => {
      setLoadingMessageIndex((current) => (current + 1) % LOADING_MESSAGES.length);
    }, 2200);

    return () => window.clearInterval(timer);
  }, [isLoading, LOADING_MESSAGES.length]);

  const interviewerNotes = useMemo(() => report?.interviewerNotes.join(" ") ?? "", [report]);

  if (!session) {
    return null;
  }

  const startNewSession = () => {
    resetSession();
    router.push("/");
  };

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-6 dark:text-slate-100">
      <div className="relative z-0 mx-auto max-w-7xl rounded-3xl border border-slate-200/80 bg-white/85 p-5 shadow-panel backdrop-blur sm:p-6 dark:border-slate-700 dark:bg-slate-900/85">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-sm font-bold text-white dark:bg-white dark:text-ink">AI</div>
            <h1 className="text-xl font-semibold sm:text-2xl dark:text-white">Interview Summary</h1>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 lg:justify-end">
            <TechSpecsButton variant="header" />
            <button
              type="button"
              onClick={startNewSession}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition hover:border-teal-200 hover:text-teal-700 sm:px-5 sm:py-3 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:border-teal-400/40 dark:hover:text-teal-200"
            >
              Start a new session
            </button>
            <ThemeToggle />
          </div>
        </header>

        {isLoading || !report ? (
          <div className="mt-6 rounded-3xl border border-slate-200 bg-white px-8 py-10 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-lg font-semibold text-ink dark:text-white">Generating your interview report…</p>
            <p className="mt-1.5 h-5 text-sm text-slate-500 transition-opacity duration-500 dark:text-slate-400">
              {LOADING_MESSAGES[loadingMessageIndex]}
            </p>

            <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-teal-500 transition-[width] duration-500 ease-out dark:bg-teal-400"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {["Answers", "Confidence", "Clarity", "Relevance", "Engagement", "Outcome"].map((label, index) => {
                const filled = loadingProgress >= (index + 1) * 14;
                return (
                  <div
                    key={label}
                    className={`rounded-xl border px-3 py-2 text-center text-xs font-medium transition-colors duration-500 ${
                      filled
                        ? "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/40 dark:bg-teal-900/30 dark:text-teal-200"
                        : "border-slate-100 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
                    }`}
                  >
                    {label}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            {(() => {
              const tone = OUTCOME_TONES[report.hiringOutcome];

              return (
                <section className="overflow-hidden rounded-3xl bg-ink p-6 text-white shadow-panel sm:p-8 lg:p-10">
                  <div
                    className="grid gap-6 lg:grid-cols-[1fr_18rem] lg:items-center lg:gap-8"
                    style={{
                      background: `radial-gradient(circle at 84% 40%, ${tone.soft}, transparent 34%)`
                    }}
                  >
                    <div>
                      <div className="flex items-center gap-4 lg:block">
                        <div
                          className="grid h-16 w-16 shrink-0 place-items-center rounded-full border-4 text-2xl font-semibold lg:hidden"
                          style={{ borderColor: tone.accent, color: tone.accent }}
                          aria-hidden="true"
                        >
                          {tone.symbol}
                        </div>
                        <div>
                          <p className={`text-xs font-bold uppercase tracking-[0.22em] ${tone.text}`}>Hiring outcome</p>
                          <p className={`mt-2 text-4xl font-semibold tracking-tight sm:text-5xl lg:mt-5 lg:text-6xl ${tone.text}`}>{tone.label}</p>
                        </div>
                      </div>
                      <p className="mt-4 max-w-2xl text-base leading-7 text-slate-100 sm:text-lg sm:leading-8 lg:mt-5">{report.emotionalSummary}</p>
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

            <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-700 dark:bg-slate-900">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Score breakdown</p>
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {(["Overall", "Clarity", "Relevance", "Confidence", "Engagement"] as const).map((label) => (
                  <ScoreCard
                    key={label}
                    label={label}
                    value={label === "Overall" ? report.overallScore : report[label.toLowerCase() as keyof Pick<FinalReport, "clarity" | "relevance" | "confidence" | "engagement">]}
                    onInfo={() => {
                      setActiveInfo((current) => (current === label ? null : label));
                      setTimeout(() => infoPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
                    }}
                  />
                ))}
              </div>

              {activeInfo ? (
                <div
                  ref={infoPanelRef}
                  className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/70"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-ink dark:text-white">{activeInfo}</p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{SCORE_INFO[activeInfo].headline}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveInfo(null)}
                      aria-label="Close"
                      className="shrink-0 grid h-7 w-7 place-items-center rounded-full border border-slate-200 bg-white text-xs text-slate-400 transition hover:border-slate-300 hover:text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-400 dark:hover:text-slate-200"
                    >
                      ✕
                    </button>
                  </div>
                  <ul className="mt-4 space-y-2.5">
                    {SCORE_INFO[activeInfo].tips.map((tip) => (
                      <li key={tip} className="flex gap-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500" />
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-7 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex gap-5">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-50 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300">
                  <SummaryIcon name="message" />
                </div>
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Interviewer notes</p>
                  <p className="mt-3 text-base leading-8 text-slate-700 dark:text-slate-300">{interviewerNotes}</p>
                </div>
              </div>
            </section>

            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              {/* Tab bar */}
              <div className="flex overflow-x-auto border-b border-slate-200 dark:border-slate-700">
                {(
                  [
                    { id: "feedback",      label: "Feedback",            shortLabel: "Feedback" },
                    { id: "opportunities", label: "Missed Opportunities", shortLabel: "Opportunities" },
                    { id: "timeline",      label: "Answer Timeline",     shortLabel: "Timeline" }
                  ] as { id: typeof activeTab; label: string; shortLabel: string }[]
                ).map(({ id, label, shortLabel }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`flex-1 whitespace-nowrap px-3 py-4 text-sm font-semibold transition-colors sm:px-4 ${
                      activeTab === id
                        ? "border-b-2 border-teal-600 text-teal-700 dark:border-teal-400 dark:text-teal-300"
                        : "text-slate-500 hover:text-ink dark:text-slate-400 dark:hover:text-white"
                    }`}
                  >
                    <span className="sm:hidden">{shortLabel}</span>
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                ))}
              </div>

              {/* Feedback tab */}
              {activeTab === "feedback" ? (
                <div className="grid divide-y divide-slate-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0 dark:divide-slate-700">
                  <section className="p-6 sm:p-7">
                    <h2 className="text-lg font-semibold text-ink dark:text-white">What you did well</h2>
                    {report.strengths.length === 0 ? (
                      <p className="mt-6 text-sm leading-7 text-slate-500 dark:text-slate-400">
                        No feedback available — answer at least one question to generate strengths.
                      </p>
                    ) : (
                      <div className="mt-6 space-y-7">
                        {report.strengths.map((item, index) => (
                          <ListItem key={item} item={item} description={report.strengthDescriptions[index] ?? ""} tone="good" />
                        ))}
                      </div>
                    )}
                  </section>
                  <section className="p-6 sm:p-7">
                    <h2 className="text-lg font-semibold text-ink dark:text-white">What to improve</h2>
                    {report.weaknesses.length === 0 ? (
                      <p className="mt-6 text-sm leading-7 text-slate-500 dark:text-slate-400">
                        No feedback available — answer at least one question to generate areas to improve.
                      </p>
                    ) : (
                      <div className="mt-6 space-y-7">
                        {report.weaknesses.map((item, index) => (
                          <ListItem key={item} item={item} description={report.weaknessDescriptions[index] ?? ""} tone="improve" />
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              ) : null}

              {/* Missed opportunities tab */}
              {activeTab === "opportunities" ? (
                <div className="p-6 sm:p-7">
                  <div className="flex gap-4">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                      <SummaryIcon name="spark" />
                    </div>
                    <p className="text-sm leading-7 text-slate-600 self-center dark:text-slate-300">{report.missedOpportunitySummary}</p>
                  </div>
                  <div className="mt-6 grid gap-5 border-t border-slate-200 pt-6 lg:grid-cols-2 dark:border-slate-700">
                    <div>
                      <h3 className="font-semibold text-ink dark:text-white">Best improved answer</h3>
                      <p className="mt-3 rounded-2xl bg-teal-50 px-4 py-4 text-sm leading-7 text-teal-950 dark:bg-teal-900/30 dark:text-teal-100">{report.bestImprovedAnswer}</p>
                    </div>
                    <div>
                      <h3 className="font-semibold text-ink dark:text-white">Suggested improvements</h3>
                      <div className="mt-3 space-y-2">
                        {report.suggestedNextImprovements.map((item) => (
                          <div key={item} className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950 dark:bg-amber-900/30 dark:text-amber-100">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Answer timeline tab */}
              {activeTab === "timeline" ? (
                <div className="p-6 sm:p-7">
                  {session.turns.length === 0 ? (
                    <p className="text-sm leading-7 text-slate-500 dark:text-slate-400">
                      No answers were recorded in this session.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {session.turns.map((turn, index) => (
                        <article key={turn.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/70">
                          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Question {index + 1}</p>
                          <p className="mt-2 font-semibold text-ink dark:text-white">{turn.question}</p>
                          <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Answer</p>
                          <p className="mt-2 text-sm leading-7 text-slate-700 dark:text-slate-300">{turn.transcript}</p>
                          <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Interviewer&apos;s thoughts</p>
                          <p className="mt-2 rounded-2xl bg-white px-4 py-3 text-sm leading-7 text-teal-900 dark:bg-slate-900 dark:text-teal-200">{turn.evaluation.interviewerReaction}</p>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <footer className="border-t border-slate-200 py-8 text-center dark:border-slate-700">
              <p className="text-lg font-semibold text-ink dark:text-white">Keep practicing!</p>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Review the feedback, refine your approach, and try again.</p>
              <button
                type="button"
                onClick={startNewSession}
                className="mt-5 inline-flex rounded-2xl bg-teal-600 px-12 py-3 font-semibold text-white transition hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-400"
              >
                Start a new session
              </button>
            </footer>
          </div>
        )}
      </div>
    </main>
  );
}
