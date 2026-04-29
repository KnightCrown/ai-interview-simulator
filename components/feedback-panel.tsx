import { AnswerEvaluation } from "@/lib/interview-types";

export interface CoachingThought {
  id: string;
  thought: string;
}

const METRICS = ["clarity", "relevance", "structure", "confidence", "engagement"] as const;

function formatLabel(label: string) {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function MetricBadge({ label, value }: { label: string; value: number | null }) {
  const tone =
    value === null
      ? "bg-slate-100 text-slate-500"
      : value >= 75
        ? "bg-emerald-100 text-emerald-700"
        : value >= 55
          ? "bg-amber-100 text-amber-700"
          : "bg-rose-100 text-rose-700";

  return (
    <div className={`rounded-full px-3 py-2 text-sm font-semibold ${tone}`}>
      <span className="opacity-80">{label}</span> {value ?? "--"}
    </div>
  );
}

export function FeedbackPanel({
  latestEvaluation,
  thoughts,
  onDismissThought
}: {
  latestEvaluation: AnswerEvaluation | null;
  thoughts: CoachingThought[];
  onDismissThought: (id: string) => void;
}) {
  return (
    <aside className="panel p-5">
      <div className="flex flex-wrap gap-2">
        {METRICS.map((metric) => (
          <MetricBadge key={metric} label={formatLabel(metric)} value={latestEvaluation?.[metric] ?? null} />
        ))}
      </div>

      <div className="mt-6">
        <h2 className="text-base font-semibold">Interviewer&apos;s thoughts</h2>
        {thoughts.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Thoughts will appear here as answer coaching finishes in the background.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {thoughts.map((item) => (
              <article key={item.id} className="relative rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 pr-10 text-sm leading-6 text-slate-700">
                <button
                  type="button"
                  onClick={() => onDismissThought(item.id)}
                  className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-ink"
                  aria-label="Dismiss interviewer thought"
                >
                  x
                </button>
                <p>{item.thought}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
