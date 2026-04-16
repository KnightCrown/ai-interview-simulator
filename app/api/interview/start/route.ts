import { NextResponse } from "next/server";
import { buildSession, generateQuestion } from "@/lib/interview-engine";
import { SAMPLE_RESUME } from "@/lib/sample-data";
import { JobRole, ResumeMode } from "@/lib/interview-types";

export async function POST(request: Request) {
  const body = (await request.json()) as { role: JobRole; resumeMode: ResumeMode };
  const resume = body.resumeMode === "Use Sample Resume" ? SAMPLE_RESUME : null;
  const session = buildSession(body.role, body.resumeMode, resume);
  const firstQuestion = await generateQuestion({
    role: session.role,
    turns: session.turns,
    resume: session.resume
  });

  session.currentQuestion = firstQuestion;

  return NextResponse.json({ session });
}
