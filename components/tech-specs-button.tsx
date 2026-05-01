"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GITHUB_URL = "https://github.com/KnightCrown/ai-interview-simulator";

type TechItem = { name: string; description: string };
type TechSection = { title: string; items: TechItem[] };

const TECH_SECTIONS: TechSection[] = [
  {
    title: "AI & Intelligence",
    items: [
      { name: "OpenAI gpt-4.1-mini", description: "AI Model Provider for Agents" },
      { name: "Multi-agent pipeline", description: "Specialised agents per task" }
    ]
  },
  {
    title: "Voice & Audio",
    items: [
      { name: "ElevenLabs", description: "Streaming TTS for practice mode (/interview)" },
      { name: "HeyGen LiveAvatar", description: "Live video interviewer over LiveKit FULL mode (live interview · /interview/live Beta)" },
      { name: "LiveKit", description: "Real-time avatar video/audio transport for LiveAvatar sessions" },
      { name: "Web Speech API", description: "Real-time transcription" },
      { name: "Web Audio API", description: "Live amplitude analysis" }
    ]
  },
  {
    title: "Vision",
    items: [
      { name: "MediaPipe Face Mesh", description: "Facial landmark tracking" }
    ]
  },
  {
    title: "Frontend & Rendering",
    items: [
      { name: "Next.js 14", description: "App Router framework" },
      { name: "React + TypeScript", description: "UI rendering & type safety" },
      { name: "Tailwind CSS", description: "Styling" },
      { name: "Three.js / R3F", description: "Avatar rendering" }
    ]
  },
  {
    title: "Infrastructure",
    items: [
      { name: "Stateless API routes", description: "Scalable, agent-based design" },
      { name: "Client-side session", description: "Session stored in the browser" },
      { name: "HeyGen API routes", description: "/api/heygen/token, conversation, stop — server-minted LiveAvatar + OpenAI orchestration" }
    ]
  }
];

type Variant = "nav" | "header";

const VARIANT_CLASSES: Record<Variant, string> = {
  nav: "rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-ink dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
  header:
    "rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-ink shadow-sm transition hover:border-teal-200 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:border-teal-400/40 dark:hover:text-teal-200"
};

function useScrollTracker(ref: React.RefObject<HTMLDivElement | null>) {
  const [thumb, setThumb] = useState({ top: 0, height: 0, visible: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const canScroll = scrollHeight > clientHeight;
    if (!canScroll) { setThumb((t) => ({ ...t, visible: false })); return; }
    const ratio = clientHeight / scrollHeight;
    const thumbH = Math.max(32, ratio * clientHeight);
    const maxTop = clientHeight - thumbH;
    const thumbTop = (scrollTop / (scrollHeight - clientHeight)) * maxTop;
    setThumb({ top: thumbTop, height: thumbH, visible: true });
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [ref, update]);

  return thumb;
}

export function TechSpecsButton({ variant = "header" }: { variant?: Variant }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const thumb = useScrollTracker(scrollRef);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const modal = open && mounted ? createPortal(
    <div
      className="fixed inset-0 z-[9999] grid place-items-center bg-ink/55 px-4 py-8 backdrop-blur-sm dark:bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-label="Tech specs"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          {/* Outer card — overflow-hidden keeps the scrollbar inside the rounded corners */}
          <div className="relative flex max-h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-panel dark:border-slate-700 dark:bg-slate-900">

            {/* Sticky header */}
            <div className="flex shrink-0 items-start justify-between px-8 pt-7 pb-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">Tech stack</p>
                <h2 className="mt-1.5 text-2xl font-semibold text-ink dark:text-white">How this is built</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                  The full stack powering the interview simulator, end to end.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-6 mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-base font-semibold text-slate-400 transition hover:bg-slate-100 hover:text-ink dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label="Close tech specs"
              >
                ×
              </button>
            </div>

            {/* Scrollable body + custom scrollbar track */}
            <div className="relative flex min-h-0 flex-1">
              {/* Content — native scrollbar hidden via inline style for full cross-browser support */}
              <div
                ref={scrollRef}
                className="flex-1 px-8 pb-7"
                style={{ overflowY: "auto", scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
              >
                <style>{`.ts-scroll::-webkit-scrollbar{display:none}`}</style>
                <div className="ts-scroll">
                  <div className="space-y-4">
                    {TECH_SECTIONS.map((section) => (
                      <div key={section.title}>
                        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-teal-700 dark:text-teal-300">
                          {section.title}
                        </p>
                        <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
                          {section.items.map((item, index) => (
                            <div
                              key={item.name}
                              className={`grid grid-cols-[minmax(11rem,20rem)_1fr] items-center gap-6 px-5 py-2.5 ${
                                index === 0 ? "" : "border-t border-slate-200 dark:border-slate-700"
                              } bg-slate-50/60 dark:bg-slate-800/40`}
                            >
                              <p className="text-sm font-semibold text-ink dark:text-white">{item.name}</p>
                              <p className="text-sm text-slate-500 dark:text-slate-400">{item.description}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 flex items-start gap-3 rounded-2xl border border-teal-200 bg-teal-50/80 px-4 py-3 dark:border-teal-500/30 dark:bg-teal-900/20">
                    <svg
                      className="mt-0.5 h-4 w-4 shrink-0 text-teal-700 dark:text-teal-300"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <p className="text-sm leading-6 text-teal-900 dark:text-teal-100">
                      <span className="font-semibold">Privacy.</span> Facial data and voice data never leave your machine.
                      They are processed and encoded entirely in your browser.
                    </p>
                  </div>

                  <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-teal-300 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:border-teal-400/50 dark:hover:text-teal-200"
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.2-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11.1 11.1 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.7.9 1.2 1.9 1.2 3.2 0 4.5-2.7 5.4-5.3 5.7.4.3.8 1 .8 2.1v3c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5z" />
                    </svg>
                    View on GitHub
                  </a>
                </div>
              </div>

              {/* Custom scroll indicator — thin track + animated thumb */}
              {thumb.visible ? (
                <div className="absolute right-2.5 top-0 bottom-0 w-1 py-3 pointer-events-none" aria-hidden="true">
                  {/* Track */}
                  <div className="h-full w-full rounded-full bg-slate-200/70 dark:bg-slate-700/60" />
                  {/* Thumb */}
                  <div
                    className="absolute right-0 w-full rounded-full bg-slate-400/70 transition-[top,height] duration-75 dark:bg-slate-500/80"
                    style={{ top: `calc(0.75rem + ${thumb.top}px)`, height: `${thumb.height}px` }}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>,
    document.body
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={VARIANT_CLASSES[variant]}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Tech specs
      </button>
      {modal}
    </>
  );
}
