import { NextResponse } from "next/server";
import { detectLiveAvatarCreditsExhausted } from "@/lib/liveavatar-credits";

const LIVEAVATAR_BASE = "https://api.liveavatar.com";

type ApiEnvelope<T> = { code?: number; data?: T | null; message?: string };

function jsonErrorFromLiveAvatar(bodyText: string, fallback: string): string {
  try {
    const parsed = JSON.parse(bodyText) as ApiEnvelope<unknown> & { error?: string };
    const fromMsg = typeof parsed.message === "string" ? parsed.message.trim() : "";
    if (fromMsg) return fromMsg;
    const fromErr = typeof parsed.error === "string" ? parsed.error.trim() : "";
    if (fromErr) return fromErr;
  } catch {
    /* use fallback */
  }
  return fallback;
}

function getApiKey(): string | undefined {
  return (
    process.env.LIVEAVATAR_API_KEY?.trim() ||
    process.env.HEYGEN_API_KEY?.trim() ||
    undefined
  );
}

function getAvatarId(): string | undefined {
  return (
    process.env.LIVEAVATAR_AVATAR_ID?.trim() ||
    process.env.HEYGEN_AVATAR_ID?.trim() ||
    undefined
  );
}

/**
 * Bootstraps a LiveAvatar FULL session: create session token → start session.
 * Returns LiveKit connection details for the browser (see hooks/useHeyGenAvatar).
 *
 * HeyGen `streaming.create_token` is sunset (410); LiveAvatar uses api.liveavatar.com.
 * @see https://docs.liveavatar.com/docs/faq/migration-guide
 */
export async function POST() {
  const apiKey = getApiKey();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Live avatar is not configured. Set LIVEAVATAR_API_KEY (or legacy HEYGEN_API_KEY) in .env.local."
      },
      { status: 503 }
    );
  }

  const avatarId = getAvatarId();
  if (!avatarId) {
    return NextResponse.json(
      {
        error:
          "Set LIVEAVATAR_AVATAR_ID to your avatar UUID from app.liveavatar.com (legacy HeyGen numeric ids are not accepted)."
      },
      { status: 503 }
    );
  }

  let tokenRes: Response;
  try {
    tokenRes = await fetch(`${LIVEAVATAR_BASE}/v1/sessions/token`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mode: "FULL",
        avatar_id: avatarId,
        avatar_persona: {},
        video_settings: { quality: "high", encoding: "H264" }
      }),
      cache: "no-store"
    });
  } catch (err) {
    console.error("[liveavatar token] network error (create token)", err);
    return NextResponse.json({ error: "Could not reach LiveAvatar API." }, { status: 502 });
  }

  const tokenText = await tokenRes.text();
  if (!tokenRes.ok) {
    console.error("[liveavatar token] create token failed", tokenRes.status, tokenText.slice(0, 500));
    const creditExhausted = detectLiveAvatarCreditsExhausted(tokenRes.status, tokenText);
    const message = jsonErrorFromLiveAvatar(tokenText, "LiveAvatar rejected the session token request.");
    return NextResponse.json(
      {
        error: creditExhausted ? "Live interviewer AI credits are temporarily unavailable." : message,
        creditExhausted
      },
      { status: creditExhausted ? 402 : 502 }
    );
  }

  let tokenPayload: ApiEnvelope<{ session_id: string; session_token: string }>;
  try {
    tokenPayload = JSON.parse(tokenText) as ApiEnvelope<{
      session_id: string;
      session_token: string;
    }>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON from LiveAvatar (token)." }, { status: 502 });
  }

  const sessionId = tokenPayload.data?.session_id;
  const sessionToken = tokenPayload.data?.session_token;
  if (!sessionId || !sessionToken) {
    console.error("[liveavatar token] missing session fields", tokenPayload);
    return NextResponse.json({ error: "Missing session_id or session_token from LiveAvatar." }, { status: 502 });
  }

  let startRes: Response;
  try {
    startRes = await fetch(`${LIVEAVATAR_BASE}/v1/sessions/start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json"
      },
      cache: "no-store"
    });
  } catch (err) {
    console.error("[liveavatar token] network error (start)", err);
    return NextResponse.json({ error: "Could not reach LiveAvatar API (start)." }, { status: 502 });
  }

  const startText = await startRes.text();
  if (!startRes.ok) {
    console.error("[liveavatar token] start failed", startRes.status, startText.slice(0, 500));
    const creditExhausted = detectLiveAvatarCreditsExhausted(startRes.status, startText);
    const message = jsonErrorFromLiveAvatar(startText, "LiveAvatar failed to start the session.");
    return NextResponse.json(
      {
        error: creditExhausted ? "Live interviewer AI credits are temporarily unavailable." : message,
        creditExhausted
      },
      { status: creditExhausted ? 402 : 502 }
    );
  }

  let startPayload: ApiEnvelope<{
    session_id: string;
    livekit_url: string;
    livekit_client_token: string;
  }>;
  try {
    startPayload = JSON.parse(startText) as ApiEnvelope<{
      session_id: string;
      livekit_url: string;
      livekit_client_token: string;
    }>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON from LiveAvatar (start)." }, { status: 502 });
  }

  const livekitUrl = startPayload.data?.livekit_url;
  const livekitToken = startPayload.data?.livekit_client_token;
  const startedSessionId = startPayload.data?.session_id ?? sessionId;

  if (!livekitUrl || !livekitToken) {
    console.error("[liveavatar token] missing LiveKit fields", startPayload);
    return NextResponse.json({ error: "Missing LiveKit credentials from LiveAvatar." }, { status: 502 });
  }

  return NextResponse.json({
    livekitUrl,
    livekitToken,
    sessionId: startedSessionId
  });
}
