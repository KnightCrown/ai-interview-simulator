import { AnswerEvaluation } from "@/lib/interview-types";
import { ScorePill } from "@/components/score-pill";

function toStringList(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item).trim()).filter(Boolean);
    return items.length > 0 ? items : fallback;
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return fallback;
}

function toMissedOpportunityDetails(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const detail = item as Record<string, unknown>;
      const exactThing = typeof detail.exactThing === "string" ? detail.exactThing : "";
      if (!exactThing) {
        return null;
      }

      return {
        exactThing,
        source: typeof detail.source === "string" ? detail.source : "Interview answer",
        whyItMattered:
          typeof detail.whyItMattered === "string" ? detail.whyItMattered : "It would make the answer more specific and credible.",
        impactScoreIncrease:
          typeof detail.impactScoreIncrease === "number" && Number.isFinite(detail.impactScoreIncrease)
            ? detail.impactScoreIncrease
            : 10
      };
    })
    .filter((item): item is { exactThing: string; source: string; whyItMattered: string; impactScoreIncrease: number } => Boolean(item));
}

export function FeedbackPanel({ evaluation }: { evaluation: AnswerEvaluation | null }) {
  if (!evaluation) {
    return (
      <aside className="panel h-full p-6">
        <h2 className="text-lg font-semibold">Live coaching</h2>
        <p className="mt-3 text-sm text-slate-600">
          Submit an answer to see instant AI evaluation, missed opportunities, and an improved example answer.
        </p>
      </aside>
    );
  }

  const missedOpportunityDetails = toMissedOpportunityDetails(evaluation.missedOpportunityDetails);
  const missingResumeHighlights = toStringList(evaluation.missingResumeHighlights, ["No resume gaps detected for this answer."]);

  return (
    <aside className="panel h-full p-6">
      <div className="flex flex-wrap gap-2">
        <ScorePill label="Clarity" value={evaluation.clarity} />
        <ScorePill label="Relevance" value={evaluation.relevance} />
        <ScorePill label="Structure" value={evaluation.structure} />
        <ScorePill label="Confidence" value={evaluation.confidence} />
        <ScorePill label="Engagement" value={evaluation.engagement} />
      </div>

      <div className="mt-6 space-y-4 text-sm text-slate-700">
        <section className="rounded-2xl bg-slate-50 px-4 py-3">
          <h3 className="font-semibold text-ink">Interviewer reaction</h3>
          <p className="mt-1">{evaluation.interviewerReaction}</p>
          <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">
            {evaluation.perceivedTone} • {evaluation.pressureLabel}
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-ink">Feedback</h3>
          <p className="mt-1">{evaluation.feedback}</p>
        </section>

        <section>
          <h3 className="font-semibold text-ink">Missed opportunity</h3>
          <p className="mt-1">{evaluation.missedOpportunity}</p>
          <div className="mt-3 space-y-2">
            {missedOpportunityDetails.map((detail) => (
              <div key={detail.exactThing} className="rounded-2xl bg-rose-50 px-4 py-3 text-rose-950">
                <p className="font-medium">{detail.exactThing}</p>
                <p className="mt-1 text-xs text-rose-800">Source: {detail.source}</p>
                <p className="mt-1 text-xs text-rose-800">{detail.whyItMattered}</p>
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-rose-700">
                  Impact score increase if included: +{detail.impactScoreIncrease}%
                </p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="font-semibold text-ink">Resume highlights you missed</h3>
          <ul className="mt-2 space-y-1">
            {missingResumeHighlights.map((item) => (
              <li key={item} className="rounded-2xl bg-slate-50 px-3 py-2">
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="font-semibold text-ink">Improved answer suggestion</h3>
          <p className="mt-1 rounded-2xl bg-teal-50 px-4 py-3 text-teal-900">{evaluation.improvedAnswer}</p>
        </section>
      </div>
    </aside>
  );
}
