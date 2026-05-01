import { isTranscriptSubstantive } from "@/lib/transcript-utils";

export type UnsubmittedDeltaOptions = {
  /** When false (e.g. manual “send now”), allow minimal text so debugging can force a turn. Default true. */
  requireSubstantive?: boolean;
};

export function getUnsubmittedUtteranceDelta(
  candidateText: string,
  lastSubmittedText: string,
  options?: UnsubmittedDeltaOptions
): string | null {
  const candidate = candidateText.trim();
  const previous = lastSubmittedText.trim();

  if (!candidate || candidate === previous) {
    return null;
  }

  const delta = candidate.startsWith(previous)
    ? candidate.slice(previous.length).trim()
    : candidate;

  if (!delta) {
    return null;
  }

  const requireSubstantive = options?.requireSubstantive !== false;
  if (requireSubstantive && !isTranscriptSubstantive(delta)) {
    return null;
  }

  return delta;
}
