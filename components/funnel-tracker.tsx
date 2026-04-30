import { HIRING_STAGES } from "@/lib/interview-scoring";
import { FunnelOutcome, HiringStage } from "@/lib/interview-types";

interface FunnelTrackerProps {
  currentStage: HiringStage;
  outcome: FunnelOutcome | null;
}

export function FunnelTracker({ currentStage, outcome }: FunnelTrackerProps) {
  const currentIndex = HIRING_STAGES.indexOf(currentStage);

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Hiring progress</p>
          <p className="mt-1 text-lg font-semibold text-ink dark:text-white">{currentStage}</p>
        </div>
        {outcome ? (
          <div className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{outcome}</div>
        ) : null}
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-5">
        {HIRING_STAGES.map((stage, index) => {
          const isActive = index === currentIndex;
          const isComplete = index < currentIndex;

          return (
            <div
              key={stage}
              className={`rounded-2xl border px-3 py-4 text-sm transition ${
                isActive
                  ? "border-teal-500 bg-teal-50 text-teal-900 dark:border-teal-400 dark:bg-teal-900/30 dark:text-teal-100"
                  : isComplete
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-900/30 dark:text-emerald-200"
                    : "border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400"
              }`}
            >
              {stage}
            </div>
          );
        })}
      </div>
    </div>
  );
}
