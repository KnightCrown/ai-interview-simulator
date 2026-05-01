"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FeedbackPanel, type CoachingThought } from "@/components/feedback-panel";
import { TechSpecsButton } from "@/components/tech-specs-button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  AnswerEvaluation,
  CandidateMoodSnapshot,
  FaceEmotionDominant,
  FaceEmotionScores,
  InterviewSession
} from "@/lib/interview-types";
import {
  ConversationDecision,
  ConversationLogEntry,
  ConversationRequest
} from "@/lib/heygen-types";
import { liveConfidenceFromSignals } from "@/lib/interview-scoring";
import { logLiveAvatarEvent } from "@/lib/live-avatar-client-log";
import { formatLiveConversationForFinalize } from "@/lib/live-interview-finalize";
import { getUnsubmittedUtteranceDelta } from "@/lib/live-avatar-turn";
import { createEmptyMoodCounts, getDominantMoodFromCounts } from "@/lib/candidate-mood";
import { useFaceTracking } from "@/hooks/useFaceTracking";
import { useHeyGenAvatar } from "@/hooks/useHeyGenAvatar";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useSmoothedLiveMetric } from "@/hooks/useSmoothedLiveMetric";
import { useInterviewSession } from "@/lib/session-store";
import { loadMediaDevicePreferences, saveMediaDevicePreferences } from "@/lib/media-device-preferences";

/**
 * Silence for this many ms after the caption last changed is
 * treated as the candidate finishing their utterance, at which point we hand
 * the cumulative transcript to the orchestrator.
 */
const END_OF_UTTERANCE_DEBOUNCE_MS = 2000;
const CANDIDATE_MOOD_SAMPLE_MS = 2000;

type MainVideo = "interviewer" | "candidate";

