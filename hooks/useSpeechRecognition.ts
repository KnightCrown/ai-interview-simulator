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

const FILLER_WORDS = ["um", "uh", "like", "you know", "actually"];

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
    const fillerWords = FILLER_WORDS.filter((word) => fullTranscript.includes(word));
    const fillerCount = fillerWords.reduce((count, word) => {
      const matches = fullTranscript.match(new RegExp(word, "g"));
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
