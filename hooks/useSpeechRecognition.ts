"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SpeechMetrics } from "@/lib/interview-types";

type RecognitionInstance = SpeechRecognition;
type RecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
    };
  }>;
};

type StartListeningOptions = {
  reset?: boolean;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => RecognitionInstance;
    webkitSpeechRecognition?: new () => RecognitionInstance;
  }

  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: RecognitionEventLike) => void) | null;
    onend: (() => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    start: () => void;
    stop: () => void;
  }

  interface SpeechRecognitionErrorEvent {
    error: string;
  }
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Phrases are intentionally listed before their sub-words so they read clearly.
 * Detection uses whole-word boundaries (\b) for all entries, so single words
 * like "like" won't fire inside "likely", and multi-word phrases like "kind of"
 * only fire when those words appear together.
 */
const FILLER_WORDS = [
  // Hesitation sounds
  "um", "uh", "er", "ah", "uhh", "umm", "uhm", "hmm", "mm", "eh",
  "uh huh", "mm hmm",
  // Classic fillers
  "like", "you know", "kind of", "sort of", "basically", "i mean", "just",
  "maybe", "i guess", "probably", "stuff", "things", "whatever", "anyway", "anyways",
  "honestly", "frankly",
  // Hedging phrases
  "i think", "i feel like", "i suppose", "i would say", "i'd say",
  "i guess you could say", "you know what i mean", "if you know what i mean",
  "you get what i mean", "if that makes sense", "does that make sense",
  "as it were", "if you will", "so to speak",
  // Qualifiers
  "more or less", "pretty much", "in a way", "in some ways", "in many ways",
  "to be honest", "a little bit", "a bit",
  // Compound filler phrases
  "kind of like", "sort of like", "kind of just", "sort of just",
  "just kind of", "just sort of",
  "like you know", "you know like", "well you know",
  "so yeah", "so like", "so um", "so uh",
  "um so", "uh so", "uh well", "um well",
  "like um", "and uh", "and um", "well um", "well uh",
  // Trailing filler phrases
  "and so on", "and everything", "or something", "or whatever", "or anything",
  "or stuff like that", "and all that", "and things like that",
  "and stuff like that", "and so forth", "i mean like"
];

// Errors that should NOT trigger an auto-restart (the user / browser has
// permanently denied access or the engine has reported a state from which
// silently retrying would either fail loudly or hide a real problem).
const FATAL_RECOGNITION_ERRORS = new Set([
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
  "language-not-supported"
]);

// Backoff before re-issuing recognition.start() after onend on mobile browsers
// that force-stop continuous recognition every ~10–15s (notably iOS Safari).
// Calling start() too quickly after stop() raises InvalidStateError on Chrome.
const RESTART_BACKOFF_MS = 250;

// Word-level overlap dedupe cap. iOS Safari has been observed re-emitting up to
// the trailing handful of words from the previous recognition session as the
// first results of the next; capping search to 12 words is well above that and
// keeps the comparison cheap (worst case 12 string equality checks).
const MAX_OVERLAP_WORDS = 12;

/**
 * Returns `incoming` with any leading word-prefix that already appears as the
 * trailing suffix of `committed` removed. Comparison is case-insensitive and
 * whitespace-normalized; the original casing of the surviving tail is
 * preserved. This protects against iOS Safari restart-replay where a chunk of
 * the previous session's tail is re-emitted as the new session's head.
 *
 * Exported for unit testing.
 */
export function dedupeOverlap(committed: string, incoming: string): string {
  const incomingTrim = incoming.trim();
  if (!incomingTrim) return "";
  const committedTrim = committed.trim();
  if (!committedTrim) return incomingTrim;

  const committedWords = committedTrim.toLowerCase().split(/\s+/).filter(Boolean);
  const incomingWordsRaw = incomingTrim.split(/\s+/).filter(Boolean);
  const incomingWordsLower = incomingWordsRaw.map((w) => w.toLowerCase());
  const maxK = Math.min(committedWords.length, incomingWordsLower.length, MAX_OVERLAP_WORDS);

  for (let k = maxK; k > 0; k -= 1) {
    let isMatch = true;
    for (let i = 0; i < k; i += 1) {
      if (committedWords[committedWords.length - k + i] !== incomingWordsLower[i]) {
        isMatch = false;
        break;
      }
    }
    if (isMatch) {
      return incomingWordsRaw.slice(k).join(" ");
    }
  }

  return incomingTrim;
}

