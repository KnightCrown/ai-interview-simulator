/**
 * Canned interviewer reactions and re-ask preambles used when the candidate
 * submits an empty/non-substantive answer. These are deliberately deterministic
 * so the UI can react instantly without waiting on OpenAI.
 *
 * Background OpenAI evaluation still runs to populate the final report's turn
 * record - those scores feed memory/scoring; these strings drive the visible UI.
 */

/** First-person interviewer reactions for an empty answer. Picked at random. */
export const EMPTY_ANSWER_REACTIONS: string[] = [
  "Nothing came back. I don't know if they misunderstood the question or just aren't ready, but I can't assess someone who won't engage.",
  "Silence isn't an answer. I need something concrete to work with - right now there's nothing to evaluate and that's a real problem.",
  "That was a non-starter. I'm sitting here waiting for substance and getting none. It's hard to advocate for someone who won't show up in the moment.",
  "I have no idea what they're thinking. If they can't respond to a direct question, I have to question whether they're prepared for this role at all.",
  "This is stalling the whole process. I need them to engage - give me one example, one thought, anything - or there's genuinely nothing I can do with this.",
  "A blank submission tells me more than a weak answer would. It signals disengagement, and that's very hard to overlook at this stage.",
  "I asked a straightforward question and got nothing. That's not nerves - that's a gap I can't bridge on my end.",
  "I'm going to give them the benefit of the doubt and assume nerves, but I really need them to commit to an answer next time.",
  "No response at all. I'd rather hear a rough, incomplete answer than total silence - at least then I have something to work with.",
  "When the room goes quiet like this, I lose my ability to advocate for the candidate later. I need them to fill the space, even imperfectly."
];

/**
 * Lead-ins prepended to a re-asked question. Used by buildReaskQuestion() to
 * construct the spoken text for the inserted re-ask slot deterministically
 * (no OpenAI call), so the audio can be prefetched immediately.
 */
export const EMPTY_ANSWER_REASK_PREAMBLES: string[] = [
  "Let me try that one again - I didn't get an answer the first time. ",
  "I want to give you another shot at this. Same question, different framing: ",
  "We didn't get anywhere on that last one, so I'm going to come back to it. ",
  "Quick reset - I need a real answer to the previous question before we move on. ",
  "I'd like to revisit what I just asked. Take a breath, then walk me through it: ",
  "Let's not skip past that one. I'm going to ask it again, slightly differently: ",
  "I'm circling back because I didn't hear an answer. Here's the question one more time: ",
  "Before we move forward, I want to give you another chance at the previous question. ",
  "That one mattered - I can't move on without your take. Let me re-ask: ",
  "I'm going to repeat the previous question. Even a partial answer is useful here: "
];

/** Tiny PRNG-friendly random picker. Defaults to Math.random when no seed is passed. */
export function pickRandomReaction(rng: () => number = Math.random): string {
  const index = Math.floor(rng() * EMPTY_ANSWER_REACTIONS.length);
  return EMPTY_ANSWER_REACTIONS[Math.min(EMPTY_ANSWER_REACTIONS.length - 1, Math.max(0, index))];
}

export function pickRandomReaskPreamble(rng: () => number = Math.random): string {
  const index = Math.floor(rng() * EMPTY_ANSWER_REASK_PREAMBLES.length);
  return EMPTY_ANSWER_REASK_PREAMBLES[Math.min(EMPTY_ANSWER_REASK_PREAMBLES.length - 1, Math.max(0, index))];
}

/**
 * Builds a deterministic re-ask question by prepending a canned preamble to the
 * original question text. Works without OpenAI so the resulting audio can be
 * pre-fetched as soon as the empty answer is detected.
 */
export function buildReaskQuestion(originalQuestion: string, rng: () => number = Math.random): string {
  const preamble = pickRandomReaskPreamble(rng);
  const trimmed = originalQuestion.trim();
  if (!trimmed) {
    return preamble.trim();
  }
  return `${preamble}${trimmed}`;
}
