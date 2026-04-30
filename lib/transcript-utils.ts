/** True if the candidate provided at least a minimal spoken/written answer worth evaluating. */
export function isTranscriptSubstantive(transcript: string): boolean {
  const trimmed = transcript.trim();
  if (!trimmed.length) {
    return false;
  }

  const letters = trimmed.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 2) {
    return false;
  }

  const words = trimmed.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  return words.length >= 1;
}
