interface ScorePillProps {
  label: string;
  value: number;
}

export function ScorePill({ label, value }: ScorePillProps) {
  const tone =
    value >= 75
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : value >= 55
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";

  return (
    <div className={`rounded-full px-3 py-2 text-sm font-semibold ${tone}`}>
      <span className="opacity-80">{label}</span> {value}
    </div>
  );
}
