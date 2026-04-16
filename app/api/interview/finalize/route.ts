import { NextResponse } from "next/server";
import { finalizeInterview } from "@/lib/interview-engine";
import { InterviewSession } from "@/lib/interview-types";

export async function POST(request: Request) {
  const body = (await request.json()) as { session: InterviewSession };
  const report = await finalizeInterview(body.session);
  return NextResponse.json({ report });
}
