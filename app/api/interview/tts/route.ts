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

  const isDev = process.env.NODE_ENV !== "production";
  const startedAt = isDev ? performance.now() : 0;

  const upstreamUrl =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream` +
    `?optimize_streaming_latency=3&output_format=mp3_44100_128`;

  const upstream = await fetch(upstreamUrl, {
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

  if (isDev) {
    const ttfbMs = Math.round(performance.now() - startedAt);
    console.log(`[elevenlabs] ttfb_ms=${ttfbMs} status=${upstream.status} chars=${text.length}`);
  }

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

  if (!upstream.body) {
    console.error("ElevenLabs TTS: upstream response had no body to stream.");
    return NextResponse.json({ error: "Voice synthesis failed." }, { status: 502 });
  }

  // Forward the upstream MP3 stream directly to the client so the browser can
  // start decoding/playing as soon as the first chunks arrive, instead of waiting
  // for ElevenLabs to finish producing the full file.
  const passthrough = isDev ? withCompletionLog(upstream.body, startedAt) : upstream.body;

  return new NextResponse(passthrough, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
      "Transfer-Encoding": "chunked"
    }
  });
}

function withCompletionLog(body: ReadableStream<Uint8Array>, startedAt: number) {
  let bytes = 0;
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
    flush() {
      const totalMs = Math.round(performance.now() - startedAt);
      console.log(`[elevenlabs] total_ms=${totalMs} bytes=${bytes}`);
    }
  });

  return body.pipeThrough(transform);
}