export function useSpeechRecognition() {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const timerRef = useRef<number | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const isListeningRef = useRef(false);
  const captureEnabledRef = useRef(false);
  // Set when the engine reports a non-recoverable error. Once true, we stop
  // auto-restarting until the consumer explicitly calls startListening again.
  const fatalErrorRef = useRef(false);

  const ensureElapsedTimer = useCallback(() => {
    if (timerRef.current !== null) return;
    timerRef.current = window.setInterval(() => {
      if (startTimeRef.current) {
        setElapsedSeconds(Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000)));
      }
    }, 1000);
  }, []);

  const clearElapsedTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const SpeechRecognitionConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionConstructor) {
      setIsSupported(false);
      return;
    }

    const recognition = new SpeechRecognitionConstructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      if (!captureEnabledRef.current) {
        setTranscript("");
        setInterimTranscript("");
        return;
      }

      let finalText = "";
      let interimText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0].transcript;

        if (result.isFinal) {
          finalText += `${text} `;
        } else {
          interimText += text;
        }
      }

      const trimmedFinal = finalText.trim();
      if (trimmedFinal) {
        // Dedupe inside the updater so we always compare against the freshest
        // committed transcript, even when multiple onresult events batch in
        // the same React tick.
        setTranscript((current) => {
          const deduped = dedupeOverlap(current, trimmedFinal);
          if (!deduped) return current;
          return current ? `${current} ${deduped}` : deduped;
        });
      }

      setInterimTranscript(interimText.trim());
    };

    recognition.onend = () => {
      isListeningRef.current = false;
      setIsListening(false);
      clearElapsedTimer();

      // iOS Safari force-stops continuous recognition every ~10–15s. If the
      // consumer still wants capture, transparently restart after a short
      // backoff so the user never sees a "stopped listening" state.
      if (!captureEnabledRef.current || fatalErrorRef.current) {
        return;
      }

      clearRestartTimer();
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null;
        if (!captureEnabledRef.current || fatalErrorRef.current) return;
        if (isListeningRef.current) return;
        if (!recognitionRef.current) return;

        try {
          recognitionRef.current.start();
          isListeningRef.current = true;
          setIsListening(true);
          ensureElapsedTimer();
        } catch {
          // start() can throw InvalidStateError if recognition is mid-stop.
          // Leave isListening false; the next onend will retry.
          isListeningRef.current = false;
          setIsListening(false);
        }
      }, RESTART_BACKOFF_MS);
    };

    recognition.onerror = (event) => {
      isListeningRef.current = false;
      setIsListening(false);

      if (FATAL_RECOGNITION_ERRORS.has(event.error)) {
        fatalErrorRef.current = true;
        captureEnabledRef.current = false;
        clearElapsedTimer();
        clearRestartTimer();
      }
      // Non-fatal errors (no-speech, aborted, network) flow through to
      // recognition.onend, where the auto-restart loop above takes over.
    };

    recognitionRef.current = recognition;
    setIsSupported(true);

    return () => {
      recognition.stop();
      clearElapsedTimer();
      clearRestartTimer();
    };
  }, [clearElapsedTimer, clearRestartTimer, ensureElapsedTimer]);

  const resetTranscript = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    setElapsedSeconds(0);
    startTimeRef.current = isListeningRef.current ? Date.now() : null;
  }, []);

  const setCaptureEnabled = useCallback((enabled: boolean) => {
    captureEnabledRef.current = enabled;
    if (enabled) {
      // A fresh capture window means any prior fatal-error latch should be
      // released; the consumer is explicitly opting back in.
      fatalErrorRef.current = false;
    } else {
      // No more auto-restarts once capture is disabled.
      clearRestartTimer();
    }
    setTranscript("");
    setInterimTranscript("");
    setElapsedSeconds(0);
    startTimeRef.current = enabled && isListeningRef.current ? Date.now() : null;
  }, [clearRestartTimer]);

  const startListening = useCallback((options: StartListeningOptions = {}) => {
    if (!recognitionRef.current || isListeningRef.current) {
      return;
    }

    fatalErrorRef.current = false;

    const shouldReset = options.reset ?? true;
    if (shouldReset) {
      resetTranscript();
      startTimeRef.current = Date.now();
    } else if (!startTimeRef.current) {
      startTimeRef.current = Date.now();
    }

    ensureElapsedTimer();

    try {
      recognitionRef.current.start();
      isListeningRef.current = true;
      setIsListening(true);
    } catch {
      isListeningRef.current = false;
      setIsListening(false);
      clearElapsedTimer();
    }
  }, [clearElapsedTimer, ensureElapsedTimer, resetTranscript]);

  const stopListening = useCallback(() => {
    clearRestartTimer();
    recognitionRef.current?.stop();
  }, [clearRestartTimer]);

  const metrics = useMemo<SpeechMetrics>(() => {
    const fullTranscript = `${transcript} ${interimTranscript}`.trim().toLowerCase();
    const fillerWords = FILLER_WORDS.filter((word) =>
      new RegExp(`\\b${escapeRegExp(word)}\\b`).test(fullTranscript)
    );
    const fillerCount = fillerWords.reduce((count, word) => {
      const matches = fullTranscript.match(new RegExp(`\\b${escapeRegExp(word)}\\b`, "g"));
      return count + (matches?.length ?? 0);
    }, 0);
    const words = fullTranscript.split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(elapsedSeconds / 60, 1 / 60);

    return {
      fillerCount,
      fillerWords,
      speakingPace: Math.round(words / minutes)
    };
  }, [elapsedSeconds, interimTranscript, transcript]);

  return {
    isSupported,
    isListening,
    transcript,
    interimTranscript,
    elapsedSeconds,
    metrics,
    startListening,
    stopListening,
    resetTranscript,
    setCaptureEnabled
  };
}
