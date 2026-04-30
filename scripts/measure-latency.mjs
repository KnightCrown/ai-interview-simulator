// One-off latency measurement for OpenAI and ElevenLabs.
// Runs each call N times and prints min/median/p90/avg in ms.
// Usage:  node --env-file=.env.local scripts/measure-latency.mjs

import OpenAI from "openai";

const N = 3;

const SAMPLE_TRANSCRIPT =
  "I led the API redesign for the payments service. We were seeing 4 percent error rates in production " +
  "during peak load, so I split the legacy monolithic endpoint into three smaller services, introduced a " +
  "rate-limiter at the gateway, and added structured logging end to end. After the rollout, error rates " +
  "dropped to under 0.5 percent and median latency improved by about 35 percent. The team adopted the new " +
  "pattern across two more services in the following quarter.";

function buildEvaluatePrompt() {
  return `
You are grading a Software Engineer interview answer.
Return strict JSON with keys:
clarity, relevance, structure, confidence, engagement, liveConfidence, feedback, missedOpportunity, missingResumeHighlights, missedOpportunityDetails, improvedAnswer, rewriteHighlights, interviewerReaction, perceivedTone, pressureLabel
Return only a JSON object. Do not wrap it in markdown.
Difficulty calibration: Medium - realistic and professionally skeptical.
Memory: ${JSON.stringify({ strictness: 62, weakAreas: [], strengthSignals: [] })}
Candidate resume context: null
Previous turns: []
Transcript: ${SAMPLE_TRANSCRIPT}
Speech metrics: ${JSON.stringify({ fillerCount: 1, fillerWords: ["um"], speakingPace: 128 })}
Face metrics: ${JSON.stringify({ eyeContact: 80, headStability: 78, engagementScore: 82, emotion: { happy: 14, sad: 8, nervous: 12, dominant: "neutral" } })}
Candidate apparent facial demeanor during this answer: ${JSON.stringify({ dominant: "neutral", averages: { happy: 14, sad: 8, nervous: 12 }, framesSampled: 30 })}
Interview difficulty: Medium
Role expectations: ${JSON.stringify(["system design", "ownership", "measurable impact"])}
`;
}

function buildQuestionPrompt() {
  return `
You are an interviewer running a realistic Software Engineer interview at Medium difficulty.
Generate exactly one concise interview question for question 2 of 5.
Avoid greeting or reintroducing yourself. Probe deeper on the candidate's previous answer.
Candidate's most recent answer: ${JSON.stringify(SAMPLE_TRANSCRIPT)}
Memory: ${JSON.stringify({ strictness: 62, weakAreas: [], strengthSignals: [] })}
Resume / CV context: null
`;
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return { min: sorted[0], median, p90, max: sorted[sorted.length - 1], avg: Math.round(avg) };
}

function fmt(label, samples) {
  const s = stats(samples);
  console.log(
    `${label.padEnd(36)} runs=${samples.length}  min=${Math.round(s.min)}ms  ` +
      `median=${Math.round(s.median)}ms  p90=${Math.round(s.p90)}ms  max=${Math.round(s.max)}ms  avg=${s.avg}ms`
  );
}

async function timeOpenAi(client, label, prompt) {
  const samples = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await client.responses.create({ model: "gpt-4.1-mini", input: prompt });
    samples.push(performance.now() - t0);
  }
  fmt(`openai gpt-4.1-mini ${label}`, samples);
  return samples;
}

async function timeElevenLabs(label, urlBuilder, apiKey) {
  const ttfb = [];
  const total = [];
  const text = "Walk me through the tradeoff that mattered most when you owned that migration plan.";
  const voiceId = "AwMZtPh74zNy5MWrczpG"; // Cheery female interviewer
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    const res = await fetch(urlBuilder(voiceId), {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.3, similarity_boost: 0.8 }
      })
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`ElevenLabs ${label} failed: ${res.status} ${err.slice(0, 200)}`);
      return;
    }
    const tHeaders = performance.now() - t0;
    ttfb.push(tHeaders);
    const buf = await res.arrayBuffer();
    total.push(performance.now() - t0);
  }
  fmt(`elevenlabs ${label} ttfb`, ttfb);
  fmt(`elevenlabs ${label} total`, total);
}

async function main() {
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  const elevenKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!openAiKey) {
    console.error("OPENAI_API_KEY missing");
    process.exit(1);
  }
  if (!elevenKey) {
    console.error("ELEVENLABS_API_KEY missing");
    process.exit(1);
  }

  const client = new OpenAI({ apiKey: openAiKey });

  console.log(`\n--- OpenAI (gpt-4.1-mini, runs=${N}) ---`);
  const evalSamples = await timeOpenAi(client, "evaluateAnswer-shape", buildEvaluatePrompt());
  const qSamples = await timeOpenAi(client, "generateQuestion-shape", buildQuestionPrompt());

  console.log(`\n--- ElevenLabs (eleven_turbo_v2_5, runs=${N}) ---`);
  await timeElevenLabs(
    "non-stream (current)",
    (id) => `https://api.elevenlabs.io/v1/text-to-speech/${id}`,
    elevenKey
  );
  await timeElevenLabs(
    "stream optimize=3 (new)",
    (id) =>
      `https://api.elevenlabs.io/v1/text-to-speech/${id}/stream` +
      `?optimize_streaming_latency=3&output_format=mp3_44100_128`,
    elevenKey
  );

  const combinedSequential = stats(evalSamples.map((v, i) => v + qSamples[i]));
  const combinedParallel = stats(evalSamples.map((v, i) => Math.max(v, qSamples[i])));
  console.log(`\n--- OpenAI combined: sequential vs parallel ---`);
  console.log(
    `sequential (today)                   median=${Math.round(combinedSequential.median)}ms  avg=${combinedSequential.avg}ms`
  );
  console.log(
    `parallel (after refactor)            median=${Math.round(combinedParallel.median)}ms  avg=${combinedParallel.avg}ms  ` +
      `savings=${Math.round(combinedSequential.median - combinedParallel.median)}ms (median)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
