import { NextResponse } from "next/server";
import { formatLiveAvatarLogLine, normalizeLiveAvatarLog } from "@/lib/live-avatar-debug";

const LIVEAVATAR_BASE = "https://api.liveavatar.com";

function getApiKey(): string | undefined {
  return (
    process.env.LIVEAVATAR_API_KEY?.trim() ||
    process.env.HEYGEN_API_KEY?.trim() ||
    undefined
  );
}

function logStopEvent(event: string, details: Record<string, unknown> = {}) {
  console.log(formatLiveAvatarLogLine(normalizeLiveAvatarLog({
    event,
    source: "server-stop",
    pathname: "/api/heygen/stop",
    details
  })));
}

/**
 * Stops a LiveAvatar session server-side (API key never sent to browser for this call).
 */
export async function POST(request: Request) {
  logStopEvent("stop_requested");
  const apiKey = getApiKey();
  if (!apiKey) {
    logStopEvent("missing_api_key");
    return NextResponse.json({ error: "Live avatar is not configured." }, { status: 503 });
  }

  let body: { sessionId?: string };
  try {
    body = (await request.json()) as { sessionId?: string };
  } catch {
    logStopEvent("invalid_json");
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) {
    logStopEvent("missing_session_id");
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  try {
    logStopEvent("liveavatar_stop_request_sending", { sessionId });
    const upstream = await fetch(`${LIVEAVATAR_BASE}/v1/sessions/stop`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ session_id: sessionId, reason: "USER_CLOSED" }),
      cache: "no-store"
    });
    if (!upstream.ok) {
      const t = await upstream.text().catch(() => "");
      console.error("[liveavatar stop] failed", upstream.status, t.slice(0, 300));
      logStopEvent("liveavatar_stop_request_failed", { status: upstream.status, bodyPreview: t.slice(0, 180) });
    } else {
      logStopEvent("liveavatar_stop_request_ok", { status: upstream.status });
    }
  } catch (err) {
    console.error("[liveavatar stop] network error", err);
    logStopEvent("liveavatar_stop_request_network_error", {
      error: err instanceof Error ? err.message : "network error"
    });
  }

  return NextResponse.json({ ok: true });
}
