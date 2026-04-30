import { FaceMetrics, SpeechMetrics } from "@/lib/interview-types";
import { ScorePill } from "@/components/score-pill";

interface MetricsCardProps {
  speech: SpeechMetrics;
  face: FaceMetrics;
}

export function MetricsCard({ speech, face }: MetricsCardProps) {
  return (
    <div className="panel p-5">
      <div className="flex flex-wrap gap-2">
        <ScorePill label="Engagement" value={face.engagementScore} />
        <ScorePill label="Eye Contact" value={face.eyeContact} />
        <ScorePill label="Head Stability" value={face.headStability} />
      </div>

      <div className="mt-5 grid gap-4 text-sm text-slate-700 sm:grid-cols-2 dark:text-slate-300">
        <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/70">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Speaking pace</p>
          <p className="mt-2 text-2xl font-semibold text-ink dark:text-white">{speech.speakingPace} wpm</p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Stable delivery tends to land best between 105 and 155 wpm.</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/70">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Filler words</p>
          <p className="mt-2 text-2xl font-semibold text-ink dark:text-white">{speech.fillerCount}</p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{speech.fillerWords.join(", ") || "No filler patterns detected yet."}</p>
        </div>
      </div>
    </div>
  );
}
