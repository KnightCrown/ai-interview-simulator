"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { logLiveAvatarEvent } from "@/lib/live-avatar-client-log";

export type HeyGenAvatarStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "speaking"
  | "error"
  | "disconnected";

export interface UseHeyGenAvatarOptions {
  /** @deprecated Avatar is chosen server-side via LIVEAVATAR_AVATAR_ID; kept for call-site compatibility. */
  avatarId?: string;
  /** Remote avatar video (LiveKit video track). */
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  /** Remote avatar speech (LiveKit audio track). Required for audible TTS; keep unmuted. */
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
}

export interface UseHeyGenAvatarApi {
  status: HeyGenAvatarStatus;
  isSpeaking: boolean;
  error: string | null;
  start: () => Promise<void>;
  speak: (text: string) => Promise<void>;
  interrupt: () => Promise<void>;
  stop: () => Promise<void>;
}

type BootstrapResponse = {
  livekitUrl: string;
  livekitToken: string;
  sessionId: string;
};

function newEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * LiveAvatar FULL mode over LiveKit: token + start from /api/heygen/token,
 * commands on `agent-control`, responses on `agent-response`.
 *
 * @see https://docs.liveavatar.com/docs/full-mode/events
 */
export function useHeyGenAvatar({ videoRef, audioRef }: UseHeyGenAvatarOptions): UseHeyGenAvatarApi {
  const [status, setStatus] = useState<HeyGenAvatarStatus>("idle");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);

  const stop = useCallback(async () => {
    const room = roomRef.current;
    const sessionId = sessionIdRef.current;
    logLiveAvatarEvent("stop_requested", { hasRoom: !!room, hasSessionId: !!sessionId }, "avatar-hook");
    roomRef.current = null;
    sessionIdRef.current = null;
    startedRef.current = false;
    if (room) {
      try {
        await room.disconnect();
        logLiveAvatarEvent("livekit_disconnected", {}, "avatar-hook");
      } catch {
        // ignore
      }
    }

    if (sessionId) {
      try {
        await fetch("/api/heygen/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId })
        });
        logLiveAvatarEvent("stop_sent_to_liveavatar", { sessionId }, "avatar-hook");
      } catch {
        // best-effort
      }
    }

    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {
        /* noop */
      }
    }
    if (audioRef.current) {
      try {
        audioRef.current.srcObject = null;
      } catch {
        /* noop */
      }
    }
    setIsSpeaking(false);
    setStatus("disconnected");
    logLiveAvatarEvent("status", { status: "disconnected" }, "avatar-hook");
  }, [audioRef, videoRef]);

  const start = useCallback(async () => {
    if (startedRef.current) {
      logLiveAvatarEvent("start_ignored_already_started", {}, "avatar-hook");
      return;
    }
    startedRef.current = true;
    setStatus("connecting");
    setError(null);
    logLiveAvatarEvent("start_requested", {}, "avatar-hook");

    let bootstrap: BootstrapResponse;
    try {
      logLiveAvatarEvent("token_request_sent", {}, "avatar-hook");
      const res = await fetch("/api/heygen/token", { method: "POST" });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || `Session bootstrap failed (${res.status})`);
      }
      const data = (await res.json()) as Partial<BootstrapResponse>;
      if (!data.livekitUrl || !data.livekitToken || !data.sessionId) {
        throw new Error("Missing LiveKit or session fields from server.");
      }
      bootstrap = data as BootstrapResponse;
      logLiveAvatarEvent("token_received", {
        sessionId: bootstrap.sessionId,
        hasLivekitUrl: !!bootstrap.livekitUrl,
        hasLivekitCredential: !!bootstrap.livekitToken
      }, "avatar-hook");
    } catch (err) {
      startedRef.current = false;
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to start live avatar session.");
      logLiveAvatarEvent("start_failed", {
        error: err instanceof Error ? err.message : "Failed to start live avatar session."
      }, "avatar-hook");
      return;
    }

    sessionIdRef.current = bootstrap.sessionId;

    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const onData = (payload: Uint8Array, _participant: unknown, _kind: unknown, topic?: string) => {
      if (topic !== "agent-response") return;
      let msg: { event_type?: string };
      try {
        msg = JSON.parse(new TextDecoder().decode(payload)) as { event_type?: string };
      } catch {
        return;
      }
      if (msg.event_type === "avatar.speak_started") {
        setIsSpeaking(true);
        setStatus("speaking");
        logLiveAvatarEvent("avatar_speak_started", {}, "avatar-hook");
      }
      if (msg.event_type === "avatar.speak_ended") {
        setIsSpeaking(false);
        setStatus((current) => (current === "speaking" ? "ready" : current));
        logLiveAvatarEvent("avatar_speak_ended", {}, "avatar-hook");
      }
      if (msg.event_type === "session.stopped") {
        setStatus("disconnected");
        setIsSpeaking(false);
        logLiveAvatarEvent("session_stopped_event", {}, "avatar-hook");
      }
    };

    const attachRemoteVideo = (track: { attach: (el: HTMLVideoElement) => void }) => {
      const el = videoRef.current;
      if (!el) return;
      try {
        track.attach(el);
        void el.play().catch(() => {
          /* autoplay may wait for gesture */
        });
      } catch {
        /* noop */
      }
      setStatus("ready");
      logLiveAvatarEvent("remote_video_attached", {}, "avatar-hook");
    };

    const attachRemoteAudio = (track: { attach: (el: HTMLAudioElement) => void }) => {
      const el = audioRef.current;
      if (!el) return;
      try {
        track.attach(el);
        el.muted = false;
        el.volume = 1;
        void room.startAudio().catch(() => {
          logLiveAvatarEvent("audio_start_blocked", {}, "avatar-hook");
          /* browser may still block until a gesture */
        });
        void el.play().catch(() => {
          logLiveAvatarEvent("audio_play_blocked", {}, "avatar-hook");
          /* often resolved after room.startAudio() */
        });
        logLiveAvatarEvent("remote_audio_attached", {}, "avatar-hook");
      } catch {
        /* noop */
      }
    };

    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.TrackSubscribed, (track, publication) => {
      if (!track) return;
      logLiveAvatarEvent("track_subscribed", { kind: publication.kind }, "avatar-hook");
      if (publication.kind === Track.Kind.Video) {
        attachRemoteVideo(track);
      }
      if (publication.kind === Track.Kind.Audio) {
        attachRemoteAudio(track);
      }
    });
    room.on(RoomEvent.Disconnected, () => {
      setStatus("disconnected");
      setIsSpeaking(false);
      logLiveAvatarEvent("livekit_disconnected_event", {}, "avatar-hook");
    });

    try {
      logLiveAvatarEvent("livekit_connecting", {}, "avatar-hook");
      await room.connect(bootstrap.livekitUrl, bootstrap.livekitToken);
      logLiveAvatarEvent("livekit_connected", {}, "avatar-hook");
      try {
        await room.startAudio();
        logLiveAvatarEvent("audio_start_requested", {}, "avatar-hook");
      } catch {
        logLiveAvatarEvent("audio_start_blocked", {}, "avatar-hook");
        /* autoplay policy: audio may stay blocked until a later gesture */
      }
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          if (!publication.isSubscribed || !publication.track) return;
          if (publication.kind === Track.Kind.Video) {
            attachRemoteVideo(publication.track);
          }
          if (publication.kind === Track.Kind.Audio) {
            attachRemoteAudio(publication.track);
          }
        });
      });
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "LiveKit connection failed.");
      logLiveAvatarEvent("livekit_connect_failed", {
        error: err instanceof Error ? err.message : "LiveKit connection failed."
      }, "avatar-hook");
      try {
        await room.disconnect();
      } catch {
        /* noop */
      }
      roomRef.current = null;
      sessionIdRef.current = null;
      startedRef.current = false;
    }
  }, [audioRef, videoRef]);

  const publishControl = useCallback(async (body: Record<string, unknown>) => {
    const room = roomRef.current;
    const sessionId = sessionIdRef.current;
    if (!room || !sessionId) {
      logLiveAvatarEvent("control_not_sent_no_session", { eventType: body.event_type }, "avatar-hook");
      return;
    }
    const payload = {
      event_id: newEventId(),
      session_id: sessionId,
      source_event_id: null,
      ...body
    };
    logLiveAvatarEvent("control_sending", { eventType: body.event_type }, "avatar-hook");
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
      reliable: true,
      topic: "agent-control"
    });
    logLiveAvatarEvent("control_sent", { eventType: body.event_type }, "avatar-hook");
  }, []);

  const speak = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      try {
        logLiveAvatarEvent("avatar_speak_text_requested", {
          textLength: trimmed.length,
          textPreview: trimmed.slice(0, 120)
        }, "avatar-hook");
        await publishControl({ event_type: "avatar.speak_text", text: trimmed });
      } catch (err) {
        setError(err instanceof Error ? err.message : "avatar.speak_text failed.");
        logLiveAvatarEvent("avatar_speak_text_failed", {
          error: err instanceof Error ? err.message : "avatar.speak_text failed."
        }, "avatar-hook");
      }
    },
    [publishControl]
  );

  const interrupt = useCallback(async () => {
    try {
      logLiveAvatarEvent("interrupt_requested", {}, "avatar-hook");
      await publishControl({ event_type: "avatar.interrupt" });
    } catch {
      /* ignore */
    }
  }, [publishControl]);

  useEffect(() => {
    const onBeforeUnload = () => {
      void stop();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void stop();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void stop();
    };
  }, [stop]);

  return { status, isSpeaking, error, start, speak, interrupt, stop };
}
