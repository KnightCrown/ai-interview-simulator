import { isTranscriptSubstantive } from "@/lib/transcript-utils";

/** One message block from `formatLiveConversationForFinalize` / `parseLiveConversationTranscript`. */
export type LiveTranscriptMessage = {
  role: "interviewer" | "candidate";
  text: string;
  /** Present for interviewer lines when the live route stored a classification. */
  classification?: string;
};

/** Inverse of `formatLiveConversationForFinalize` — used on the results timeline when there are no scored turns yet. */
export function parseLiveConversationTranscript(formatted: string | undefined): LiveTranscriptMessage[] {
  if (!formatted?.trim()) return [];
  const blocks = formatted
    .split(/\n\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const result: LiveTranscriptMessage[] = [];
  for (const block of blocks) {
    const interviewer = block.match(/^Interviewer(?:\s+\[([^\]]+)\])?:\s*([\s\S]+)$/);
    if (interviewer) {
      result.push({
        role: "interviewer",
        classification: interviewer[1]?.trim() || undefined,
        text: interviewer[2].trim()
      });
      continue;
    }
    const candidate = block.match(/^Candidate:\s*([\s\S]+)$/i);
    if (candidate) {
      result.push({ role: "candidate", text: candidate[1].trim() });
    }
  }
  return result;
}

/** Three slices aligned with live interview main questions 1–3 (by `next_main_question` boundaries). */
export type LiveQuestionTranscriptSegments = [
  LiveTranscriptMessage[],
  LiveTranscriptMessage[],
  LiveTranscriptMessage[]
];

/**
 * Splits a parsed live transcript into question 1 / 2 / 3 using interviewer lines tagged
 * `[next_main_question]`. Content before the second such line belongs to Q1; between second and third is Q2;
 * from the third onward is Q3 (includes wrap-up). If fewer than three boundaries exist, later tabs are empty slices.
 * When there are no boundaries, the full transcript is returned as Q1 only (legacy or missing tags).
 */
export function segmentLiveTranscriptByMainQuestion(messages: LiveTranscriptMessage[]): LiveQuestionTranscriptSegments {
  const boundaries: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "interviewer" && m.classification === "next_main_question") {
      boundaries.push(i);
    }
  }

  const empty: LiveTranscriptMessage[] = [];
  const end = messages.length;

  if (boundaries.length === 0) {
    return [messages, empty, empty];
  }

  const b1 = boundaries[1];
  const b2 = boundaries[2];

  if (b1 === undefined) {
    return [messages.slice(0, end), empty, empty];
  }

  if (b2 === undefined) {
    return [messages.slice(0, b1), messages.slice(b1, end), empty];
  }

  return [messages.slice(0, b1), messages.slice(b1, b2), messages.slice(b2, end)];
}

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
