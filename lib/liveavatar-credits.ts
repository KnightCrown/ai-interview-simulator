/**
 * Best-effort detection of LiveAvatar / HeyGen–style “no credits” API failures.
 * Response shapes vary; we match common wording so the UI can show a friendly modal.
 */
export function detectLiveAvatarCreditsExhausted(httpStatus: number, rawBody: string): boolean {
  const text = `${httpStatus}\n${rawBody}`.toLowerCase();

  // Explicit subscription / billing signals
  if (
    /\b(no|insufficient|out\s+of|depleted|exhausted)\s+credits?\b/.test(text) ||
    /\bcredits?\s+(are\s+)?(depleted|exhausted|used\s+up|gone)\b/.test(text) ||
    /\bsubscription\b.*\b(expired|inactive|required|needed)\b/.test(text) ||
    /\bquota\b.*\b(exceed|exhaust|limit|deplet)\b/.test(text) ||
    /\bplan\b.*\b(limit|exceed)\b/.test(text) ||
    /\bpayment\s+required\b/.test(text) ||
    /\binsufficient\s+funds?\b/.test(text) ||
    /\bbilling\b.*\b(fail|issue|required)\b/.test(text)
  ) {
    return true;
  }

  // HTTP hints (providers sometimes use these for quota / billing)
  if (httpStatus === 402 || httpStatus === 429) {
    if (/\bcredit|quota|billing|subscription|plan\b|limit\b/.test(text)) {
      return true;
    }
  }

  return false;
}
