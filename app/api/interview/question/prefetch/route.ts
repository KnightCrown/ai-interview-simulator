import { NextResponse } from "next/server";
import { InterviewSession } from "@/lib/interview-types";

/** No-op: next questions are generated only after each answer is submitted. */
export async function POST(request: Request) {
  const body = (await request.json()) as { session: InterviewSession };
  return NextResponse.json({
    session: body.session
  });
}
