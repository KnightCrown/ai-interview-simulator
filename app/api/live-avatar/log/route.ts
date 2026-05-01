import { NextResponse } from "next/server";
import {
  formatLiveAvatarLogLine,
  normalizeLiveAvatarLog,
  type LiveAvatarLogInput
} from "@/lib/live-avatar-debug";

export async function POST(request: Request) {
  let body: LiveAvatarLogInput;

  try {
    body = (await request.json()) as LiveAvatarLogInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  console.log(formatLiveAvatarLogLine(normalizeLiveAvatarLog(body)));
  return NextResponse.json({ ok: true });
}
