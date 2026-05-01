import { NextResponse } from "next/server";

const LIVEAVATAR_BASE = "https://api.liveavatar.com";

function getApiKey(): string | undefined {
  return (
    process.env.LIVEAVATAR_API_KEY?.trim() ||
    process.env.HEYGEN_API_KEY?.trim() ||
    undefined
  );
}

/**
 * Stops a LiveAvatar session server-side (API key never sent to browser for this call).
 */
export async function POST(request: Request) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: "Live avatar is not configured." }, { status: 503 });
  }

  let body: { sessionId?: string };
  try {
    body = (await request.json()) as { sessionId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  try {
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
    }
  } catch (err) {
    console.error("[liveavatar stop] network error", err);
  }

  return NextResponse.json({ ok: true });
}
