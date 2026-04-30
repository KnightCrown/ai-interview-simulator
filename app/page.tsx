"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { loadMediaDevicePreferences, markMediaPermissionGranted, saveMediaDevicePreferences } from "@/lib/media-device-preferences";
import { InterviewDifficulty, InterviewSession, ResumeMode } from "@/lib/interview-types";
import { useInterviewSession } from "@/lib/session-store";
import { ThemeToggle } from "@/components/theme-toggle";
import { TechSpecsButton } from "@/components/tech-specs-button";

const GITHUB_URL = "https://github.com/KnightCrown/ai-interview-simulator";

const LANDING_JOB_ROLES = ["Software Developer", "Registered Nurse", "Financial Analyst", "Marketing Manager", "Other"];
const PREPARATION_DURATION_MS = 5000;
const PREPARATION_STEPS = [
  "Selecting your interviewer",
  "Personalizing the interview questions",
  "Calibrating your practice room",
  "Preparing live feedback",
  "Opening the interview room"
];

const DEMO_QUESTIONS: { caption: string; body: string }[] = [
  {
    caption: "Can you describe a time when you had to debug a complex production issue?",
    body: "Can you describe a situation where you had to debug a complex production issue involving multiple system components? How did you identify the root cause and what steps did you take to resolve it?"
  },
  {
    caption: "Walk me through a tradeoff between speed and quality on a project.",
    body: "Walk me through a time you had to make a difficult tradeoff between shipping speed and engineering quality. What did you choose, and what was the outcome?"
  },
  {
    caption: "Tell me about a moment you disagreed with a teammate.",
    body: "Tell me about a moment you disagreed with a teammate on a technical decision. How did you work through it without losing momentum on the project?"
  }
];

const DEMO_THOUGHTS = [
  "Strong start. Your example is relevant and shows good problem-solving. Consider adding more detail on the impact and how you prevented it from happening again.",
  "Nice STAR-style structure. The metrics you mentioned are landing well. Keep the pace steady and you are set."
];

const FEATURES_LIST = [
  "Adaptive AI interviewers that respond to your answers",
  "Live confidence, speaking pace, and filler-word tracking",
  "Eye-contact and engagement scoring from your camera",
  "Replay, rewrite, and missed-opportunity coaching",
  "Resume-aware questions tailored to your role"
];

const HOW_IT_WORKS = [
  { title: "Pick your role", body: "Choose a job role and difficulty, optionally upload your resume for tailored questions." },
  { title: "Talk to the AI interviewer", body: "Speak with a realistic interviewer that adapts and reacts to your answers in real time." },
  { title: "Get live coaching", body: "Confidence, pace, fillers, and engagement update on screen as you speak." },
  { title: "Review your scored report", body: "Replay the session, rewrite weak answers, and track how you improve over time." }
];

const FEATURE_TILES: { title: string; body: string; tone: "teal" | "indigo" | "amber" | "violet"; icon: "brain" | "chart" | "replay" | "badge" }[] = [
  { title: "AI interviewers", body: "Realistic, adaptive conversations.", tone: "teal", icon: "brain" },
  { title: "Real-time feedback", body: "Instant insights to improve as you speak.", tone: "indigo", icon: "chart" },
  { title: "Review & improve", body: "Replay, rewrite, and track your progress.", tone: "amber", icon: "replay" },
  { title: "Role specific", body: "Tailored questions for your target role.", tone: "violet", icon: "badge" }
];

type PopoverId = "how" | "features" | "pricing";

function ConfidenceRing({ value }: { value: number }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <div className="relative h-[88px] w-[88px]">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={radius} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="9" fill="none" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          className="stroke-teal-700 dark:stroke-teal-400 transition-[stroke-dashoffset] duration-700 ease-out"
          strokeWidth="9"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold leading-none text-ink dark:text-white">{clamped}</span>
        <span className="mt-0.5 text-[10px] font-medium text-slate-400 dark:text-slate-500">/100</span>
      </div>
    </div>
  );
}

