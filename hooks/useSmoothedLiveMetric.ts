"use client";

import { useEffect, useRef, useState } from "react";

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

type Options = {
  sampleMs: number;
  animateMs: number;
};

export function useSmoothedLiveMetric(liveValue: number, options: Options): number {
  const { sampleMs, animateMs } = options;
  const liveRef = useRef(liveValue);
  liveRef.current = liveValue;

  const displayedRef = useRef(clampScore(liveValue));
  const [displayed, setDisplayed] = useState(() => clampScore(liveValue));
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const runAnimationTo = (target: number) => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }

      const from = displayedRef.current;
      const startTime = performance.now();

      const step = (now: number) => {
        const t = Math.min(1, (now - startTime) / animateMs);
        const eased = 1 - (1 - t) ** 3;
        const next = from + (target - from) * eased;
        displayedRef.current = next;
        setDisplayed(clampScore(next));
        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(step);
        } else {
          animFrameRef.current = null;
        }
      };

      animFrameRef.current = requestAnimationFrame(step);
    };

    const tick = () => {
      runAnimationTo(clampScore(liveRef.current));
    };

    tick();
    const intervalId = window.setInterval(tick, sampleMs);

    return () => {
      window.clearInterval(intervalId);
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [sampleMs, animateMs]);

  return displayed;
}
