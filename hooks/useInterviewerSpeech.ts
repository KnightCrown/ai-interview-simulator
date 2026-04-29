"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvatarEmotion, deriveAvatarEmotion, supportsWebGl } from "@/lib/avatar-utils";

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function useInterviewerSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [mouthLevel, setMouthLevel] = useState(0);
  const [emotion, setEmotion] = useState<AvatarEmotion>("neutral");
  const [error, setError] = useState<string | null>(null);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [webGlSupported, setWebGlSupported] = useState(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterGainRef = useRef<GainNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const pollRef = useRef<number | null>(null);
  const boundaryIntervalRef = useRef<number | null>(null);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setSpeechSupported(typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
    setWebGlSupported(supportsWebGl());
  }, []);

  const clearBoundaryInterval = () => {
    if (boundaryIntervalRef.current !== null) {
      window.clearInterval(boundaryIntervalRef.current);
      boundaryIntervalRef.current = null;
    }
  };

  const startPolling = useCallback(() => {
    if (!analyserRef.current) {
      return;
    }

    const analyser = analyserRef.current;
    const buffer = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteTimeDomainData(buffer);
      let sumSquares = 0;

      for (const value of buffer) {
        const normalized = value / 128 - 1;
        sumSquares += normalized * normalized;
      }

      const rms = Math.sqrt(sumSquares / buffer.length);
      setMouthLevel(clamp(rms * 10));
      pollRef.current = window.requestAnimationFrame(tick);
    };

    if (pollRef.current === null) {
      pollRef.current = window.requestAnimationFrame(tick);
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.cancelAnimationFrame(pollRef.current);
      pollRef.current = null;
    }

    setMouthLevel(0);
  }, []);

  const ensureAudioGraph = useCallback(async () => {
    if (audioContextRef.current && analyserRef.current && meterGainRef.current && oscillatorRef.current) {
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      setError("Web Audio API is not available in this browser.");
      return;
    }

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const meterGain = context.createGain();
    const analyser = context.createAnalyser();
    const silentGain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 180;
    meterGain.gain.value = 0;
    analyser.fftSize = 64;
    silentGain.gain.value = 0;

    oscillator.connect(meterGain);
    meterGain.connect(analyser);
    analyser.connect(silentGain);
    silentGain.connect(context.destination);
    oscillator.start();

    audioContextRef.current = context;
    oscillatorRef.current = oscillator;
    meterGainRef.current = meterGain;
    analyserRef.current = analyser;
    silentGainRef.current = silentGain;
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    clearBoundaryInterval();
    stopPolling();

    if (meterGainRef.current && audioContextRef.current) {
      meterGainRef.current.gain.cancelScheduledValues(audioContextRef.current.currentTime);
      meterGainRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime);
    }

    currentUtteranceRef.current = null;
    setIsSpeaking(false);
  }, [stopPolling]);

  const speak = useCallback(
    async (text: string) => {
      const cleanText = text.trim();
      if (!cleanText) {
        return;
      }

      setEmotion(deriveAvatarEmotion(cleanText));

      const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
      if (!canSpeak) {
        return;
      }
      setSpeechSupported(true);

      await ensureAudioGraph();
      if (!audioContextRef.current || !meterGainRef.current) {
        return;
      }

      stop();
      setError(null);

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.lang = "en-US";

      const availableVoices = window.speechSynthesis.getVoices();
      const preferredVoice =
        availableVoices.find((voice) => voice.lang.startsWith("en") && /female|samantha|aria|jenny|zira/i.test(voice.name)) ??
        availableVoices.find((voice) => voice.lang.startsWith("en")) ??
        null;

      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      return new Promise<void>((resolve) => {
        let hasResolved = false;
        let fallbackTimer: number | null = null;
        const estimatedDuration = Math.min(14000, Math.max(2600, cleanText.split(/\s+/).length * 420));
        const finish = () => {
          if (hasResolved) {
            return;
          }

          hasResolved = true;
          if (fallbackTimer !== null) {
            window.clearTimeout(fallbackTimer);
          }
          stop();
          resolve();
        };
        fallbackTimer = window.setTimeout(finish, estimatedDuration);

        utterance.onstart = () => {
          setIsSpeaking(true);
          startPolling();

          boundaryIntervalRef.current = window.setInterval(() => {
            if (!meterGainRef.current || !audioContextRef.current) {
              return;
            }

            const target = 0.02 + Math.random() * 0.08;
            meterGainRef.current.gain.cancelScheduledValues(audioContextRef.current.currentTime);
            meterGainRef.current.gain.linearRampToValueAtTime(target, audioContextRef.current.currentTime + 0.03);
            meterGainRef.current.gain.linearRampToValueAtTime(0.01, audioContextRef.current.currentTime + 0.14);
          }, 110);
        };

        utterance.onboundary = () => {
          if (!meterGainRef.current || !audioContextRef.current) {
            return;
          }

          const target = 0.04 + Math.random() * 0.09;
          meterGainRef.current.gain.cancelScheduledValues(audioContextRef.current.currentTime);
          meterGainRef.current.gain.linearRampToValueAtTime(target, audioContextRef.current.currentTime + 0.02);
          meterGainRef.current.gain.linearRampToValueAtTime(0.012, audioContextRef.current.currentTime + 0.12);
        };

        utterance.onend = () => {
          finish();
        };

        utterance.onerror = () => {
          setError("The browser voice engine could not speak this response.");
          finish();
        };

        currentUtteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
        window.speechSynthesis.resume();
      });
    },
    [ensureAudioGraph, startPolling, stop]
  );

  useEffect(() => {
    const handleVoicesChanged = () => {
      setSpeechSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    };

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);
    }

    return () => {
      stop();

      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      }

      if (oscillatorRef.current) {
        oscillatorRef.current.stop();
      }

      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
    };
  }, [stop]);

  const status = useMemo(
    () => ({
      speechSupported,
      webGlSupported,
      lipSyncReady: speechSupported && webGlSupported && !error
    }),
    [error, speechSupported, webGlSupported]
  );

  return {
    error,
    isSpeaking,
    mouthLevel,
    emotion,
    speak,
    stop,
    status
  };
}
