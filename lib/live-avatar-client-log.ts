import type { LiveAvatarLogDetails } from "@/lib/live-avatar-debug";

/** Retained for call-site compatibility; live-avatar debug logging was removed. */
export function logLiveAvatarEvent(
  _event: string,
  _details: LiveAvatarLogDetails = {},
  _source = "client"
): void {
  /* no-op */
}
