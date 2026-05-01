# AI Interview Intelligence System  
**Real-time multi-agent evaluation of interview performance**

Built for the OpenAI × Handshake Codex Creator Challenge  

---

## Overview

Most candidates do not fail interviews because of what they say, but how they say it.

This project is a **real-time AI interview system** that evaluates delivery, confidence, and engagement using a **multi-agent architecture**. It combines speech signals, facial behavior, and LLM-based evaluation to produce **structured, actionable feedback** on interview performance.

The system simulates a live interviewer and generates a final hiring-style report with strengths, weaknesses, missed opportunities, and improved responses.

---

## Key Capabilities

The system performs **multi-modal, real-time evaluation** across three signal layers:

- **Speech analysis**: real-time transcription, words-per-minute (WPM), filler detection  
- **Vision analysis**: eye contact, head stability, and emotion estimation from facial landmarks  
- **LLM evaluation**: structured scoring across clarity, relevance, structure, confidence, and engagement  

These signals are combined into a **composite confidence score** and used to generate per-response feedback and a final hiring outcome.

---

## Multi-Agent Architecture

The system is implemented as a **stateless, multi-agent pipeline**, where each agent is responsible for a specific stage of the interview lifecycle.

### Client-side agents
- **Speech Agent**: captures transcript and derives speech metrics  
- **Vision Agent**: computes facial engagement and emotion signals  
- **Confidence Agent**: fuses real-time signals into a continuous confidence score  
- **Scheduling Agent**: manages question sequencing and background prefetch  

### Server-side agents
- **Question Agent**: generates role- and context-aware interview questions  
- **Evaluation Agent**: scores responses and produces structured feedback  
- **Memory Agent**: maintains cross-turn context (strengths, weaknesses, tone)  
- **Finalization Agent**: aggregates all turns into a final report and hiring decision  
- **Voice Agent**: streams interviewer speech using low-latency TTS  

All agents are **stateless and composable**. The full session state is owned by the client and passed to each API route, enabling horizontal scalability and deterministic behavior.

---

## Technical Stack

**AI / Language Models**  
- OpenAI `gpt-4.1-mini`  

**Speech and Audio**  
- ElevenLabs `eleven_turbo_v2_5` for streaming TTS in **practice mode** (`/interview`)  
- **HeyGen LiveAvatar** + **LiveKit** — **live interview** on `/interview/live` (FULL mode; server-minted session token; OpenAI decides each utterance via `/api/heygen/conversation`)  
- Web Speech API for real-time transcription  
- Web Audio API for amplitude analysis and lip-sync (classic avatar)  

**Vision**  
- MediaPipe Face Mesh for real-time facial landmark tracking  

**Frontend / Rendering**  
- Next.js 14 (App Router)  
- React + TypeScript  
- Tailwind CSS  
- Three.js / React Three Fiber (avatar system)

**Architecture**  
- Stateless API routes (no server-side session storage)  
- Client-owned session model  
- Real-time streaming + background prefetch  

---

## Key Design Decisions

- **Multi-agent decomposition**: separates generation, evaluation, and aggregation into independent components  
- **Multi-modal signal fusion**: combines speech, vision, and LLM outputs into unified metrics  
- **Stateless backend**: improves scalability and simplifies testing  
- **Real-time feedback loop**: eliminates post-hoc analysis in favor of live evaluation  

---

## Live HeyGen Avatar (Beta)

Choose **Live interview** or **Practice mode** on the home page: **Live interview** (`/interview/live`) uses **LiveAvatar** over LiveKit instead of the 2D avatar + ElevenLabs (HeyGen’s legacy streaming REST API is sunset; see the [migration guide](https://docs.liveavatar.com/docs/faq/migration-guide)). **Practice mode** (`/interview`) keeps the structured Q&A flow with the 2D avatar and ElevenLabs TTS.

How it differs from the classic flow:

- The interviewer is rendered as a live avatar over **LiveKit**. Configure `LIVEAVATAR_AVATAR_ID` with the avatar **UUID** from [app.liveavatar.com](https://app.liveavatar.com/) (copied from your LiveAvatar account after asset migration).
- OpenAI stays the brain. Every word the avatar speaks is decided by `/api/heygen/conversation` and sent with LiveAvatar **FULL** mode events (`avatar.speak_text` on the `agent-control` topic).
- Free-flow conversation: the orchestrator decides per turn whether to ask a follow-up or move on. Up to **3 main questions** before wrapping up and routing to `/results`. Greetings and follow-ups don't count toward the cap.
- **Barge-in**: the candidate can interrupt the avatar mid-sentence — speech triggers `avatar.interrupt` and re-opens the mic.
- LiveAvatar’s pipeline handles TTS/lip-sync on this route; ElevenLabs is not called.
- All existing scoring, coaching, memory, and final-report logic is reused (each completed main question runs through `evaluateAnswer` + `applyTurnToSession` exactly like the classic flow).

Caveats:

- LiveAvatar sessions are **billed per minute**. Sessions are closed on unmount, `beforeunload`, and `visibilitychange === "hidden"` to reduce leaked sessions.
- Each page load calls `/api/heygen/token`, which creates a LiveAvatar session token and starts the session server-side; the client receives **LiveKit URL + participant token** only (never your API key).
- Set `LIVEAVATAR_API_KEY` server-side. For older setups, `HEYGEN_API_KEY` is still accepted as a fallback **only for the API key** (not for sunset streaming endpoints).

## Environment Variables

Create a `.env.local` file:

```env
OPENAI_API_KEY=your_openai_key
ELEVENLABS_API_KEY=your_elevenlabs_key
# Optional: required only for /interview/live (LiveAvatar). HEYGEN_API_KEY is accepted as fallback.
LIVEAVATAR_API_KEY=your_liveavatar_key
LIVEAVATAR_AVATAR_ID=your_avatar_uuid
```