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

export function useSpeechRecognition() {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const isListeningRef = useRef(false);
  const captureEnabledRef = useRef(false);

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

      if (finalText) {
        setTranscript((current) => `${current} ${finalText}`.trim());
      }

      setInterimTranscript(interimText.trim());
    };

    recognition.onend = () => {
      isListeningRef.current = false;
      setIsListening(false);
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    recognition.onerror = () => {
      isListeningRef.current = false;
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    setIsSupported(true);

    return () => {
      recognition.stop();
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
    };
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    setElapsedSeconds(0);
    startTimeRef.current = isListeningRef.current ? Date.now() : null;
  }, []);

  const setCaptureEnabled = useCallback((enabled: boolean) => {
    captureEnabledRef.current = enabled;
    setTranscript("");
    setInterimTranscript("");
    setElapsedSeconds(0);
    startTimeRef.current = enabled && isListeningRef.current ? Date.now() : null;
  }, []);

  const startListening = useCallback((options: StartListeningOptions = {}) => {
    if (!recognitionRef.current || isListeningRef.current) {
      return;
    }

    const shouldReset = options.reset ?? true;
    if (shouldReset) {
      resetTranscript();
      startTimeRef.current = Date.now();
    } else if (!startTimeRef.current) {
      startTimeRef.current = Date.now();
    }

    timerRef.current = window.setInterval(() => {
      if (startTimeRef.current) {
        setElapsedSeconds(Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000)));
      }
    }, 1000);

    try {
      recognitionRef.current.start();
      isListeningRef.current = true;
      setIsListening(true);
    } catch {
      isListeningRef.current = false;
      setIsListening(false);
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [resetTranscript]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

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
