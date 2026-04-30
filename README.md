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
- ElevenLabs `eleven_turbo_v2_5` for streaming TTS  
- Web Speech API for real-time transcription  
- Web Audio API for amplitude analysis and lip-sync  

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

## Environment Variables

Create a `.env.local` file:

```env
OPENAI_API_KEY=your_openai_key
ELEVENLABS_API_KEY=your_elevenlabs_key