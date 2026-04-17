import { NextResponse } from "next/server";
import { buildSession, generateQuestion } from "@/lib/interview-engine";
import { SAMPLE_RESUME } from "@/lib/sample-data";
import { JobRole, ResumeMode } from "@/lib/interview-types";

export async function POST(request: Request) {
  const body = (await request.json()) as { role: JobRole; resumeMode: ResumeMode; demoMode?: boolean };
  const resume = body.resumeMode === "Use Sample Resume" ? SAMPLE_RESUME : null;
  const session = buildSession(body.role, body.resumeMode, resume, body.demoMode ?? false);
  const firstQuestion = await generateQuestion({ session });

  session.currentQuestion = firstQuestion;

  return NextResponse.json({ session });
}
