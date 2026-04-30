interface ConfidenceMeterProps {
  value: number;
  label?: string;
}

export function ConfidenceMeter({ value, label = "Live confidence" }: ConfidenceMeterProps) {
  const tone =
    value >= 75
      ? "from-emerald-500 to-teal-400"
      : value >= 55
        ? "from-amber-400 to-yellow-300"
        : "from-rose-500 to-orange-400";

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
        <span className="text-2xl font-semibold text-ink dark:text-white">{value}</span>
      </div>
      <div className="mt-4 h-4 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${tone} transition-all duration-500 ease-out`}
          style={{ width: `${Math.max(6, value)}%` }}
        />
      </div>
    </div>
  );
}
