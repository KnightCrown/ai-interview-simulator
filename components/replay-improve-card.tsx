import { InterviewTurn } from "@/lib/interview-types";

function toHighlightList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return ["Add clearer structure, stronger evidence, and a more direct link to the role."];
}

export function ReplayImproveCard({ turn }: { turn: InterviewTurn | null }) {
  if (!turn) {
    return (
      <div className="panel p-6">
        <h3 className="text-lg font-semibold text-ink dark:text-white">Replay & improve answer</h3>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">Submit an answer to compare your original transcript against the AI rewrite.</p>
      </div>
    );
  }

  const rewriteHighlights = toHighlightList(turn.evaluation.rewriteHighlights);

  return (
    <div className="panel p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-ink dark:text-white">Replay & improve answer</h3>
        <div className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          AI rewrite
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Original transcript</p>
          <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-300">{turn.transcript}</p>
        </div>

        <div className="rounded-3xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-500/30 dark:bg-teal-900/30">
          <p className="text-xs uppercase tracking-[0.18em] text-teal-700 dark:text-teal-300">Improved answer</p>
          <p className="mt-3 text-sm leading-7 text-teal-950 dark:text-teal-100">{turn.evaluation.improvedAnswer}</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">What changed</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {rewriteHighlights.map((item) => (
            <span key={item} className="rounded-full bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
