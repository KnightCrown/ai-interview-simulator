import { InterviewTurn } from "@/lib/interview-types";

export function ReplayImproveCard({ turn }: { turn: InterviewTurn | null }) {
  if (!turn) {
    return (
      <div className="panel p-6">
        <h3 className="text-lg font-semibold text-ink">Replay & improve answer</h3>
        <p className="mt-3 text-sm text-slate-600">Submit an answer to compare your original transcript against the AI rewrite.</p>
      </div>
    );
  }

  return (
    <div className="panel p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-ink">Replay & improve answer</h3>
        <div className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
          AI rewrite
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Original transcript</p>
          <p className="mt-3 text-sm leading-7 text-slate-700">{turn.transcript}</p>
        </div>

        <div className="rounded-3xl border border-teal-200 bg-teal-50 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-teal-700">Improved answer</p>
          <p className="mt-3 text-sm leading-7 text-teal-950">{turn.evaluation.improvedAnswer}</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">What changed</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {turn.evaluation.rewriteHighlights.map((item) => (
            <span key={item} className="rounded-full bg-amber-100 px-3 py-2 text-sm text-amber-900">
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
