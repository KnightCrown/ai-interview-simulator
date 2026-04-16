import { AnswerEvaluation } from "@/lib/interview-types";
import { ScorePill } from "@/components/score-pill";

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
        <section>
          <h3 className="font-semibold text-ink">Feedback</h3>
          <p className="mt-1">{evaluation.feedback}</p>
        </section>

        <section>
          <h3 className="font-semibold text-ink">Missed opportunity</h3>
          <p className="mt-1">{evaluation.missedOpportunity}</p>
        </section>

        <section>
          <h3 className="font-semibold text-ink">Resume highlights you missed</h3>
          <ul className="mt-2 space-y-1">
            {(evaluation.missingResumeHighlights.length > 0
              ? evaluation.missingResumeHighlights
              : ["No resume gaps detected for this answer."]).map((item) => (
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
