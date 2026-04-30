import { NextResponse } from "next/server";
import { isAllowedElevenLabsVoiceId, voiceSettingsForInterviewDifficulty } from "@/lib/elevenlabs-voices";
import type { InterviewDifficulty } from "@/lib/interview-types";

const VALID_DIFFICULTIES: InterviewDifficulty[] = ["Easy", "Medium", "Hard"];

const MAX_TEXT_CHARS = 5000;

export async function POST(request: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "Voice synthesis is not configured." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = typeof (body as { text?: unknown }).text === "string" ? (body as { text: string }).text.trim() : "";
  const voiceId =
    typeof (body as { voiceId?: unknown }).voiceId === "string" ? (body as { voiceId: string }).voiceId.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "Text is required." }, { status: 400 });
  }

  if (text.length > MAX_TEXT_CHARS) {
    return NextResponse.json({ error: "Text is too long." }, { status: 400 });
  }

  if (!voiceId || !isAllowedElevenLabsVoiceId(voiceId)) {
    return NextResponse.json({ error: "Invalid voice." }, { status: 400 });
  }

  const rawDifficulty = (body as { difficulty?: unknown }).difficulty;
  const difficulty: InterviewDifficulty | undefined =
    typeof rawDifficulty === "string" && VALID_DIFFICULTIES.includes(rawDifficulty as InterviewDifficulty)
      ? (rawDifficulty as InterviewDifficulty)
      : undefined;

  const voice_settings = voiceSettingsForInterviewDifficulty(difficulty);

  const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg"
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings
    })
  });

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    if (upstream.status === 402) {
      console.error(
        "ElevenLabs TTS: payment required — library voices via API need a paid ElevenLabs plan. Voice IDs in lib/elevenlabs-voices.ts are unchanged.",
        errText.slice(0, 300)
      );
      return NextResponse.json(
        {
          error:
            "ElevenLabs rejected this request: API access to these library voices requires a paid subscription. Browser speech will be used as fallback."
        },
        { status: 502 }
      );
    }
    console.error("ElevenLabs TTS failed:", upstream.status, errText.slice(0, 200));
    return NextResponse.json({ error: "Voice synthesis failed." }, { status: 502 });
  }

  const buffer = await upstream.arrayBuffer();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store"
    }
  });
}
