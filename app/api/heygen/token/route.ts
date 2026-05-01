import { NextResponse } from "next/server";
import { formatLiveAvatarLogLine, normalizeLiveAvatarLog } from "@/lib/live-avatar-debug";

const LIVEAVATAR_BASE = "https://api.liveavatar.com";

type ApiEnvelope<T> = { code?: number; data?: T | null; message?: string };

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

function logTokenEvent(event: string, details: Record<string, unknown> = {}) {
  console.log(formatLiveAvatarLogLine(normalizeLiveAvatarLog({
    event,
    source: "server-token",
    pathname: "/api/heygen/token",
    details
  })));
}

/**
 * Bootstraps a LiveAvatar FULL session: create session token → start session.
 * Returns LiveKit connection details for the browser (see hooks/useHeyGenAvatar).
 *
 * HeyGen `streaming.create_token` is sunset (410); LiveAvatar uses api.liveavatar.com.
 * @see https://docs.liveavatar.com/docs/faq/migration-guide
 */
export async function POST() {
  logTokenEvent("bootstrap_requested");
  const apiKey = getApiKey();
  if (!apiKey) {
    logTokenEvent("missing_api_key");
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
    logTokenEvent("missing_avatar_id");
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
    logTokenEvent("liveavatar_token_request_sending", { hasAvatarId: !!avatarId });
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
    logTokenEvent("liveavatar_token_request_network_error", {
      error: err instanceof Error ? err.message : "network error"
    });
    return NextResponse.json({ error: "Could not reach LiveAvatar API." }, { status: 502 });
  }

  const tokenText = await tokenRes.text();
  if (!tokenRes.ok) {
    console.error("[liveavatar token] create token failed", tokenRes.status, tokenText.slice(0, 500));
    logTokenEvent("liveavatar_token_request_failed", { status: tokenRes.status, bodyPreview: tokenText.slice(0, 180) });
    return NextResponse.json({ error: "LiveAvatar rejected the session token request." }, { status: 502 });
  }
  logTokenEvent("liveavatar_token_request_ok", { status: tokenRes.status });

  let tokenPayload: ApiEnvelope<{ session_id: string; session_token: string }>;
  try {
    tokenPayload = JSON.parse(tokenText) as ApiEnvelope<{
      session_id: string;
      session_token: string;
    }>;
  } catch {
    logTokenEvent("liveavatar_token_invalid_json");
    return NextResponse.json({ error: "Invalid JSON from LiveAvatar (token)." }, { status: 502 });
  }

  const sessionId = tokenPayload.data?.session_id;
  const sessionToken = tokenPayload.data?.session_token;
  if (!sessionId || !sessionToken) {
    console.error("[liveavatar token] missing session fields", tokenPayload);
    logTokenEvent("liveavatar_token_missing_fields", { hasSessionId: !!sessionId, hasSessionCredential: !!sessionToken });
    return NextResponse.json({ error: "Missing session_id or session_token from LiveAvatar." }, { status: 502 });
  }

  let startRes: Response;
  try {
    logTokenEvent("liveavatar_start_request_sending", { sessionId });
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
    logTokenEvent("liveavatar_start_request_network_error", {
      error: err instanceof Error ? err.message : "network error"
    });
    return NextResponse.json({ error: "Could not reach LiveAvatar API (start)." }, { status: 502 });
  }

  const startText = await startRes.text();
  if (!startRes.ok) {
    console.error("[liveavatar token] start failed", startRes.status, startText.slice(0, 500));
    logTokenEvent("liveavatar_start_request_failed", { status: startRes.status, bodyPreview: startText.slice(0, 180) });
    return NextResponse.json({ error: "LiveAvatar failed to start the session." }, { status: 502 });
  }
  logTokenEvent("liveavatar_start_request_ok", { status: startRes.status });

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
    logTokenEvent("liveavatar_start_invalid_json");
    return NextResponse.json({ error: "Invalid JSON from LiveAvatar (start)." }, { status: 502 });
  }

  const livekitUrl = startPayload.data?.livekit_url;
  const livekitToken = startPayload.data?.livekit_client_token;
  const startedSessionId = startPayload.data?.session_id ?? sessionId;

  if (!livekitUrl || !livekitToken) {
    console.error("[liveavatar token] missing LiveKit fields", startPayload);
    logTokenEvent("liveavatar_start_missing_livekit_fields", {
      hasLivekitUrl: !!livekitUrl,
      hasLivekitCredential: !!livekitToken
    });
    return NextResponse.json({ error: "Missing LiveKit credentials from LiveAvatar." }, { status: 502 });
  }

  logTokenEvent("bootstrap_ready", {
    sessionId: startedSessionId,
    hasLivekitUrl: !!livekitUrl,
    hasLivekitCredential: !!livekitToken
  });
  return NextResponse.json({
    livekitUrl,
    livekitToken,
    sessionId: startedSessionId
  });
}
