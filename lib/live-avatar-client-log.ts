import type { LiveAvatarLogDetails } from "@/lib/live-avatar-debug";

export function logLiveAvatarEvent(event: string, details: LiveAvatarLogDetails = {}, source = "client") {
  if (typeof window === "undefined") {
    return;
  }

  const body = JSON.stringify({
    event,
    source,
    pathname: window.location.pathname,
    at: Date.now(),
    details
  });

  void fetch("/api/live-avatar/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: body.length < 60_000
  }).catch(() => {
    // Debug logging must never interrupt the interview flow.
  });
}
