import { isTranscriptSubstantive } from "@/lib/transcript-utils";

/** Lines formatted for the finalize prompt and substantive-text detection. */
export function formatLiveConversationForFinalize(entries: { role: string; text: string; classification?: string }[]): string {
  return entries
    .map((e) => {
      const who = e.role === "avatar" ? "Interviewer" : "Candidate";
      const tag = e.classification && e.role === "avatar" ? ` [${e.classification}]` : "";
      return `${who}${tag}: ${e.text}`;
    })
    .join("\n\n");
}

export function candidateTextFromFormattedLiveTranscript(formatted: string): string {
  return formatted
    .split(/\n\n/)
    .filter((block) => block.startsWith("Candidate:"))
    .map((block) => block.replace(/^Candidate:\s*/i, "").trim())
    .join(" ")
    .trim();
}

export function hasSubstantiveLiveConversationTranscript(transcript: string | undefined): boolean {
  if (!transcript?.trim()) return false;
  return isTranscriptSubstantive(candidateTextFromFormattedLiveTranscript(transcript));
}
