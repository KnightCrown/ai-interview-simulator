import { NextResponse } from "next/server";
import { buildSession, generateQuestion } from "@/lib/interview-engine";
import { pickRandomInterviewerVoiceId } from "@/lib/elevenlabs-voices";
import { SAMPLE_RESUME } from "@/lib/sample-data";
import { InterviewDifficulty, JobRole, ResumeMode } from "@/lib/interview-types";

const DIFFICULTIES: InterviewDifficulty[] = ["Easy", "Medium", "Hard"];

export async function POST(request: Request) {
  const body = (await request.json()) as { role: JobRole; difficulty?: InterviewDifficulty; resumeMode: ResumeMode };
  const role = typeof body.role === "string" ? body.role.trim() : "";
  const difficulty = DIFFICULTIES.includes(body.difficulty ?? "Medium") ? body.difficulty ?? "Medium" : "Medium";

  if (!role) {
    return NextResponse.json({ error: "Job role is required." }, { status: 400 });
  }

  const resume = body.resumeMode === "Use Sample Resume" ? SAMPLE_RESUME : null;
  const elevenLabsVoiceId = pickRandomInterviewerVoiceId();
  const session = buildSession(role, difficulty, body.resumeMode, resume, elevenLabsVoiceId);
  const firstQuestion = await generateQuestion({ session, targetTurnIndex: 0 });

  session.currentQuestion = firstQuestion;

  return NextResponse.json({ session });
}
