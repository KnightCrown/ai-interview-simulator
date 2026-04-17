"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buildSafeResumePreview } from "@/lib/interview-scoring";
import { JOB_ROLES, SAMPLE_RESUME } from "@/lib/sample-data";
import { InterviewSession, JobRole, ResumeMode } from "@/lib/interview-types";
import { useInterviewSession } from "@/lib/session-store";

export default function LandingPage() {
  const router = useRouter();
  const { setSession } = useInterviewSession();
  const [role, setRole] = useState<JobRole>("Software Engineer");
  const [resumeMode, setResumeMode] = useState<ResumeMode>("Use Sample Resume");
  const [isStarting, setIsStarting] = useState(false);
  const sampleResume = buildSafeResumePreview(SAMPLE_RESUME);

  const startInterview = async (demoMode = false) => {
    setIsStarting(true);

    const response = await fetch("/api/interview/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ role, resumeMode, demoMode })
    });

    const data = (await response.json()) as { session: InterviewSession };
    setSession(data.session);
    router.push("/interview");
  };

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-12">
      <section className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="relative overflow-hidden rounded-[2rem] bg-ink px-8 py-10 text-white shadow-panel">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.22),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(251,146,60,0.22),transparent_26%)]" />
          <div className="relative">
            <p className="inline-flex rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-teal-100 backdrop-blur">
              AI Interview Simulator
            </p>
            <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-tight tracking-tight md:text-6xl">
              A hiring simulator that feels like you are in the room with a real interviewer.
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-slate-200">
              Practice under pressure, watch your confidence shift live, and get recruiter-style feedback on how you came across.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                "Persistent interviewer memory",
                "Live confidence and hiring funnel pressure",
                "Replay, rewrite, and missed opportunity analysis"
              ].map((item) => (
                <div key={item} className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-slate-100 backdrop-blur">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel p-8">
          <h2 className="text-2xl font-semibold text-ink">Start your interview</h2>
          <form
            className="mt-6 space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void startInterview(false);
            }}
          >
            <label className="block text-sm font-medium text-slate-700">
              Job role
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as JobRole)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-teal-400"
              >
                {JOB_ROLES.map((jobRole) => (
                  <option key={jobRole} value={jobRole}>
                    {jobRole}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-slate-700">Resume option</legend>
              {(["Use Sample Resume", "Skip Resume"] as ResumeMode[]).map((option) => (
                <label key={option} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 px-4 py-4">
                  <input
                    checked={resumeMode === option}
                    onChange={() => setResumeMode(option)}
                    type="radio"
                    name="resumeMode"
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium text-ink">{option}</span>
                    <span className="mt-1 block text-sm text-slate-500">
                      {option === "Use Sample Resume"
                        ? "Use Alex Johnson's built-in resume to power aggressive resume-aware feedback."
                        : "Run the interview without resume context."}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="rounded-3xl bg-slate-50 p-4 text-sm text-slate-600">
              <p className="font-semibold text-ink">Sample resume preview</p>
              <p className="mt-2">{sampleResume.name}</p>
              <p>{sampleResume.role}</p>
              <p className="mt-2">{sampleResume.skills.join(" / ")}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="submit"
                disabled={isStarting}
                className="rounded-2xl bg-ink px-5 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isStarting ? "Preparing..." : "Start interview"}
              </button>
              <button
                type="button"
                disabled={isStarting}
                onClick={() => void startInterview(true)}
                className="rounded-2xl bg-teal-600 px-5 py-3 text-base font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Demo mode
              </button>
            </div>
          </form>

          <p className="mt-4 text-xs text-slate-500">
            Sensitive values are not hardcoded. Add <code>OPENAI_API_KEY</code> in a local env file such as <code>.env.local</code> if you want live OpenAI responses.
          </p>
        </div>
      </section>

      <div className="mt-8 text-sm text-slate-500">
        Looking for the final report later? Visit{" "}
        <Link href="/results" className="font-semibold text-teal-700">
          results
        </Link>{" "}
        after a session.
      </div>
    </main>
  );
}