function getConfidenceColor(score: number): string {
  if (score <= 30) return "#ef4444";
  if (score >= 70) return "#22c55e";
  const t = (score - 30) / 40;
  const r = Math.round(249 + (34 - 249) * t);
  const g = Math.round(115 + (197 - 115) * t);
  const b = Math.round(22 + (94 - 22) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRepeatedFillerWords(transcript: string, fillerWords: string[]) {
  const normalizedTranscript = transcript.toLowerCase();

  return fillerWords
    .map((word) => {
      const matches = normalizedTranscript.match(new RegExp(`\\b${escapeRegExp(word.toLowerCase())}\\b`, "g"));

      return {
        word,
        count: matches?.length ?? 0
      };
    })
    .filter((item) => item.count > 5);
}

function getSpeakingPaceLabel(wordsPerMinute: number) {
  if (wordsPerMinute > 155) {
    return "Speak slower, please";
  }

  if (wordsPerMinute < 105) {
    return "Too slow";
  }

  return "Ideal";
}

function createEmptyEmotionAccum() {
  return {
    happy: 0,
    sad: 0,
    nervous: 0,
    neutral: 0,
    frames: 0,
    counts: createEmptyMoodCounts()
  };
}

export default function LiveInterviewPage() {
  const router = useRouter();
  const { session, setSession } = useInterviewSession();
  const speech = useSpeechRecognition();
  const [preferredVideoDeviceId, setPreferredVideoDeviceId] = useState<string | null>(
    () => loadMediaDevicePreferences()?.videoInputId ?? null
  );
  const face = useFaceTracking(preferredVideoDeviceId);

  const avatarVideoRef = useRef<HTMLVideoElement | null>(null);
  const avatarAudioRef = useRef<HTMLAudioElement | null>(null);
  const avatar = useHeyGenAvatar({ videoRef: avatarVideoRef, audioRef: avatarAudioRef });

  const [phase, setPhase] = useState<"setup" | "running" | "ending">("setup");
  const [latestEvaluation, setLatestEvaluation] = useState<AnswerEvaluation | null>(null);
  const [coachingThoughts, setCoachingThoughts] = useState<CoachingThought[]>([]);
  const [showCoaching, setShowCoaching] = useState(true);
  const [showOverlay, setShowOverlay] = useState(true);
  const [mainVideo, setMainVideo] = useState<MainVideo>("interviewer");
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const [micMenuOpen, setMicMenuOpen] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>(
    () => loadMediaDevicePreferences()?.audioInputId ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [statusLabel, setStatusLabel] = useState("Tap Begin to start");

  const [mainQuestionsAsked, setMainQuestionsAsked] = useState(0);
  const [currentMainQuestion, setCurrentMainQuestion] = useState<string | null>(null);
  const [conversationLog, setConversationLog] = useState<ConversationLogEntry[]>([]);
  const [pendingUtterances, setPendingUtterances] = useState<string[]>([]);

  const sessionRef = useRef<InterviewSession | null>(null);
  const phaseRef = useRef(phase);
  const isSubmittingRef = useRef(false);
  const lastSubmittedTranscriptRef = useRef("");
  const debounceTimerRef = useRef<number | null>(null);
  const answerStartTimeRef = useRef<number>(0);
  const answerEmotionAccumRef = useRef(createEmptyEmotionAccum());
  const latestCandidateEmotionRef = useRef(face.metrics.emotion);
  const conversationLogRef = useRef<ConversationLogEntry[]>([]);
  const pendingUtterancesRef = useRef<string[]>([]);
  const mainQuestionsAskedRef = useRef(0);
  const currentMainQuestionRef = useRef<string | null>(null);
  const speakingRef = useRef(false);
  const openMicAfterAvatarStopsRef = useRef(false);
  /** Previous `avatar.isSpeaking` — used to detect speak end without racing applyDecision. */
  const prevAvatarSpeakingRef = useRef(false);
  /** When true, do not auto-open the mic after the avatar finishes (user chose Pause listening). */
  const micPausedByUserRef = useRef(false);
  const [micPausedByUser, setMicPausedByUser] = useState(false);

  const [displayedCandidateMood, setDisplayedCandidateMood] = useState<FaceEmotionDominant>(face.metrics.emotion.dominant);

  const {
    elapsedSeconds,
    transcript,
    interimTranscript,
    isSupported: speechIsSupported,
    metrics: speechMetrics,
    startListening,
    stopListening,
    setCaptureEnabled,
    resetTranscript
  } = speech;

  const transcriptRef = useRef(transcript);
  const interimTranscriptRef = useRef(interimTranscript);
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);
  useEffect(() => {
    interimTranscriptRef.current = interimTranscript;
  }, [interimTranscript]);

  useEffect(() => {
    if (!session) {
      router.replace("/");
    }
  }, [router, session]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    conversationLogRef.current = conversationLog;
  }, [conversationLog]);

  useEffect(() => {
    pendingUtterancesRef.current = pendingUtterances;
  }, [pendingUtterances]);

  useEffect(() => {
    mainQuestionsAskedRef.current = mainQuestionsAsked;
  }, [mainQuestionsAsked]);

  useEffect(() => {
    currentMainQuestionRef.current = currentMainQuestion;
  }, [currentMainQuestion]);

  useEffect(() => {
    if (mainVideo !== "candidate") {
      setCameraMenuOpen(false);
      setMicMenuOpen(false);
    }
  }, [mainVideo]);

  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => setAudioDevices(devices.filter((d) => d.kind === "audioinput")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    speakingRef.current = avatar.isSpeaking;
  }, [avatar.isSpeaking]);

  useEffect(() => {
    latestCandidateEmotionRef.current = face.metrics.emotion;
  }, [face.metrics.emotion]);

  const currentTranscript = `${transcript} ${interimTranscript}`.trim();
  const repeatedFillerWords = getRepeatedFillerWords(currentTranscript, speechMetrics.fillerWords);
  const speakingPaceLabel = getSpeakingPaceLabel(speechMetrics.speakingPace);

  useEffect(() => {
    logLiveAvatarEvent("page_state", { phase, statusLabel }, "live-page");
  }, [phase, statusLabel]);

  useEffect(() => {
    logLiveAvatarEvent("avatar_state", {
      status: avatar.status,
      isSpeaking: avatar.isSpeaking,
      error: avatar.error
    }, "live-page");
  }, [avatar.error, avatar.isSpeaking, avatar.status]);

  useEffect(() => {
    logLiveAvatarEvent("speech_state", {
      isSupported: speechIsSupported,
      isListening: speech.isListening
    }, "live-page");
  }, [speech.isListening, speechIsSupported]);

  useEffect(() => {
    if (!currentTranscript) return;
    logLiveAvatarEvent("caption_update", {
      transcriptLength: transcript.length,
      interimLength: interimTranscript.length,
      textPreview: currentTranscript.slice(0, 120)
    }, "live-page");
  }, [currentTranscript, interimTranscript.length, transcript.length]);

  // Sample the candidate's facial emotion every 2s while the answer window is
  // open (i.e. after the avatar has stopped speaking the current main question
  // and before the orchestrator declares it complete).
  useEffect(() => {
    if (phase !== "running") return;

    const sampleMood = () => {
      const snapshot: FaceEmotionScores = latestCandidateEmotionRef.current;
      answerEmotionAccumRef.current.happy += snapshot.happy;
      answerEmotionAccumRef.current.sad += snapshot.sad;
      answerEmotionAccumRef.current.nervous += snapshot.nervous;
      answerEmotionAccumRef.current.neutral += snapshot.neutral;
      answerEmotionAccumRef.current.frames += 1;
      answerEmotionAccumRef.current.counts[snapshot.dominant] += 1;
      setDisplayedCandidateMood(snapshot.dominant);
    };

    sampleMood();
    const timer = window.setInterval(sampleMood, CANDIDATE_MOOD_SAMPLE_MS);
    return () => window.clearInterval(timer);
  }, [phase]);

  const liveConfidenceRaw = useMemo(() => {
    if (!session) return 50;
    const fullText = `${transcript} ${interimTranscript}`.trim();
    return liveConfidenceFromSignals({
      role: session.role,
      transcript: fullText,
      speechMetrics,
      faceMetrics: face.metrics
    });
  }, [face.metrics, interimTranscript, session, speechMetrics, transcript]);

  const displayedConfidence = useSmoothedLiveMetric(liveConfidenceRaw, { sampleMs: 2000, animateMs: 1100 });
  const displayedEyeContact = useSmoothedLiveMetric(face.metrics.eyeContact, { sampleMs: 1000, animateMs: 650 });

  const buildCandidateMood = useCallback((): CandidateMoodSnapshot => {
    const accum = answerEmotionAccumRef.current;
    const frameCount = Math.max(1, accum.frames);
    return {
      dominant: getDominantMoodFromCounts(accum.counts, latestCandidateEmotionRef.current.dominant),
      counts: { ...accum.counts },
      averages: {
        happy: accum.happy / frameCount,
        sad: accum.sad / frameCount,
        nervous: accum.nervous / frameCount,
        neutral: accum.neutral / frameCount
      },
      framesSampled: accum.frames
    };
  }, []);

  const sendOrchestratorRequest = useCallback(
    async (params: { isStart: boolean; latestUserUtterance: string }) => {
      if (!sessionRef.current) return null;
      const cumulative = pendingUtterancesRef.current.join(" ").trim();
      const durationSeconds = Math.max(0, Math.round((Date.now() - (answerStartTimeRef.current || Date.now())) / 1000));
      logLiveAvatarEvent("orchestrator_request_sending", {
        isStart: params.isStart,
        latestLength: params.latestUserUtterance.length,
        cumulativeLength: cumulative.length,
        mainQuestionsAsked: mainQuestionsAskedRef.current,
        currentMainQuestion: currentMainQuestionRef.current,
        latestPreview: params.latestUserUtterance.slice(0, 120)
      }, "live-page");

      const body: ConversationRequest = {
        session: sessionRef.current,
        conversationLog: conversationLogRef.current,
        latestUserUtterance: params.latestUserUtterance,
        mainQuestionsAsked: mainQuestionsAskedRef.current,
        currentMainQuestion: currentMainQuestionRef.current,
        isStart: params.isStart,
        cumulativeAnswerTranscript: cumulative,
        durationSeconds,
        speechMetrics,
        faceMetrics: face.metrics,
        candidateMood: buildCandidateMood()
      };

      const res = await fetch("/api/heygen/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        logLiveAvatarEvent("orchestrator_request_failed", {
          status: res.status,
          isStart: params.isStart
        }, "live-page");
        throw new Error(`Orchestrator failed (${res.status})`);
      }
      const decision = (await res.json()) as ConversationDecision;
      logLiveAvatarEvent("orchestrator_response_received", {
        classification: decision.classification,
        isQuestionComplete: decision.isQuestionComplete,
        shouldEndInterview: decision.shouldEndInterview,
        replyLength: decision.replyText.length,
        replyPreview: decision.replyText.slice(0, 120)
      }, "live-page");
      return decision;
    },
    [buildCandidateMood, face.metrics, speechMetrics]
  );

  const sendOrchestratorRequestRef = useRef(sendOrchestratorRequest);
  sendOrchestratorRequestRef.current = sendOrchestratorRequest;

  /** Persist transcript on the session for a single `/api/interview/finalize` call on the results page. */
  const persistLiveTranscriptAndComplete = useCallback(() => {
    const base = sessionRef.current;
    if (!base) return;
    const liveConversationTranscript = formatLiveConversationForFinalize(conversationLogRef.current);
    flushSync(() => {
      setSession({ ...base, interviewComplete: true, liveConversationTranscript });
    });
    logLiveAvatarEvent("session_prepared_for_results", { transcriptChars: liveConversationTranscript.length }, "live-page");
  }, [setSession]);

  /**
   * Apply a decision the orchestrator returned: speak the avatar's reply, fold
   * scoring/turn updates into the session, manage state transitions, and route
   * to /results when the interview is over.
   */
  const applyDecision = useCallback(
    async (decision: ConversationDecision) => {
      logLiveAvatarEvent("decision_applying", {
        classification: decision.classification,
        isQuestionComplete: decision.isQuestionComplete,
        shouldEndInterview: decision.shouldEndInterview,
        replyLength: decision.replyText.length
      }, "live-page");
      // Append the avatar's utterance to the conversation log.
      const avatarEntry: ConversationLogEntry = {
        role: "avatar",
        text: decision.replyText,
        timestamp: Date.now(),
        classification: decision.classification
      };
      setConversationLog((prev) => [...prev, avatarEntry]);

      // If a main question was just completed and scored, fold the new session
      // and surface the evaluation to the coaching panel.
      if (decision.isQuestionComplete && decision.session) {
        sessionRef.current = decision.session;
        setSession(decision.session);
        logLiveAvatarEvent("session_scored", {
          turnCount: decision.session.turns.length,
          hasEvaluation: !!decision.evaluation
        }, "live-page");
        if (decision.evaluation) {
          setLatestEvaluation(decision.evaluation);
          setCoachingThoughts((current) => [
            { id: crypto.randomUUID(), thought: decision.evaluation!.interviewerReaction },
            ...current
          ]);
        }
      }

      // For next_main_question and wrap_up, the reply text contains the next
      // main question — bump the counter and set it as current.
      if (decision.classification === "next_main_question") {
        setMainQuestionsAsked((current) => current + 1);
        setCurrentMainQuestion(decision.replyText);
        setPendingUtterances([]);
        answerStartTimeRef.current = Date.now();
        answerEmotionAccumRef.current = createEmptyEmotionAccum();
        lastSubmittedTranscriptRef.current = "";
        resetTranscript();
        logLiveAvatarEvent("next_main_question_ready", {
          mainQuestionsAsked: mainQuestionsAskedRef.current + 1,
          questionPreview: decision.replyText.slice(0, 120)
        }, "live-page");
      } else if (decision.classification === "wrap_up") {
        setMainQuestionsAsked((current) => current + 1);
        setPendingUtterances([]);
        logLiveAvatarEvent("wrap_up_ready", {}, "live-page");
      }

      // Mute local capture while the avatar speaks (avoid echo).
      setCaptureEnabled(false);
      logLiveAvatarEvent("mic_capture_disabled", { reason: "avatar_reply" }, "live-page");

      try {
        logLiveAvatarEvent("waiting_for_avatar_audio", {
          replyLength: decision.replyText.length
        }, "live-page");
        await avatar.speak(decision.replyText);
        logLiveAvatarEvent("avatar_speak_command_completed", {}, "live-page");
      } catch (err) {
        console.error("[live] avatar.speak failed", err);
        logLiveAvatarEvent("avatar_speak_command_failed", {
          error: err instanceof Error ? err.message : "avatar.speak failed"
        }, "live-page");
      }

      if (decision.shouldEndInterview) {
        setPhase("ending");
        setStatusLabel("Wrapping up...");
        logLiveAvatarEvent("interview_ending", {}, "live-page");
        // Wait briefly for the avatar's wrap-up utterance to finish on screen
        // before tearing down the session and routing to results.
        setTimeout(async () => {
          await avatar.stop();
          stopListening();
          persistLiveTranscriptAndComplete();
          router.push("/results");
        }, 5000);
        return;
      }

      // After this utterance ends, re-open the mic (see effect below — must run
      // only on isSpeaking true→false, not when isSpeaking is still false before
      // speak_started, or we consume the latch too early).
      openMicAfterAvatarStopsRef.current = true;

      // If avatar.speak_started / speak_ended never arrive, isSpeaking stays false
      // and the transition effect never opens the mic — recover after ~TTS duration.
      const fallbackMs = Math.min(90_000, Math.max(14_000, decision.replyText.length * 55 + 10_000));
      window.setTimeout(() => {
        if (phaseRef.current !== "running") return;
        if (!openMicAfterAvatarStopsRef.current) return;
        if (micPausedByUserRef.current) return;
        openMicAfterAvatarStopsRef.current = false;
        prevAvatarSpeakingRef.current = false;
        lastSubmittedTranscriptRef.current = "";
        resetTranscript();
        setCaptureEnabled(true);
        logLiveAvatarEvent("avatar_speak_event_missing_opening_mic_fallback", {
          fallbackMs
        }, "live-page");
        if (speechIsSupported) {
          startListening({ reset: true });
          logLiveAvatarEvent("speech_listening_start_requested", { reason: "fallback" }, "live-page");
        }
        answerStartTimeRef.current = Date.now();
        setStatusLabel("Listening...");
      }, fallbackMs);
    },
    [avatar, persistLiveTranscriptAndComplete, resetTranscript, router, setCaptureEnabled, setSession, speechIsSupported, startListening, stopListening]
  );

  const applyDecisionRef = useRef(applyDecision);
  applyDecisionRef.current = applyDecision;

  const [utteranceSubmitBusy, setUtteranceSubmitBusy] = useState(false);

  const performUtteranceSubmission = useCallback(async (opts: { source: "debounce" | "manual_submit" }) => {
    if (phaseRef.current !== "running" || speakingRef.current) return;
    if (isSubmittingRef.current) return;

    const requireSubstantive = opts.source === "debounce";
    const candidateText = `${transcriptRef.current} ${interimTranscriptRef.current}`.trim();
    const delta = getUnsubmittedUtteranceDelta(candidateText, lastSubmittedTranscriptRef.current, {
      requireSubstantive
    });
    if (!delta) return;

    if (opts.source === "manual_submit") {
      micPausedByUserRef.current = false;
      setMicPausedByUser(false);
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      logLiveAvatarEvent("manual_submit_invoked", {
        deltaLength: delta.length,
        deltaPreview: delta.slice(0, 120)
      }, "live-page");
    }

    isSubmittingRef.current = true;
    setUtteranceSubmitBusy(true);
    lastSubmittedTranscriptRef.current = candidateText;
    setStatusLabel("Thinking...");
    logLiveAvatarEvent("utterance_sent_to_orchestrator", {
      textLength: delta.length,
      textPreview: delta.slice(0, 120),
      fullCaptionLength: candidateText.length,
      trigger: opts.source
    }, "live-page");

    const userEntry: ConversationLogEntry = {
      role: "user",
      text: delta,
      timestamp: Date.now()
    };
    setConversationLog((prev) => [...prev, userEntry]);
    setPendingUtterances((prev) => [...prev, delta]);
    pendingUtterancesRef.current = [...pendingUtterancesRef.current, delta];

    try {
      const decision = await sendOrchestratorRequestRef.current({ isStart: false, latestUserUtterance: delta });
      if (decision) {
        await applyDecisionRef.current(decision);
      }
    } catch (err) {
      console.error("[live] orchestrator round-trip failed", err);
      setError("Lost connection to the interviewer. Please reload to try again.");
      logLiveAvatarEvent("orchestrator_round_trip_failed", {
        error: err instanceof Error ? err.message : "orchestrator round-trip failed"
      }, "live-page");
    } finally {
      isSubmittingRef.current = false;
      setUtteranceSubmitBusy(false);
      logLiveAvatarEvent("utterance_submission_complete", { trigger: opts.source }, "live-page");
    }
  }, []);

  const performUtteranceSubmissionRef = useRef(performUtteranceSubmission);
  performUtteranceSubmissionRef.current = performUtteranceSubmission;

  const handlePauseListening = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    micPausedByUserRef.current = true;
    setMicPausedByUser(true);
    setCaptureEnabled(false);
    stopListening();
    setStatusLabel("Mic paused — tap Resume listening when ready");
    logLiveAvatarEvent("manual_stop_listening", {}, "live-page");
  }, [setCaptureEnabled, stopListening]);

  const handleResumeListening = useCallback(() => {
    if (phaseRef.current !== "running" || speakingRef.current) return;
    micPausedByUserRef.current = false;
    setMicPausedByUser(false);
    setCaptureEnabled(true);
    if (speechIsSupported) {
      startListening({ reset: false });
      logLiveAvatarEvent("speech_listening_start_requested", { reason: "manual_resume" }, "live-page");
    }
    answerStartTimeRef.current = Date.now();
    setStatusLabel("Listening...");
    logLiveAvatarEvent("manual_resume_listening", {}, "live-page");
  }, [setCaptureEnabled, speechIsSupported, startListening]);

  const handleSubmitUtteranceNow = useCallback(() => {
    void performUtteranceSubmissionRef.current({ source: "manual_submit" });
  }, []);

  const canSubmitUtteranceNow = useMemo(() => {
    if (phase !== "running" || avatar.isSpeaking || utteranceSubmitBusy) return false;
    const full = `${transcript} ${interimTranscript}`.trim();
    return (
      getUnsubmittedUtteranceDelta(full, lastSubmittedTranscriptRef.current, { requireSubstantive: false }) !== null
    );
  }, [phase, avatar.isSpeaking, utteranceSubmitBusy, transcript, interimTranscript, conversationLog.length]);

  // Re-open the mic only when the avatar *finishes* speaking (isSpeaking goes
  // true → false). Opening whenever isSpeaking was false races applyDecision:
  // speak() resolves before speak_started, we would consume the latch early and
  // never open the mic after speak_ended.
  useEffect(() => {
    if (phase !== "running") {
      prevAvatarSpeakingRef.current = false;
      return;
    }

    if (avatar.isSpeaking) {
      setCaptureEnabled(false);
      logLiveAvatarEvent("mic_capture_disabled", { reason: "avatar_is_speaking" }, "live-page");
      prevAvatarSpeakingRef.current = true;
      return;
    }

    const avatarJustFinished = prevAvatarSpeakingRef.current;
    prevAvatarSpeakingRef.current = false;

    if (avatarJustFinished && openMicAfterAvatarStopsRef.current) {
      openMicAfterAvatarStopsRef.current = false;
      lastSubmittedTranscriptRef.current = "";
      if (micPausedByUserRef.current) {
        setCaptureEnabled(false);
        setStatusLabel("Mic paused — tap Resume listening when ready");
        logLiveAvatarEvent("mic_left_closed", { reason: "user_paused" }, "live-page");
        return;
      }
      resetTranscript();
      setCaptureEnabled(true);
      logLiveAvatarEvent("mic_capture_enabled", { reason: "avatar_finished" }, "live-page");
      if (!speech.isListening && speechIsSupported) {
        startListening({ reset: true });
        logLiveAvatarEvent("speech_listening_start_requested", { reason: "avatar_finished" }, "live-page");
      }
      answerStartTimeRef.current = Date.now();
      setStatusLabel("Listening...");
    }
  }, [avatar.isSpeaking, phase, resetTranscript, setCaptureEnabled, speech.isListening, speechIsSupported, startListening]);

  // End-of-utterance detection: debounce after the caption stops changing.
  // Use both committed and interim text; Web Speech can keep the last phrase
  // in interim text after a pause, so transcript alone can stay empty.
  useEffect(() => {
    if (phase !== "running") return;
    if (avatar.isSpeaking) return;

    const fullCaption = `${transcript} ${interimTranscript}`.trim();
    const pendingDelta = getUnsubmittedUtteranceDelta(fullCaption, lastSubmittedTranscriptRef.current);
    if (!pendingDelta || isSubmittingRef.current) return;

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }

    // Any new transcript or interim update re-runs this effect and re-arms the timer.
    logLiveAvatarEvent("utterance_debounce_armed", {
      debounceMs: END_OF_UTTERANCE_DEBOUNCE_MS,
      deltaLength: pendingDelta.length,
      deltaPreview: pendingDelta.slice(0, 120),
      hasInterim: !!interimTranscript.trim()
    }, "live-page");
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void performUtteranceSubmissionRef.current({ source: "debounce" });
    }, END_OF_UTTERANCE_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [avatar.isSpeaking, interimTranscript, phase, transcript]);

  /**
   * Begin button handler. Triggers the user gesture browsers require to
   * autoplay the LiveKit video, then starts the avatar and asks the first
   * main question.
   */
  const handleBegin = useCallback(async () => {
    if (!session) return;
    logLiveAvatarEvent("begin_clicked", {
      role: session.role,
      difficulty: session.difficulty,
      speechIsSupported
    }, "live-page");
    setError(null);
    micPausedByUserRef.current = false;
    setMicPausedByUser(false);
    setPhase("running");
    setStatusLabel("Connecting to interviewer...");

    try {
      logLiveAvatarEvent("avatar_start_requested", {}, "live-page");
      await avatar.start();
      logLiveAvatarEvent("avatar_start_completed", { status: avatar.status }, "live-page");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start avatar.");
      setPhase("setup");
      logLiveAvatarEvent("avatar_start_failed", {
        error: err instanceof Error ? err.message : "Failed to start avatar."
      }, "live-page");
      return;
    }
  }, [avatar, session, speechIsSupported]);

  // Once the avatar stream is ready (post-handleBegin), kick off the greeting +
  // first main question via the orchestrator.
  const greetingFiredRef = useRef(false);
  useEffect(() => {
    if (phase !== "running") return;
    if (avatar.status !== "ready" && avatar.status !== "speaking") return;
    if (greetingFiredRef.current) return;
    greetingFiredRef.current = true;

    void (async () => {
      try {
        logLiveAvatarEvent("greeting_request_started", {}, "live-page");
        const decision = await sendOrchestratorRequestRef.current({ isStart: true, latestUserUtterance: "" });
        if (!decision) return;
        await applyDecisionRef.current(decision);
      } catch (err) {
        console.error("[live] greeting failed", err);
        setError("Failed to start the interview. Please reload.");
        logLiveAvatarEvent("greeting_request_failed", {
          error: err instanceof Error ? err.message : "Failed to start the interview."
        }, "live-page");
      }
    })();
  }, [avatar.status, phase]);

  const dismissCoachingThought = useCallback((id: string) => {
    setCoachingThoughts((current) => current.filter((item) => item.id !== id));
  }, []);

  if (!session) return null;

  const totalQuestions = 3;
  const currentQuestionNumber = Math.min(Math.max(1, mainQuestionsAsked), totalQuestions);

  return (
    <main className="min-h-screen bg-[#f7f9fc] text-ink dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200/80 bg-white/90 px-5 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-[118rem] flex-col gap-4 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <div className="flex items-center gap-4">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-sm font-bold text-white dark:bg-white dark:text-ink">AI</div>
            <h1 className="text-base font-semibold sm:text-lg dark:text-white">{session.role} Live Interview <span className="ml-2 rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">Beta</span></h1>
          </div>

          <div className="justify-self-center text-center">
            <p className="text-sm font-medium dark:text-slate-200">Question {currentQuestionNumber} of {totalQuestions}</p>
            <div className="mt-3 flex items-center justify-center gap-2 sm:gap-3">
              {Array.from({ length: totalQuestions }).map((_, index) => {
                const step = index + 1;
                const isActive = step <= currentQuestionNumber;
                return (
                  <div key={step} className="flex items-center gap-2 sm:gap-3">
                    <span className={`h-3 w-3 rounded-full ${isActive ? "bg-teal-600 dark:bg-teal-400" : "bg-slate-200 dark:bg-slate-700"}`} />
                    {step < totalQuestions ? (
                      <span className={`h-1 w-7 rounded-full sm:w-14 ${step < currentQuestionNumber ? "bg-teal-600 dark:bg-teal-400" : "bg-slate-200 dark:bg-slate-700"}`} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 lg:justify-end">
            <TechSpecsButton variant="header" />
            <button
              type="button"
              onClick={async () => {
                logLiveAvatarEvent("end_interview_clicked", {}, "live-page");
                await avatar.stop();
                stopListening();
                persistLiveTranscriptAndComplete();
                router.push("/results");
              }}
              className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-red-600 shadow-sm transition hover:border-red-200 hover:bg-red-50 dark:border-slate-700 dark:bg-slate-800 dark:text-rose-300 dark:hover:border-rose-500/40 dark:hover:bg-rose-900/30"
            >
              End interview
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[124rem] gap-6 px-5 py-8 lg:grid-cols-[16rem_minmax(0,68rem)_24rem] lg:grid-rows-[auto_auto]">
        <aside className="order-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-panel dark:border-slate-700 dark:bg-slate-900 lg:order-none lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-8 lg:h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Live insights</p>

          <div className="mt-5">
            <p className="text-sm font-semibold dark:text-white">Confidence</p>
            <div className="mt-3 flex items-center gap-5">
              <div
                className="grid h-24 w-24 shrink-0 place-items-center rounded-full transition-[background] duration-300 ease-out"
                style={{ background: `conic-gradient(${getConfidenceColor(displayedConfidence)} ${displayedConfidence * 3.6}deg, var(--ring-track, #eef2f7) 0deg)` }}
              >
                <div className="h-16 w-16 rounded-full bg-white dark:bg-slate-900" />
              </div>
              <div>
                <p className="text-4xl font-semibold dark:text-white">{displayedConfidence}<span className="text-base font-medium text-slate-400 dark:text-slate-500"> /100</span></p>
                <p className="mt-2 text-sm font-semibold" style={{ color: getConfidenceColor(displayedConfidence) }}>
                  {displayedConfidence >= 70 ? "Strong" : displayedConfidence >= 30 ? "Good" : "Warming up"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowOverlay((current) => !current)}
              aria-pressed={showOverlay}
              className={`mt-5 w-full rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                showOverlay
                  ? "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-500/40 dark:bg-teal-900/30 dark:text-teal-200"
                  : "border-slate-200 bg-white text-slate-600 hover:border-teal-200 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-teal-400/40 dark:hover:text-teal-200"
              }`}
            >
              {showOverlay ? "Overlay on" : "Overlay"}
            </button>

            <p className="mt-5 text-sm text-slate-500 dark:text-slate-400">Eye Contact: {displayedEyeContact}</p>

            <div className="mt-4 space-y-2" aria-live="polite" aria-label="Facial expression breakdown">
              {(
                [
                  { key: "happy", color: "#14a38b" },
                  { key: "neutral", color: "#94a3b8" },
                  { key: "nervous", color: "#f59e0b" },
                  { key: "sad", color: "#f43f5e" }
                ] as { key: FaceEmotionDominant; color: string }[]
              ).map(({ key, color }) => {
                const score = Math.round(face.metrics.emotion[key]);
                const isActive = displayedCandidateMood === key;
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className={`w-14 shrink-0 text-xs capitalize ${isActive ? "font-semibold text-ink dark:text-white" : "text-slate-400 dark:text-slate-500"}`}>
                      {key}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-1.5 rounded-full transition-[width] duration-500 ease-out"
                        style={{ width: `${score}%`, backgroundColor: isActive ? color : "#cbd5e1" }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-right text-xs text-slate-400 dark:text-slate-500">{score}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-5 space-y-4 border-t border-slate-200 pt-5 dark:border-slate-800">
            <div>
              <p className="text-sm font-semibold dark:text-white">Words per Min</p>
              <p className="mt-1.5 text-3xl font-semibold dark:text-white">{speechMetrics.speakingPace}</p>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{speakingPaceLabel}</p>
            </div>
            <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
              <p className="text-sm font-semibold dark:text-white">Speaking time</p>
              <p className="mt-1.5 text-3xl font-semibold dark:text-white">{formatTime(elapsedSeconds)}</p>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">min</p>
            </div>
            <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
              <p className="text-sm font-semibold dark:text-white">Filler Words</p>
              <p className="mt-1.5 text-3xl font-semibold dark:text-white">{speechMetrics.fillerCount}</p>
              {repeatedFillerWords.length > 0 ? (
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {repeatedFillerWords.map((item) => `${item.word} (${item.count})`).join(", ")}
                </p>
              ) : null}
            </div>
            <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
              <p className="text-sm font-semibold dark:text-white">Mood</p>
              <p className="mt-1.5 text-2xl font-semibold capitalize dark:text-white">{displayedCandidateMood}</p>
            </div>
          </div>
        </aside>

        <section className="contents">
          <div className="relative order-1 mx-auto aspect-video max-h-[46vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-slate-950 shadow-panel lg:col-start-2 lg:row-start-1">
            {/* LiveKit publishes avatar audio as a separate track; it must attach to an unmuted <audio>. */}
            <audio ref={avatarAudioRef} playsInline className="sr-only" aria-hidden="true" />

            {/*
              Keep one HeyGen <video> and one camera <video> in a stable DOM order so refs never remount
              when swapping PiP vs full screen (remounting would tear down the avatar stream).
            */}
            <div
              className={
                mainVideo === "interviewer"
                  ? "absolute inset-0 z-0"
                  : "absolute bottom-4 right-4 z-10 aspect-video w-[28%] min-w-40 cursor-pointer overflow-hidden rounded-xl border border-white/20 shadow-2xl"
              }
              onClick={mainVideo === "candidate" ? () => setMainVideo("interviewer") : undefined}
            >
              <video ref={avatarVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
            </div>

            <div
              className={
                mainVideo === "candidate"
                  ? "absolute inset-0 z-0 cursor-pointer overflow-hidden"
                  : "absolute bottom-4 right-4 z-10 aspect-video w-[28%] min-w-40 cursor-pointer overflow-hidden rounded-xl border border-white/20 shadow-2xl"
              }
              onClick={() => setMainVideo(mainVideo === "candidate" ? "interviewer" : "candidate")}
            >
              <video ref={face.videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              <canvas ref={face.canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
            </div>

            {mainVideo === "candidate" ? (
              <div
                className="absolute right-4 top-4 z-20 flex items-start gap-2"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setMicMenuOpen((current) => !current);
                      setCameraMenuOpen(false);
                    }}
                    className="grid h-12 w-12 place-items-center rounded-xl bg-black/55 text-white backdrop-blur transition hover:bg-black/70"
                    aria-expanded={micMenuOpen}
                    aria-label="Choose microphone"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                      <line x1="8" y1="22" x2="16" y2="22" />
                    </svg>
                  </button>

                  {micMenuOpen ? (
                    <div className="absolute right-0 mt-2 w-60 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/15 bg-black/75 p-1 text-sm text-white shadow-2xl backdrop-blur">
                      {audioDevices.length > 0 ? (
                        audioDevices.map((device, index) => (
                          <button
                            key={device.deviceId || index}
                            type="button"
                            onClick={() => {
                              setSelectedAudioDeviceId(device.deviceId);
                              saveMediaDevicePreferences({
                                audioInputId: device.deviceId,
                                videoInputId: loadMediaDevicePreferences()?.videoInputId ?? "",
                                mediaPermissionGranted: true
                              });
                              setMicMenuOpen(false);
                            }}
                            className={`block w-full rounded-lg px-3 py-2 text-left transition hover:bg-white/15 ${
                              device.deviceId === selectedAudioDeviceId ? "bg-white/20 font-semibold" : ""
                            }`}
                          >
                            {device.label || `Microphone ${index + 1}`}
                          </button>
                        ))
                      ) : (
                        <p className="px-3 py-2 text-slate-300">No microphones found</p>
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setCameraMenuOpen((current) => !current);
                      setMicMenuOpen(false);
                    }}
                    className="grid h-12 w-12 place-items-center rounded-xl bg-black/55 text-white backdrop-blur transition hover:bg-black/70"
                    aria-expanded={cameraMenuOpen}
                    aria-label="Choose camera device"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 7h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
                      <path d="m17 10 5-3v10l-5-3" />
                      <path d="M7 12h6" />
                      <path d="M10 9v6" />
                    </svg>
                  </button>

                  {cameraMenuOpen ? (
                    <div className="absolute right-0 mt-2 w-60 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/15 bg-black/75 p-1 text-sm text-white shadow-2xl backdrop-blur">
                      {face.videoDevices.length > 0 ? (
                        face.videoDevices.map((device, index) => (
                          <button
                            key={device.deviceId || index}
                            type="button"
                            onClick={() => {
                              void face.selectCamera(index);
                              saveMediaDevicePreferences({
                                audioInputId: loadMediaDevicePreferences()?.audioInputId ?? "",
                                videoInputId: device.deviceId,
                                mediaPermissionGranted: true
                              });
                              setPreferredVideoDeviceId(device.deviceId);
                              setCameraMenuOpen(false);
                            }}
                            className={`block w-full rounded-lg px-3 py-2 text-left transition hover:bg-white/15 ${
                              index === face.selectedDeviceIndex ? "bg-white/20 font-semibold" : ""
                            }`}
                          >
                            {device.label || `Camera ${index + 1}`}
                          </button>
                        ))
                      ) : (
                        <p className="px-3 py-2 text-slate-300">No camera devices found</p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {phase === "setup" ? (
              <div className="absolute inset-0 z-30 grid place-items-center bg-slate-950/80 px-8 text-center">
                <div className="max-w-md space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-300">Live HeyGen avatar (Beta)</p>
                  <h2 className="text-2xl font-semibold text-white">Ready when you are.</h2>
                  <p className="text-sm leading-6 text-slate-300">
                    A live AI interviewer will greet you, ask up to 3 main questions with free-flow follow-ups, and react to what you say in real time. You can interrupt the avatar mid-sentence — speaking will stop it.
                  </p>
                  {error ? <p className="rounded-xl bg-rose-900/40 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
                  {!speechIsSupported ? <p className="rounded-xl bg-amber-900/40 px-4 py-3 text-sm text-amber-100">Speech recognition is not supported in this browser. Use Chrome, Edge, or Safari.</p> : null}
                  <button
                    type="button"
                    onClick={handleBegin}
                    disabled={!speechIsSupported}
                    className="w-full rounded-2xl bg-teal-500 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:bg-slate-600"
                  >
                    Begin live interview
                  </button>
                </div>
              </div>
            ) : null}

            {showOverlay && phase === "running" ? (
              <div
                className={`pointer-events-none absolute top-4 z-[15] flex flex-col gap-2 ${
                  mainVideo === "candidate" ? "left-4 items-start" : "right-4 items-end"
                }`}
              >
                <div className="rounded-xl bg-black/60 px-3 py-2 backdrop-blur">
                  <span
                    className="text-3xl font-bold tabular-nums leading-none"
                    style={{ color: getConfidenceColor(displayedConfidence) }}
                  >
                    {displayedConfidence}
                  </span>
                </div>
                <div className="rounded-xl bg-black/60 px-3 py-1.5 backdrop-blur">
                  <span className="text-base font-semibold tabular-nums leading-none text-white">
                    {speechMetrics.speakingPace}
                    <span className="ml-1 text-xs font-medium text-white/60">WPM</span>
                  </span>
                </div>
                <div className="rounded-xl bg-black/60 px-3 py-1.5 backdrop-blur">
                  <span className="text-sm font-semibold capitalize leading-none text-white/90">
                    {displayedCandidateMood}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="absolute bottom-5 left-5 z-20 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2">
              <div className="rounded-xl bg-black/55 px-4 py-2 text-sm font-semibold text-white backdrop-blur">
                <span className={`mr-2 inline-block h-3 w-3 rounded-full align-middle ${phase === "running" ? "bg-teal-400" : "bg-slate-400"}`} />
                {statusLabel}
              </div>
              {phase === "running" ? (
                <div className="rounded-xl bg-black/55 px-3 py-2 text-xs font-semibold text-white/90 backdrop-blur">
                  {mainVideo === "interviewer" ? "Interviewing" : "Candidate camera"}
                </div>
              ) : null}
              {phase === "running" && !avatar.isSpeaking ? (
                micPausedByUser ? (
                  <button
                    type="button"
                    onClick={handleResumeListening}
                    disabled={!speechIsSupported}
                    className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:bg-slate-600"
                  >
                    Resume listening
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handlePauseListening}
                    className="rounded-xl bg-black/55 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-black/70"
                  >
                    Pause listening
                  </button>
                )
              ) : null}
            </div>
          </div>

          <div className="order-2 mx-auto w-full max-w-4xl rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-panel sm:px-8 sm:py-6 lg:col-start-2 lg:row-start-2 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Live conversation</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSubmitUtteranceNow}
                disabled={!canSubmitUtteranceNow}
                className="rounded-xl border border-amber-400/80 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-950 shadow-sm transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-amber-500/50 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/50 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
              >
                Send now (debug)
              </button>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Sends the current caption immediately; clears mic pause and keeps the 2s silence auto-send.
              </span>
            </div>
            <div className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
              {conversationLog.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">The interviewer will speak first. Your responses will appear here as you talk.</p>
              ) : (
                conversationLog.map((entry, index) => (
                  <div
                    key={`${entry.timestamp}-${index}`}
                    className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
                      entry.role === "avatar"
                        ? "bg-slate-100 text-ink dark:bg-slate-800 dark:text-slate-100"
                        : "bg-teal-50 text-teal-900 dark:bg-teal-900/30 dark:text-teal-100"
                    }`}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">
                      {entry.role === "avatar" ? "Interviewer" : "You"}
                      {entry.classification ? ` · ${entry.classification.replace(/_/g, " ")}` : ""}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{entry.text}</p>
                  </div>
                ))
              )}
              {interimTranscript ? (
                <div className="rounded-2xl bg-teal-50/60 px-4 py-3 text-sm italic leading-6 text-teal-900 dark:bg-teal-900/20 dark:text-teal-100">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">You (live)</p>
                  <p className="mt-1">{interimTranscript}</p>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="order-4 space-y-4 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:self-start lg:sticky lg:top-8">
          <button
            type="button"
            onClick={() => setShowCoaching((current) => !current)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-semibold shadow-panel transition hover:border-teal-200 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-teal-400/40 dark:hover:text-teal-200"
          >
            {showCoaching ? "Hide coaching" : "Show coaching"}
          </button>
          {showCoaching ? (
            <div className="max-h-[calc(100vh-12rem)] w-full overflow-y-auto">
              <FeedbackPanel latestEvaluation={latestEvaluation} thoughts={coachingThoughts} onDismissThought={dismissCoachingThought} />
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
