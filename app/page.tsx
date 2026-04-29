"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buildSafeResumePreview } from "@/lib/interview-scoring";
import { loadMediaDevicePreferences, saveMediaDevicePreferences } from "@/lib/media-device-preferences";
import { JOB_ROLES, SAMPLE_RESUME } from "@/lib/sample-data";
import { InterviewDifficulty, InterviewSession, ResumeMode } from "@/lib/interview-types";
import { useInterviewSession } from "@/lib/session-store";

export default function LandingPage() {
  const router = useRouter();
  const { setSession } = useInterviewSession();
  const [selectedRole, setSelectedRole] = useState("Software Engineer");
  const [customRole, setCustomRole] = useState("");
  const [difficulty, setDifficulty] = useState<InterviewDifficulty>("Medium");
  const [resumeMode, setResumeMode] = useState<ResumeMode>("Use Sample Resume");
  const [isStarting, setIsStarting] = useState(false);
  const [isCheckingMedia, setIsCheckingMedia] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [showDeviceDialog, setShowDeviceDialog] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState("");
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState("");
  const sampleResume = buildSafeResumePreview(SAMPLE_RESUME);

  const getNormalizedRole = () => {
    const role = selectedRole === "Other" ? customRole : selectedRole;
    return role.trim();
  };

  const stopMediaStream = (stream: MediaStream) => {
    stream.getTracks().forEach((track) => track.stop());
  };

  const refreshMediaDevices = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices.filter((device) => device.kind === "audioinput");
    const cameras = devices.filter((device) => device.kind === "videoinput");
    const savedPreferences = loadMediaDevicePreferences();

    setAudioDevices(microphones);
    setVideoDevices(cameras);
    setSelectedAudioDeviceId(
      microphones.find((device) => device.deviceId === savedPreferences?.audioInputId)?.deviceId ?? microphones[0]?.deviceId ?? ""
    );
    setSelectedVideoDeviceId(
      cameras.find((device) => device.deviceId === savedPreferences?.videoInputId)?.deviceId ?? cameras[0]?.deviceId ?? ""
    );

    return { microphones, cameras };
  };

  const openDeviceDialog = async () => {
    const normalizedRole = getNormalizedRole();
    if (!normalizedRole) {
      setStartError("Enter a job role before starting.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.enumerateDevices) {
      setStartError("This browser cannot access camera and microphone devices.");
      return;
    }

    setIsCheckingMedia(true);
    setStartError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      });
      stopMediaStream(stream);

      const { microphones, cameras } = await refreshMediaDevices();
      if (microphones.length === 0 || cameras.length === 0) {
        throw new Error("A microphone and camera are required to start the interview.");
      }

      setShowDeviceDialog(true);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Allow camera and microphone access to start the interview.");
    } finally {
      setIsCheckingMedia(false);
    }
  };

  const startInterview = async () => {
    const normalizedRole = getNormalizedRole();
    if (!normalizedRole) {
      setStartError("Enter a job role before starting.");
      return;
    }

    setIsStarting(true);
    setStartError(null);

    try {
      const response = await fetch("/api/interview/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ role: normalizedRole, difficulty, resumeMode })
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error ?? "Could not start the interview.");
      }

      const data = (await response.json()) as { session: InterviewSession };
      setSession(data.session);
      router.push("/interview");
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Could not start the interview.");
    } finally {
      setIsStarting(false);
    }
  };

  const confirmDevicesAndStart = async () => {
    if (!selectedAudioDeviceId || !selectedVideoDeviceId) {
      setStartError("Choose a microphone and camera before starting.");
      return;
    }

    setIsStarting(true);
    setStartError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: selectedAudioDeviceId } },
        video: {
          deviceId: { exact: selectedVideoDeviceId },
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      });
      stopMediaStream(stream);
      saveMediaDevicePreferences({
        audioInputId: selectedAudioDeviceId,
        videoInputId: selectedVideoDeviceId
      });
      setShowDeviceDialog(false);
      await startInterview();
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Could not access the selected microphone and camera.");
      setIsStarting(false);
    }
  };

  const startButtonLabel = isStarting ? "Preparing..." : isCheckingMedia ? "Checking devices..." : "Start interview";

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
              void openDeviceDialog();
            }}
          >
            <label className="block text-sm font-medium text-slate-700">
              Job role
              <select
                value={selectedRole}
                onChange={(event) => {
                  setSelectedRole(event.target.value);
                  setStartError(null);
                }}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-teal-400"
              >
                {JOB_ROLES.map((jobRole) => (
                  <option key={jobRole} value={jobRole}>
                    {jobRole}
                  </option>
                ))}
              </select>
            </label>

            {selectedRole === "Other" ? (
              <label className="block text-sm font-medium text-slate-700">
                Custom job role
                <input
                  value={customRole}
                  onChange={(event) => {
                    setCustomRole(event.target.value);
                    setStartError(null);
                  }}
                  placeholder="Example: Healthcare Data Scientist"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-teal-400"
                />
              </label>
            ) : null}

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-slate-700">Question difficulty</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {(["Easy", "Medium", "Hard"] as InterviewDifficulty[]).map((option) => (
                  <label
                    key={option}
                    className={`cursor-pointer rounded-2xl border px-4 py-3 text-center text-sm font-semibold transition ${
                      difficulty === option
                        ? "border-teal-500 bg-teal-50 text-teal-800"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <input
                      checked={difficulty === option}
                      onChange={() => setDifficulty(option)}
                      type="radio"
                      name="difficulty"
                      className="sr-only"
                    />
                    {option}
                  </label>
                ))}
              </div>
            </fieldset>

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

            {startError ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900">{startError}</p> : null}

            <button
              type="submit"
              disabled={isStarting || isCheckingMedia}
              className="w-full rounded-2xl bg-ink px-5 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {startButtonLabel}
            </button>
          </form>

          <p className="mt-4 text-xs text-slate-500">
            Live OpenAI responses run through the server using <code>OPENAI_API_KEY</code> from local environment configuration.
          </p>
        </div>
      </section>

      {showDeviceDialog ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-panel">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-ink">Choose interview devices</h2>
                <p className="mt-2 text-sm text-slate-600">Camera and microphone access is ready.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowDeviceDialog(false)}
                className="grid h-9 w-9 place-items-center rounded-full text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-ink"
                aria-label="Close device selection"
              >
                x
              </button>
            </div>

            <div className="mt-6 space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Microphone
                <select
                  value={selectedAudioDeviceId}
                  onChange={(event) => setSelectedAudioDeviceId(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-teal-400"
                >
                  {audioDevices.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `Microphone ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Camera
                <select
                  value={selectedVideoDeviceId}
                  onChange={(event) => setSelectedVideoDeviceId(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-teal-400"
                >
                  {videoDevices.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {startError ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900">{startError}</p> : null}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowDeviceDialog(false)}
                className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDevicesAndStart()}
                disabled={isStarting}
                className="rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isStarting ? "Preparing..." : "Use these devices"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
