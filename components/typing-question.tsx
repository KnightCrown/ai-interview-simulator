"use client";

import { useEffect, useState } from "react";

export function TypingQuestion({ text }: { text: string | null }) {
  const [visibleText, setVisibleText] = useState("");

  useEffect(() => {
    if (!text) {
      setVisibleText("");
      return;
    }

    setVisibleText("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setVisibleText(text.slice(0, index));
      if (index >= text.length) {
        window.clearInterval(timer);
      }
    }, 18);

    return () => {
      window.clearInterval(timer);
    };
  }, [text]);

  return <>{visibleText || "Preparing next question..."}</>;
}
