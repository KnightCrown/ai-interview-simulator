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

      <div className="mt-5 grid gap-4 text-sm text-slate-700 sm:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Speaking pace</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{speech.speakingPace} wpm</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Filler words</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{speech.fillerCount}</p>
          <p className="mt-2 text-xs text-slate-500">{speech.fillerWords.join(", ") || "No filler patterns detected yet."}</p>
        </div>
      </div>
    </div>
  );
}
