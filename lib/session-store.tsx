"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { InterviewSession } from "@/lib/interview-types";

interface SessionContextValue {
  session: InterviewSession | null;
  setSession: (session: InterviewSession | null) => void;
  resetSession: () => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);
const STORAGE_KEY = "ai-interview-simulator-session";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<InterviewSession | null>(null);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as InterviewSession;
      setSessionState({
        ...parsed,
        difficulty: parsed.difficulty ?? "Medium",
        questionQueue: parsed.questionQueue ?? []
      });
    }
  }, []);

  const setSession = (value: InterviewSession | null) => {
    setSessionState(value);

    if (value) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      return;
    }

    window.sessionStorage.removeItem(STORAGE_KEY);
  };

  const resetSession = () => {
    setSession(null);
  };

  const value = useMemo(
    () => ({
      session,
      setSession,
      resetSession
    }),
    [session]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useInterviewSession() {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error("useInterviewSession must be used within a SessionProvider");
  }

  return context;
}
