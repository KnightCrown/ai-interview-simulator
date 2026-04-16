# AI Interview Simulator

A production-style Next.js app for practicing AI-guided job interviews with:

- role-based question generation
- live browser transcription with filler-word and pace tracking
- webcam-based engagement scoring with MediaPipe Face Mesh
- per-answer AI evaluation and missed-opportunity detection
- final pass / borderline / fail report

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Optional: add your API key to `.env.local`:

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

3. Start the app:

```bash
npm run dev
```

If no OpenAI key is present, the app uses a local fallback engine so the interview flow still runs.
