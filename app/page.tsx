"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadMediaDevicePreferences, markMediaPermissionGranted, saveMediaDevicePreferences } from "@/lib/media-device-preferences";
import { InterviewDifficulty, InterviewSession, ResumeMode } from "@/lib/interview-types";
import { useInterviewSession } from "@/lib/session-store";

const LANDING_JOB_ROLES = ["Software Developer", "Registered Nurse", "Financial Analyst", "Marketing Manager", "Other"];
const PREPARATION_DURATION_MS = 5000;
const PREPARATION_STEPS = [
  "Selecting your interviewer",
  "Personalizing the interview questions",
  "Calibrating your practice room",
  "Preparing live feedback",
  "Opening the interview room"
];

export default function LandingPage() {
  const router = useRouter();
  const { setSession } = useInterviewSession();
  const [selectedRole, setSelectedRole] = useState("Software Developer");
  const [customRole, setCustomRole] = useState("");
  const [difficulty, setDifficulty] = useState<InterviewDifficulty>("Medium");
  const [resumeMode, setResumeMode] = useState<ResumeMode>("Skip Resume");
  const [uploadedResumeName, setUploadedResumeName] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [isCheckingMedia, setIsCheckingMedia] = useState(false);
  const [showPreparationOverlay, setShowPreparationOverlay] = useState(false);
  const [preparationProgress, setPreparationProgress] = useState(0);
  const [preparationStepIndex, setPreparationStepIndex] = useState(0);
  const [startError, setStartError] = useState<string | null>(null);
  const [showDeviceDialog, setShowDeviceDialog] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState("");
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState("");

  const getNormalizedRole = () => {
    const role = selectedRole === "Other" ? customRole : selectedRole;
    return role.trim();
  };

  useEffect(() => {
    if (!showPreparationOverlay) {
      setPreparationProgress(0);
      setPreparationStepIndex(0);
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const progress = Math.min(100, Math.round(((Date.now() - startedAt) / PREPARATION_DURATION_MS) * 100));
      const stepIndex = Math.min(
        PREPARATION_STEPS.length - 1,
        Math.floor((progress / 100) * PREPARATION_STEPS.length)
      );

      setPreparationProgress(progress);
      setPreparationStepIndex(stepIndex);

      if (progress >= 100) {
        window.clearInterval(timer);
      }
    }, 100);

    return () => {
      window.clearInterval(timer);
    };
  }, [showPreparationOverlay]);

  const stopMediaStream = (stream: MediaStream) => {
    stream.getTracks().forEach((track) => track.stop());
  };

  const isPermissionGranted = async (name: "camera" | "microphone") => {
    if (!("permissions" in navigator) || !navigator.permissions?.query) {
      return null;
    }

    try {
      const status = await navigator.permissions.query({ name: name as PermissionName });
      return status.state === "granted";
    } catch {
      return null;
    }
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

  const canReuseSavedDeviceSelection = async () => {
    const savedPreferences = loadMediaDevicePreferences();
    if (!savedPreferences?.audioInputId || !savedPreferences?.videoInputId || !savedPreferences.mediaPermissionGranted) {
      return null;
    }

    const cameraGranted = await isPermissionGranted("camera");
    const microphoneGranted = await isPermissionGranted("microphone");
    const permissionsBlocked = cameraGranted === false || microphoneGranted === false;
    if (permissionsBlocked) {
      return null;
    }

    const { microphones, cameras } = await refreshMediaDevices();
    const savedMicrophoneAvailable = microphones.some((device) => device.deviceId === savedPreferences.audioInputId);
    const savedCameraAvailable = cameras.some((device) => device.deviceId === savedPreferences.videoInputId);

    if (!savedMicrophoneAvailable || !savedCameraAvailable) {
      return null;
    }

    return savedPreferences;
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
      const reusablePreferences = await canReuseSavedDeviceSelection();
      if (reusablePreferences) {
        setSelectedAudioDeviceId(reusablePreferences.audioInputId);
        setSelectedVideoDeviceId(reusablePreferences.videoInputId);
        await startInterview();
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      });
      stopMediaStream(stream);
      markMediaPermissionGranted();

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
    setShowPreparationOverlay(true);
    setStartError(null);

    // Start the minimum display timer immediately so it runs in parallel with the API call.
    // Navigation only happens once BOTH the bar animation (PREPARATION_DURATION_MS) AND
    // the API have finished — whichever takes longer.
    const minDisplayPromise = new Promise<void>((resolve) =>
      window.setTimeout(resolve, PREPARATION_DURATION_MS)
    );

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

      // If the API responded before the bar finished, wait for the remainder.
      // If the bar already hit 100%, this resolves immediately.
      await minDisplayPromise;

      setSession(data.session);
      router.push("/interview");
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Could not start the interview.");
    } finally {
      setIsStarting(false);
      setShowPreparationOverlay(false);
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
        videoInputId: selectedVideoDeviceId,
        mediaPermissionGranted: true
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
                {LANDING_JOB_ROLES.map((jobRole) => (
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
              <label
                className={`block cursor-pointer rounded-2xl border px-4 py-4 transition ${
                  uploadedResumeName ? "border-teal-500 bg-teal-50" : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    setUploadedResumeName(file?.name ?? "");
                    setResumeMode("Skip Resume");
                    setStartError(null);
                  }}
                />
                <span className="flex items-start justify-between gap-4">
                  <span>
                    <span className="block font-medium text-ink">Upload resume</span>
                    <span className="mt-1 block text-sm text-slate-500">
                      {uploadedResumeName || "Add your own resume for a more personalized interview later."}
                    </span>
                  </span>
                  <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-700">Recommended</span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 px-4 py-4">
                <input
                  checked={resumeMode === "Skip Resume" && !uploadedResumeName}
                  onChange={() => {
                    setUploadedResumeName("");
                    setResumeMode("Skip Resume");
                  }}
                  type="radio"
                  name="resumeMode"
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium text-ink">Skip resume</span>
                  <span className="mt-1 block text-sm text-slate-500">Run the interview without resume context.</span>
                </span>
              </label>
            </fieldset>

            {startError ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900">{startError}</p> : null}

            <button
              type="submit"
              disabled={isStarting || isCheckingMedia}
              className="w-full rounded-2xl bg-ink px-5 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {startButtonLabel}
            </button>
          </form>

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

      {showPreparationOverlay ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/55 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-panel">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-700">Preparing interview</p>
            <h2 className="mt-4 text-2xl font-semibold text-ink">{PREPARATION_STEPS[preparationStepIndex]}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Your interview environment is being generated in the background.
            </p>

            <div className="mt-7 h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-teal-600 transition-[width] duration-150 ease-out"
                style={{ width: `${preparationProgress}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>{preparationProgress}%</span>
              <span>{preparationStepIndex + 1} of {PREPARATION_STEPS.length}</span>
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
