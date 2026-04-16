"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { JOB_ROLES, SAMPLE_RESUME } from "@/lib/sample-data";
import { InterviewSession, JobRole, ResumeMode } from "@/lib/interview-types";
import { useInterviewSession } from "@/lib/session-store";

export default function LandingPage() {
  const router = useRouter();
  const { setSession } = useInterviewSession();
  const [role, setRole] = useState<JobRole>("Software Engineer");
  const [resumeMode, setResumeMode] = useState<ResumeMode>("Use Sample Resume");
  const [isStarting, setIsStarting] = useState(false);

  const startInterview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsStarting(true);

    const response = await fetch("/api/interview/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ role, resumeMode })
    });

    const data = (await response.json()) as { session: InterviewSession };
    setSession(data.session);
    router.push("/interview");
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col justify-center px-6 py-16">
      <section className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="inline-flex rounded-full bg-teal-100 px-4 py-2 text-sm font-semibold text-teal-800">
            AI Interview Simulator
          </p>
          <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-tight tracking-tight text-ink md:text-6xl">
            Practice high-stakes interviews with live AI coaching on what you said and what you missed.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-slate-600">
            Simulate a realistic interview, get speech and engagement insights in real time, and leave with role-specific improvement guidance.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              "Dynamic AI questions",
              "Live transcript and webcam tracking",
              "Missed opportunity detection after every answer"
            ].map((item) => (
              <div key={item} className="panel p-4 text-sm text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-8">
          <h2 className="text-2xl font-semibold text-ink">Start your interview</h2>
          <form className="mt-6 space-y-5" onSubmit={startInterview}>
            <label className="block text-sm font-medium text-slate-700">
              Job role
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as JobRole)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none ring-0 transition focus:border-teal-400"
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
                        ? "Use Alex Johnson's built-in resume to power missed opportunity detection."
                        : "Run the interview without resume context."}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="rounded-3xl bg-slate-50 p-4 text-sm text-slate-600">
              <p className="font-semibold text-ink">Sample resume preview</p>
              <p className="mt-2">{SAMPLE_RESUME.name}</p>
              <p>{SAMPLE_RESUME.role}</p>
              <p className="mt-2">{SAMPLE_RESUME.skills.join(" / ")}</p>
            </div>

            <button
              type="submit"
              disabled={isStarting}
              className="w-full rounded-2xl bg-ink px-5 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isStarting ? "Preparing interview..." : "Start interview"}
            </button>
          </form>

          <p className="mt-4 text-xs text-slate-500">
            For AI-powered evaluations, set <code>OPENAI_API_KEY</code>. The app still runs locally with a built-in fallback engine.
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
