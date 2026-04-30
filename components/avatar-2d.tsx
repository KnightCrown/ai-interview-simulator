"use client";

import { memo, useRef } from "react";
import type { AvatarEmotion } from "@/lib/avatar-utils";
import { avatarPersonaForVoice, type AvatarPersona } from "@/lib/elevenlabs-voices";

const MOUTH_OPEN_THRESHOLD = 0.12;
const HOLD_OPEN_MS = 70;

type AvatarImagePair = { neutral: string; open: string };

const PERSONA_IMAGES: Record<AvatarPersona, AvatarImagePair> = {
  jake:  { neutral: "/avatar/jake-neutral.png",  open: "/avatar/jake-open.png"  },
  mia:   { neutral: "/avatar/mia-neutral.png",   open: "/avatar/mia-open.png"   },
  clyde: { neutral: "/avatar/clyde-neutral.png", open: "/avatar/clyde-open.png" }
};

export type Avatar2DProps = {
  className?: string;
  mouthLevel: number;
  emotion: AvatarEmotion;
  isSpeaking: boolean;
  compact?: boolean;
  onClick?: () => void;
  title?: string;
  showLabels?: boolean;
  voiceId?: string | null;
};

// Pure, testable frame selector. Keeps the open frame on screen for at least
// `holdMs` after the last above-threshold sample so rapid amplitude dips during
// a single phoneme do not strobe the image.
export function pickAvatarFrame({
  mouthLevel,
  isSpeaking,
  lastOpenAt,
  now,
  threshold = MOUTH_OPEN_THRESHOLD,
  holdMs = HOLD_OPEN_MS
}: {
  mouthLevel: number;
  isSpeaking: boolean;
  lastOpenAt: number;
  now: number;
  threshold?: number;
  holdMs?: number;
}): { isOpen: boolean; nextLastOpenAt: number } {
  if (!isSpeaking) {
    return { isOpen: false, nextLastOpenAt: lastOpenAt };
  }

  const above = mouthLevel > threshold;
  if (above) {
    return { isOpen: true, nextLastOpenAt: now };
  }

  const stillHolding = now - lastOpenAt < holdMs;
  return { isOpen: stillHolding, nextLastOpenAt: lastOpenAt };
}

export const Avatar2D = memo(function Avatar2D({
  className = "",
  mouthLevel,
  isSpeaking,
  compact = false,
  onClick,
  title,
  showLabels = true,
  voiceId
}: Avatar2DProps) {
  const lastOpenAtRef = useRef(0);
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { isOpen, nextLastOpenAt } = pickAvatarFrame({
    mouthLevel,
    isSpeaking,
    lastOpenAt: lastOpenAtRef.current,
    now
  });
  lastOpenAtRef.current = nextLastOpenAt;

  const persona = avatarPersonaForVoice(voiceId);
  const images = PERSONA_IMAGES[persona];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={title ?? "AI interviewer"}
      className={`relative overflow-hidden rounded-[1.8rem] border border-slate-200 bg-slate-950 text-left shadow-panel ${onClick ? "" : "cursor-default"} ${className}`}
    >
      <div className={compact ? "relative h-full min-h-[180px] w-full" : "relative h-full min-h-[360px] w-full"}>
        {/* Base (mouth closed) frame — always visible */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images.neutral}
          alt=""
          aria-hidden="true"
          loading="eager"
          decoding="sync"
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
        />
        {/* Mouth-open overlay — fades in when audio amplitude crosses threshold */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images.open}
          alt=""
          aria-hidden="true"
          loading="eager"
          decoding="sync"
          draggable={false}
          style={{ opacity: isOpen ? 1 : 0 }}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
        />

        {showLabels ? (
          <div className="absolute left-4 top-4 z-10">
            <div className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-100 backdrop-blur">
              {title ?? "AI interviewer"}
            </div>
            <div className="mt-2 rounded-full bg-white/10 px-3 py-1 text-xs text-slate-200 backdrop-blur">
              {isSpeaking ? "Speaking live" : "Listening"}
            </div>
          </div>
        ) : null}
      </div>
    </button>
  );
});
