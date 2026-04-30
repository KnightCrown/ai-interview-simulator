"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvatarEmotion, deriveAvatarEmotion, estimateSpeechDurationMs, supportsWebGl } from "@/lib/avatar-utils";
import type { InterviewDifficulty } from "@/lib/interview-types";

// Hard cap on total time we will wait for a single ElevenLabs utterance before
// giving up, in case the audio element gets stuck.
const ABSOLUTE_MAX_SPEECH_MS = 90_000;
// When the duration estimate expires but the audio is still playing, recheck after this delay.
const FALLBACK_RECHECK_MS = 1500;
// Max number of pre-fetched audio buffers we keep around. Bounded by the
// worst-case interview length (MAX_SLOTS = 7) so memory cannot grow unbounded.
const AUDIO_BUFFER_CACHE_LIMIT = 7;

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function useInterviewerSpeech(
  elevenLabsVoiceId?: string | null,
  difficulty?: InterviewDifficulty | null
) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [mouthLevel, setMouthLevel] = useState(0);
  const [emotion, setEmotion] = useState<AvatarEmotion>("neutral");
  const [error, setError] = useState<string | null>(null);
  const [webGlSupported, setWebGlSupported] = useState(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterGainRef = useRef<GainNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const pollRef = useRef<number | null>(null);
  const boundaryIntervalRef = useRef<number | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const playbackObjectUrlRef = useRef<string | null>(null);
  const playbackReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  // Map iteration order is insertion order; that gives us a tiny LRU.
  // Key is the trimmed question text, value is the fully-buffered MP3 bytes.
  const audioBufferCacheRef = useRef<Map<string, ArrayBuffer>>(new Map());
  const inflightPrefetchRef = useRef<Map<string, Promise<void>>>(new Map());

  useEffect(() => {
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

  const stopPlaybackAudio = useCallback(() => {
    if (playbackReaderRef.current) {
      void playbackReaderRef.current.cancel().catch(() => {});
      playbackReaderRef.current = null;
    }

    if (playbackAudioRef.current) {
      playbackAudioRef.current.pause();
      playbackAudioRef.current = null;
    }

    if (playbackObjectUrlRef.current) {
      URL.revokeObjectURL(playbackObjectUrlRef.current);
      playbackObjectUrlRef.current = null;
    }
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
    stopPlaybackAudio();

    if (meterGainRef.current && audioContextRef.current) {
      meterGainRef.current.gain.cancelScheduledValues(audioContextRef.current.currentTime);
      meterGainRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime);
    }

    setIsSpeaking(false);
  }, [stopPlaybackAudio, stopPolling]);

  const runSyntheticMouthAnimationLoop = useCallback(() => {
    boundaryIntervalRef.current = window.setInterval(() => {
      if (!meterGainRef.current || !audioContextRef.current) {
        return;
      }

      const target = 0.02 + Math.random() * 0.08;
      meterGainRef.current.gain.cancelScheduledValues(audioContextRef.current.currentTime);
      meterGainRef.current.gain.linearRampToValueAtTime(target, audioContextRef.current.currentTime + 0.03);
      meterGainRef.current.gain.linearRampToValueAtTime(0.01, audioContextRef.current.currentTime + 0.14);
    }, 110);
  }, []);

  const cacheAudioBuffer = useCallback((key: string, buffer: ArrayBuffer) => {
    const cache = audioBufferCacheRef.current;
    cache.delete(key);
    cache.set(key, buffer);
    while (cache.size > AUDIO_BUFFER_CACHE_LIMIT) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
  }, []);

  /**
   * Pre-fetches and buffers the ElevenLabs MP3 for `text` so a later `speak()`
   * for the same text plays instantly with zero ElevenLabs roundtrip.
   *
   * Idempotent: repeat calls for the same text are coalesced into a single
   * in-flight request and the result is reused for the cache.
   */
  const prefetchAudio = useCallback(
    async (text: string, voiceIdOverride?: string | null): Promise<boolean> => {
      const key = text.trim();
      if (!key) return false;

      const voiceId = (voiceIdOverride ?? elevenLabsVoiceId)?.trim();
      if (!voiceId) return false;

      if (audioBufferCacheRef.current.has(key)) {
        return true;
      }

      const inflight = inflightPrefetchRef.current.get(key);
      if (inflight) {
        await inflight;
        return audioBufferCacheRef.current.has(key);
      }

      const fetchPromise = (async () => {
        try {
          const res = await fetch("/api/interview/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: key, voiceId, difficulty: difficulty ?? undefined })
          });
          if (!res.ok) return;
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 0) {
            cacheAudioBuffer(key, buf);
          }
        } catch {
          // Cache miss is harmless: speak() will fall back to live streaming.
        } finally {
          inflightPrefetchRef.current.delete(key);
        }
      })();

      inflightPrefetchRef.current.set(key, fetchPromise);
      await fetchPromise;
      return audioBufferCacheRef.current.has(key);
    },
    [cacheAudioBuffer, difficulty, elevenLabsVoiceId]
  );

  const playBufferedAudio = useCallback(
    async (cleanText: string, buffer: ArrayBuffer): Promise<boolean> => {
      const isDev = process.env.NODE_ENV !== "production";
      const startedAt = isDev ? performance.now() : 0;

      try {
        const blob = new Blob([buffer.slice(0)], { type: "audio/mpeg" });
        const objectUrl = URL.createObjectURL(blob);
        const audio = new Audio();
        audio.src = objectUrl;
        playbackAudioRef.current = audio;
        playbackObjectUrlRef.current = objectUrl;

        await ensureAudioGraph();
        if (!audioContextRef.current || !meterGainRef.current) {
          stopPlaybackAudio();
          return false;
        }

        return await new Promise<boolean>((resolve) => {
          let hasResolved = false;
          let fallbackTimer: number | null = null;
          const startTimestamp = Date.now();
          const estimatedDuration = estimateSpeechDurationMs(cleanText);

          const finish = (wantBrowserFallback: boolean) => {
            if (hasResolved) return;
            hasResolved = true;
            if (fallbackTimer !== null) {
              window.clearTimeout(fallbackTimer);
              fallbackTimer = null;
            }
            stop();
            resolve(!wantBrowserFallback);
          };

          const scheduleFallback = (delay: number) => {
            if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
            fallbackTimer = window.setTimeout(() => {
              const stillPlaying =
                playbackAudioRef.current !== null && !playbackAudioRef.current.paused && !playbackAudioRef.current.ended;
              const elapsed = Date.now() - startTimestamp;
              if (stillPlaying && elapsed < ABSOLUTE_MAX_SPEECH_MS) {
                scheduleFallback(FALLBACK_RECHECK_MS);
                return;
              }
              finish(false);
            }, delay);
          };

          scheduleFallback(estimatedDuration);

          audio.onplay = () => {
            if (isDev) {
              const playStartMs = Math.round(performance.now() - startedAt);
              console.log(`[tts client] cached play_start_ms=${playStartMs}`);
            }
            setIsSpeaking(true);
            startPolling();
            runSyntheticMouthAnimationLoop();
          };

          audio.onended = () => finish(false);
          audio.onerror = () => {
            setError("The voice playback failed.");
            finish(true);
          };

          void audio.play().catch(() => finish(true));
        });
      } catch {
        stopPlaybackAudio();
        return false;
      }
    },
    [ensureAudioGraph, runSyntheticMouthAnimationLoop, startPolling, stop, stopPlaybackAudio]
  );

  const speakWithElevenLabs = useCallback(
    async (cleanText: string, voiceId: string): Promise<boolean> => {
      const isDev = process.env.NODE_ENV !== "production";
      const requestStartedAt = isDev ? performance.now() : 0;

      // Fast path: a prior prefetchAudio() already buffered the bytes.
      const cached = audioBufferCacheRef.current.get(cleanText);
      if (cached) {
        const ok = await playBufferedAudio(cleanText, cached);
        if (ok) return true;
        // Bad cache entry — fall through to live stream and forget it.
        audioBufferCacheRef.current.delete(cleanText);
      }

      try {
        const res = await fetch("/api/interview/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: cleanText, voiceId, difficulty: difficulty ?? undefined })
        });

        if (isDev) {
          const firstChunkMs = Math.round(performance.now() - requestStartedAt);
          console.log(`[tts client] first_chunk_ms=${firstChunkMs} status=${res.status}`);
        }

        if (!res.ok || !res.body) {
          return false;
        }

        const audio = new Audio();
        playbackAudioRef.current = audio;

        // Prefer Media Source Extensions so playback can begin as soon as the first
        // MP3 chunk arrives from the server, instead of waiting for the entire
        // ElevenLabs response to finish before constructing a Blob.
        const canUseMse =
          typeof MediaSource !== "undefined" &&
          typeof MediaSource.isTypeSupported === "function" &&
          MediaSource.isTypeSupported("audio/mpeg");

        if (canUseMse) {
          const mediaSource = new MediaSource();
          const objectUrl = URL.createObjectURL(mediaSource);
          audio.src = objectUrl;
          playbackObjectUrlRef.current = objectUrl;

          const reader = res.body.getReader();
          playbackReaderRef.current = reader;

          mediaSource.addEventListener("sourceopen", async () => {
            let sourceBuffer: SourceBuffer;
            try {
              sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
            } catch (sourceBufferError) {
              console.error("[tts client] addSourceBuffer failed:", sourceBufferError);
              try {
                mediaSource.endOfStream("decode");
              } catch {}
              return;
            }

            const appendChunk = (chunk: Uint8Array) =>
              new Promise<void>((appendResolve, appendReject) => {
                const onUpdateEnd = () => {
                  sourceBuffer.removeEventListener("updateend", onUpdateEnd);
                  sourceBuffer.removeEventListener("error", onError);
                  appendResolve();
                };
                const onError = () => {
                  sourceBuffer.removeEventListener("updateend", onUpdateEnd);
                  sourceBuffer.removeEventListener("error", onError);
                  appendReject(new Error("SourceBuffer append error"));
                };
                sourceBuffer.addEventListener("updateend", onUpdateEnd, { once: true });
                sourceBuffer.addEventListener("error", onError, { once: true });
                try {
                  sourceBuffer.appendBuffer(chunk);
                } catch (err) {
                  sourceBuffer.removeEventListener("updateend", onUpdateEnd);
                  sourceBuffer.removeEventListener("error", onError);
                  appendReject(err as Error);
                }
              });

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  try {
                    mediaSource.endOfStream();
                  } catch {}
                  break;
                }
                if (value && value.byteLength > 0) {
                  await appendChunk(value);
                }
              }
            } catch (pumpError) {
              if ((pumpError as Error)?.name !== "AbortError") {
                console.warn("[tts client] MSE pump aborted:", pumpError);
              }
              try {
                mediaSource.endOfStream("network");
              } catch {}
            } finally {
              if (playbackReaderRef.current === reader) {
                playbackReaderRef.current = null;
              }
            }
          });
        } else {
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);
          audio.src = objectUrl;
          playbackObjectUrlRef.current = objectUrl;
        }

        await ensureAudioGraph();
        if (!audioContextRef.current || !meterGainRef.current) {
          stopPlaybackAudio();
          return false;
        }

        return await new Promise<boolean>((resolve) => {
          let hasResolved = false;
          let fallbackTimer: number | null = null;
          const startTimestamp = Date.now();
          const estimatedDuration = estimateSpeechDurationMs(cleanText);

          const finish = (wantBrowserFallback: boolean) => {
            if (hasResolved) {
              return;
            }

            hasResolved = true;
            if (fallbackTimer !== null) {
              window.clearTimeout(fallbackTimer);
              fallbackTimer = null;
            }
            stop();
            resolve(!wantBrowserFallback);
          };

          const scheduleFallback = (delay: number) => {
            if (fallbackTimer !== null) {
              window.clearTimeout(fallbackTimer);
            }
            fallbackTimer = window.setTimeout(() => {
              const stillPlaying =
                playbackAudioRef.current !== null && !playbackAudioRef.current.paused && !playbackAudioRef.current.ended;
              const elapsed = Date.now() - startTimestamp;

              if (stillPlaying && elapsed < ABSOLUTE_MAX_SPEECH_MS) {
                scheduleFallback(FALLBACK_RECHECK_MS);
                return;
              }

              finish(false);
            }, delay);
          };

          scheduleFallback(estimatedDuration);

          audio.onplay = () => {
            if (isDev) {
              const playStartMs = Math.round(performance.now() - requestStartedAt);
              console.log(`[tts client] play_start_ms=${playStartMs}`);
            }
            setIsSpeaking(true);
            startPolling();
            runSyntheticMouthAnimationLoop();
          };

          audio.onended = () => {
            finish(false);
          };

          audio.onerror = () => {
            setError("The voice playback failed.");
            finish(true);
          };

          void audio.play().catch(() => {
            finish(true);
          });
        });
      } catch {
        stopPlaybackAudio();
        return false;
      }
    },
    [difficulty, ensureAudioGraph, runSyntheticMouthAnimationLoop, startPolling, stop, stopPlaybackAudio]
  );

  const speak = useCallback(
    async (text: string) => {
      const cleanText = text.trim();
      if (!cleanText) {
        return;
      }

      setEmotion(deriveAvatarEmotion(cleanText));
      stop();
      setError(null);

      const voiceId = elevenLabsVoiceId?.trim();
      if (!voiceId) {
        return;
      }

      await speakWithElevenLabs(cleanText, voiceId);
    },
    [elevenLabsVoiceId, speakWithElevenLabs, stop]
  );

  useEffect(() => {
    return () => {
      stop();

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
      webGlSupported,
      lipSyncReady: webGlSupported && !error
    }),
    [error, webGlSupported]
  );

  return {
    error,
    isSpeaking,
    mouthLevel,
    emotion,
    speak,
    prefetchAudio,
    stop,
    status
  };
}
