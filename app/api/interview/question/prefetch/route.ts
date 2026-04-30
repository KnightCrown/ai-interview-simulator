import { NextResponse } from "next/server";
import { generateQuestion } from "@/lib/interview-engine";
import { InterviewSession } from "@/lib/interview-types";

/**
 * Generates the question text for `targetSlotIndex` based on the slot's kind in
 * `session.schedule`. The client calls this during answer windows so each
 * upcoming question is ready before the candidate finishes the current one.
 *
 * Stateless: the route does NOT mutate or store the session. It returns just
 * the generated question text and the slot index it was generated for. The
 * client is responsible for writing the result back into its local schedule.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { session: InterviewSession; targetSlotIndex: number };

  if (!body.session || typeof body.targetSlotIndex !== "number") {
    return NextResponse.json({ error: "session and targetSlotIndex are required" }, { status: 400 });
  }

  const slot = body.session.schedule?.[body.targetSlotIndex];
  if (!slot) {
    return NextResponse.json(
      { error: `No schedule slot at index ${body.targetSlotIndex}` },
      { status: 400 }
    );
  }

  const question = await generateQuestion({
    session: body.session,
    targetTurnIndex: body.targetSlotIndex,
    slotKind: slot.kind
  });

  return NextResponse.json({ targetSlotIndex: body.targetSlotIndex, question });
}