function WaveformBars() {
  const bars = Array.from({ length: 28 }, (_, i) => i);
  return (
    <div className="flex h-6 flex-1 items-center gap-[3px]">
      {bars.map((i) => (
        <span
          key={i}
          className="inline-block w-[3px] rounded-full bg-teal-500/70"
          style={{
            animation: "landing-wave 1.1s ease-in-out infinite",
            animationDelay: `${(i % 14) * 60}ms`,
            transformOrigin: "center"
          }}
        />
      ))}
    </div>
  );
}

function FeatureIcon({ kind, tone }: { kind: "brain" | "chart" | "replay" | "badge"; tone: "teal" | "indigo" | "amber" | "violet" }) {
  const toneClasses: Record<typeof tone, string> = {
    teal: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
    indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
  };
  return (
    <span className={`grid h-10 w-10 place-items-center rounded-full ${toneClasses[tone]}`} aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {kind === "brain" ? (
          <>
            <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 1 5 3 3 0 0 0 4 3 3 3 0 0 0 3-3V4z" />
            <path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-1 5 3 3 0 0 1-4 3 3 3 0 0 1-3-3V4z" />
          </>
        ) : null}
        {kind === "chart" ? (
          <>
            <path d="M3 3v18h18" />
            <path d="M7 14v4" />
            <path d="M12 9v9" />
            <path d="M17 5v13" />
          </>
        ) : null}
        {kind === "replay" ? (
          <>
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <polygon points="10 9 15 12 10 15 10 9" fill="currentColor" stroke="none" />
          </>
        ) : null}
        {kind === "badge" ? (
          <>
            <rect x="3" y="6" width="18" height="14" rx="2" />
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
            <path d="M3 12h18" />
          </>
        ) : null}
      </svg>
    </span>
  );
}

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

  const [showSetupModal, setShowSetupModal] = useState(false);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const roleDropdownRef = useRef<HTMLDivElement>(null);
  const [openPopover, setOpenPopover] = useState<PopoverId | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [demoLightboxOpen, setDemoLightboxOpen] = useState(false);
  const [demoQuestionIndex, setDemoQuestionIndex] = useState(0);
  const [demoConfidence, setDemoConfidence] = useState(62);
  const [demoThoughtIndex, setDemoThoughtIndex] = useState(0);
  const [demoTimeSeconds, setDemoTimeSeconds] = useState(165);

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

  useEffect(() => {
    const questionTimer = window.setInterval(() => {
      setDemoQuestionIndex((index) => (index + 1) % DEMO_QUESTIONS.length);
    }, 6500);
    const confidenceTimer = window.setInterval(() => {
      setDemoConfidence(58 + Math.round(Math.random() * 8));
    }, 1800);
    const thoughtTimer = window.setInterval(() => {
      setDemoThoughtIndex((index) => (index + 1) % DEMO_THOUGHTS.length);
    }, 8000);
    const clockTimer = window.setInterval(() => {
      setDemoTimeSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => {
      window.clearInterval(questionTimer);
      window.clearInterval(confidenceTimer);
      window.clearInterval(thoughtTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenPopover(null);
      setRoleDropdownOpen(false);
      setMobileMenuOpen(false);
      setDemoLightboxOpen(false);
      if (!showDeviceDialog && !showPreparationOverlay) {
        setShowSetupModal(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showDeviceDialog, showPreparationOverlay]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(event.target as Node)) {
        setRoleDropdownOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

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
        setShowSetupModal(false);
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

      setShowSetupModal(false);
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

  const openSetupModal = () => {
    setOpenPopover(null);
    setStartError(null);
    setShowSetupModal(true);
  };

  const togglePopover = (id: PopoverId) => {
    setOpenPopover((current) => (current === id ? null : id));
  };

  const formattedDemoTime = (() => {
    const minutes = Math.floor(demoTimeSeconds / 60);
    const seconds = demoTimeSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  })();

  const currentDemoQuestion = DEMO_QUESTIONS[demoQuestionIndex];
  const currentDemoThought = DEMO_THOUGHTS[demoThoughtIndex];

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 pb-16">
      <style>{`
        @keyframes landing-wave {
          0%, 100% { transform: scaleY(0.32); }
          50% { transform: scaleY(1); }
        }
        @keyframes landing-fade-in {
          0% { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .landing-fade { animation: landing-fade-in 600ms ease-out both; }
      `}</style>

      <header className="relative z-30 flex items-center justify-between py-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-sm font-bold tracking-tight text-white dark:bg-white dark:text-ink">AI</span>
          <span className="text-base font-semibold text-ink dark:text-white">Interview Simulator</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          <NavButton id="how" label="How it works" active={openPopover === "how"} onClick={togglePopover} />
          <NavButton id="features" label="Features" active={openPopover === "features"} onClick={togglePopover} />
          <NavButton id="pricing" label="Pricing" active={openPopover === "pricing"} onClick={togglePopover} />
          <TechSpecsButton variant="nav" />
        </div>

        {openPopover ? (
          <div
            className="fixed inset-0 z-40 grid place-items-center bg-ink/45 px-4 backdrop-blur-sm dark:bg-black/65"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpenPopover(null);
            }}
          >
            <div className="landing-fade relative w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-panel dark:border-slate-700 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setOpenPopover(null)}
                className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-ink dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label="Close menu"
              >
                x
              </button>

              {openPopover === "how" ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-700 dark:text-teal-300">How it works</p>
                  <h3 className="mt-2 text-xl font-semibold text-ink dark:text-white">Practice in four short steps</h3>
                  <ol className="mt-4 space-y-3">
                    {HOW_IT_WORKS.map((step, index) => (
                      <li key={step.title} className="flex gap-3">
                        <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-teal-100 text-xs font-semibold text-teal-800 dark:bg-teal-900/60 dark:text-teal-200">{index + 1}</span>
                        <span className="text-sm text-slate-700 dark:text-slate-300">
                          <span className="font-semibold text-ink dark:text-white">{step.title}.</span> {step.body}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}

              {openPopover === "features" ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-700 dark:text-teal-300">Features</p>
                  <h3 className="mt-2 text-xl font-semibold text-ink dark:text-white">Everything in one practice room</h3>
                  <ul className="mt-4 space-y-2 text-sm text-slate-700 dark:text-slate-300">
                    {FEATURES_LIST.map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <span aria-hidden="true" className="mt-1 inline-block h-1.5 w-1.5 flex-none rounded-full bg-teal-600 dark:bg-teal-400" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {openPopover === "pricing" ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-700 dark:text-teal-300">Pricing</p>
                  <h3 className="mt-2 text-xl font-semibold text-ink dark:text-white">Free for everyone</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-300">
                    This is an open hackathon project. There are no accounts, no payments, and no credit cards required. Open the
                    page, pick a role, and start practicing right away.
                  </p>
                </div>
              ) : null}

            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2 md:gap-3">
          <button
            type="button"
            onClick={openSetupModal}
            className="hidden rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 md:inline-flex dark:bg-teal-500 dark:text-white dark:hover:bg-teal-400"
          >
            Start your first interview
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileMenuOpen}
            className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-ink transition hover:border-slate-300 hover:bg-slate-50 md:hidden dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:border-slate-600 dark:hover:bg-slate-700"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <ThemeToggle />
        </div>
      </header>

      {mobileMenuOpen ? (
        <div
          className="fixed inset-0 z-50 bg-ink/45 backdrop-blur-sm md:hidden dark:bg-black/65"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMobileMenuOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Main menu"
        >
          <aside className="absolute right-0 top-0 flex h-full w-72 max-w-[85vw] flex-col gap-1 border-l border-slate-200 bg-white p-5 shadow-panel dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between pb-3">
              <span className="text-base font-semibold text-ink dark:text-white">Menu</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
                className="grid h-9 w-9 place-items-center rounded-full text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-ink dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                x
              </button>
            </div>
            <button
              type="button"
              onClick={() => { setMobileMenuOpen(false); setOpenPopover("how"); }}
              className="rounded-xl px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-ink dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              How it works
            </button>
            <button
              type="button"
              onClick={() => { setMobileMenuOpen(false); setOpenPopover("features"); }}
              className="rounded-xl px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-ink dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Features
            </button>
            <button
              type="button"
              onClick={() => { setMobileMenuOpen(false); setOpenPopover("pricing"); }}
              className="rounded-xl px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-ink dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Pricing
            </button>
            <div className="px-1 py-1">
              <TechSpecsButton variant="nav" />
            </div>
            <button
              type="button"
              onClick={() => { setMobileMenuOpen(false); openSetupModal(); }}
              className="mt-3 rounded-full bg-ink px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-teal-500 dark:hover:bg-teal-400"
            >
              Start your first interview
            </button>
          </aside>
        </div>
      ) : null}

      <section className="mt-10 text-center">
        <h1 className="mx-auto max-w-4xl text-4xl font-semibold leading-tight tracking-tight text-ink md:text-5xl lg:text-6xl dark:text-white">
          Practice real interviews.
          <br />
          Get real feedback. <span className="text-accent dark:text-teal-300">Land the job.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-slate-500 md:text-lg dark:text-slate-400">
          AI interviewers. Real-time feedback. Smarter you.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-stretch">
            <button
              type="button"
              onClick={openSetupModal}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-ink px-7 py-3.5 text-base font-semibold text-white transition hover:bg-slate-800 dark:bg-teal-500 dark:text-white dark:hover:bg-teal-400"
            >
              Start your first interview
            </button>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-7 py-3.5 text-base font-semibold text-ink transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:border-slate-600 dark:hover:bg-slate-800"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.2-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11.1 11.1 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.7.9 1.2 1.9 1.2 3.2 0 4.5-2.7 5.4-5.3 5.7.4.3.8 1 .8 2.1v3c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5z" />
              </svg>
              View on GitHub
            </a>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            No credit card required
          </p>
        </div>
      </section>

      <section className="mt-12">
        <button
          type="button"
          onClick={() => setDemoLightboxOpen(true)}
          aria-label="Expand interview demo screenshot"
          className="group relative block w-full overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-panel transition hover:border-slate-300 md:hidden dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/demo-screenshot.png"
            alt="Preview of the AI Interview Simulator showing live insights, the interviewer video, the candidate camera, and the live coaching panel."
            className="block h-auto w-full"
            draggable={false}
          />
          <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
            Tap to expand
          </span>
        </button>

        <div className="hidden rounded-[2rem] border border-slate-200 bg-white/80 p-4 shadow-panel backdrop-blur md:block md:p-6 dark:border-slate-700 dark:bg-slate-900/60">
          <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)_240px]">
            <aside className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Live insights</p>

              <div className="mt-5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Confidence</p>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </div>
              <div className="mt-3 flex items-center gap-4">
                <ConfidenceRing value={demoConfidence} />
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Good</p>
              </div>

              <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Speaking pace</p>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                    <polyline points="17 6 23 6 23 12" />
                  </svg>
                </div>
                <p className="mt-2"><span className="text-2xl font-semibold text-ink dark:text-white">120</span> <span className="text-sm font-medium text-slate-400 dark:text-slate-500">wpm</span></p>
                <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">Good pace</p>
              </div>

              <div className="mt-5 border-t border-slate-100 pt-5 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Filler words</p>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                    <line x1="6" y1="20" x2="6" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="18" y1="20" x2="18" y2="14" />
                  </svg>
                </div>
                <p className="mt-2 text-2xl font-semibold text-ink dark:text-white">2</p>
                <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">Low</p>
              </div>

              <div className="mt-5 border-t border-slate-100 pt-5 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Eye contact</p>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </div>
                <p className="mt-2 text-2xl font-semibold text-ink dark:text-white">68%</p>
                <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">Good</p>
              </div>
            </aside>

            <div className="rounded-3xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/avatar/interviewer-neutral.png"
                  alt="AI interviewer"
                  className="absolute inset-0 h-full w-full object-cover"
                  draggable={false}
                />

                <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.9)]" />
                  AI Interviewer
                </div>

                <button
                  type="button"
                  className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-lg bg-black/45 text-white backdrop-blur"
                  aria-label="Expand demo"
                  tabIndex={-1}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                </button>

                <div className="absolute bottom-4 right-4 h-[110px] w-[160px] overflow-hidden rounded-xl border border-white/15 bg-slate-800 shadow-xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/avatar/interviewee.png"
                    alt="You"
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                </div>

                <div className="absolute bottom-4 left-4 right-[180px] max-w-[420px]">
                  <p key={demoQuestionIndex} className="landing-fade rounded-xl bg-black/60 px-4 py-2.5 text-sm font-medium leading-snug text-white backdrop-blur">
                    {currentDemoQuestion.caption}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>Question 2 of 5</span>
                <span>{formattedDemoTime}</span>
              </div>
              <p key={`body-${demoQuestionIndex}`} className="landing-fade mt-2 text-sm leading-6 text-ink dark:text-slate-200">
                {currentDemoQuestion.body}
              </p>

              <div className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-300">Listening...</span>
                <WaveformBars />
                <span className="grid h-8 w-8 place-items-center rounded-full bg-rose-500 text-white" aria-hidden="true">
                  <span className="block h-2.5 w-2.5 rounded-[2px] bg-white" />
                </span>
              </div>
            </div>

            <aside className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Live coaching</p>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400">Hide</span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Good structure</span>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Clear examples</span>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Try to add more metrics</span>
                <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">Avoid filler words</span>
              </div>

              <div className="mt-6">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Interviewer&rsquo;s thoughts</p>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-500 dark:text-teal-300" aria-hidden="true">
                    <path d="M12 2l1.5 5L19 8l-4 3 1.5 6L12 14l-4.5 3L9 11 5 8l5.5-1z" />
                  </svg>
                </div>
                <p key={demoThoughtIndex} className="landing-fade mt-3 rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
                  {currentDemoThought}
                </p>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURE_TILES.map((tile) => (
          <div key={tile.title} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <FeatureIcon kind={tile.icon} tone={tile.tone} />
            <div>
              <p className="text-sm font-semibold text-ink dark:text-white">{tile.title}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{tile.body}</p>
            </div>
          </div>
        ))}
      </section>

      <p className="mt-10 text-center text-xs text-slate-400 dark:text-slate-500">
        Looking for the final report later? Visit{" "}
        <Link href="/results" className="font-semibold text-teal-700 dark:text-teal-300">
          results
        </Link>{" "}
        after a session.
      </p>

      {showSetupModal ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 px-4 py-8 backdrop-blur-sm dark:bg-black/65">
          <div className="panel relative max-h-[calc(100vh-4rem)] w-full max-w-xl overflow-y-auto p-7">
            <button
              type="button"
              onClick={() => setShowSetupModal(false)}
              className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-ink dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              aria-label="Close start interview"
            >
              x
            </button>
            <h2 className="text-2xl font-semibold text-ink dark:text-white">Start your interview</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">A few quick choices and we will set up your practice room.</p>

            <form
              className="mt-6 space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                void openDeviceDialog();
              }}
            >
              <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Job role
                <div ref={roleDropdownRef} className="relative mt-2">
                  <button
                    type="button"
                    onClick={() => setRoleDropdownOpen((o) => !o)}
                    className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-ink transition focus:border-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-400"
                  >
                    <span>{selectedRole}</span>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 dark:text-slate-500 ${roleDropdownOpen ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {roleDropdownOpen ? (
                    <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800">
                      {LANDING_JOB_ROLES.map((jobRole) => (
                        <li key={jobRole}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRole(jobRole);
                              setRoleDropdownOpen(false);
                              setStartError(null);
                            }}
                            className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                              selectedRole === jobRole
                                ? "bg-slate-100 font-medium text-teal-700 dark:bg-slate-700 dark:text-teal-300"
                                : "text-ink hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                            }`}
                          >
                            {jobRole}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </span>

              {selectedRole === "Other" ? (
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Custom job role
                  <input
                    value={customRole}
                    onChange={(event) => {
                      setCustomRole(event.target.value);
                      setStartError(null);
                    }}
                    placeholder="Example: Healthcare Data Scientist"
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500"
                  />
                </label>
              ) : null}

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-slate-700 dark:text-slate-300">Question difficulty</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  {(["Easy", "Medium", "Hard"] as InterviewDifficulty[]).map((option) => (
                    <label
                      key={option}
                      className={`cursor-pointer rounded-2xl border px-4 py-3 text-center text-sm font-semibold transition ${
                        difficulty === option
                          ? "border-teal-500 bg-teal-50 text-teal-800 dark:border-teal-400 dark:bg-teal-900/40 dark:text-teal-200"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500"
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
                <legend className="text-sm font-medium text-slate-700 dark:text-slate-300">Resume option</legend>
                <label
                  className={`block cursor-pointer rounded-2xl border px-4 py-4 transition ${
                    uploadedResumeName
                      ? "border-teal-500 bg-teal-50 dark:border-teal-400 dark:bg-teal-900/30"
                      : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-500"
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
                      <span className="block font-medium text-ink dark:text-white">Upload resume</span>
                      <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">
                        {uploadedResumeName || "Add your own resume for a more personalized interview later."}
                      </span>
                    </span>
                    <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-700 dark:bg-teal-900/50 dark:text-teal-200">Recommended</span>
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-500">
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
                    <span className="block font-medium text-ink dark:text-white">Skip resume</span>
                    <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">Run the interview without resume context.</span>
                  </span>
                </label>
              </fieldset>

              <p className="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-slate-800/70 dark:text-slate-400">
                Next step: pick the microphone and camera you want to use during the interview.
              </p>

              {startError ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:bg-rose-900/40 dark:text-rose-200">{startError}</p> : null}

              <button
                type="submit"
                disabled={isStarting || isCheckingMedia}
                className="w-full rounded-2xl bg-ink px-5 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-500 dark:text-white dark:hover:bg-teal-400"
              >
                {startButtonLabel}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {showDeviceDialog ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 px-4 backdrop-blur-sm dark:bg-black/65">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-panel dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-ink dark:text-white">Choose interview devices</h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Camera and microphone access is ready.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowDeviceDialog(false)}
                className="grid h-9 w-9 place-items-center rounded-full text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-ink dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label="Close device selection"
              >
                x
              </button>
            </div>

            <div className="mt-6 space-y-4">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Microphone
                <select
                  value={selectedAudioDeviceId}
                  onChange={(event) => setSelectedAudioDeviceId(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:[color-scheme:dark]"
                >
                  {audioDevices.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `Microphone ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Camera
                <select
                  value={selectedVideoDeviceId}
                  onChange={(event) => setSelectedVideoDeviceId(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:[color-scheme:dark]"
                >
                  {videoDevices.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {startError ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:bg-rose-900/40 dark:text-rose-200">{startError}</p> : null}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowDeviceDialog(false)}
                className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDevicesAndStart()}
                disabled={isStarting}
                className="rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-500 dark:text-white dark:hover:bg-teal-400"
              >
                {isStarting ? "Preparing..." : "Use these devices"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showPreparationOverlay ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/55 px-4 backdrop-blur-sm dark:bg-black/70">
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-panel dark:bg-slate-900">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-700 dark:text-teal-300">Preparing interview</p>
            <h2 className="mt-4 text-2xl font-semibold text-ink dark:text-white">{PREPARATION_STEPS[preparationStepIndex]}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Your interview environment is being generated in the background.
            </p>

            <div className="mt-7 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-teal-600 transition-[width] duration-150 ease-out dark:bg-teal-400"
                style={{ width: `${preparationProgress}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span>{preparationProgress}%</span>
              <span>{preparationStepIndex + 1} of {PREPARATION_STEPS.length}</span>
            </div>
          </div>
        </div>
      ) : null}

      {demoLightboxOpen ? (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/85 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Demo screenshot"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDemoLightboxOpen(false);
          }}
        >
          <button
            type="button"
            onClick={() => setDemoLightboxOpen(false)}
            aria-label="Close demo screenshot"
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/demo-screenshot.png"
            alt="Full preview of the AI Interview Simulator interface."
            className="max-h-[90vh] max-w-[95vw] rounded-2xl object-contain shadow-2xl"
            draggable={false}
          />
        </div>
      ) : null}
    </main>
  );
}

function NavButton({ id, label, active, onClick }: { id: PopoverId; label: string; active: boolean; onClick: (id: PopoverId) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      aria-expanded={active}
      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
        active
          ? "bg-slate-100 text-ink dark:bg-slate-800 dark:text-white"
          : "text-slate-600 hover:bg-slate-100 hover:text-ink dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
