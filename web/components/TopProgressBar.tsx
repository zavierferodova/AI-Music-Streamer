"use client";

import { useEffect, useState } from "react";

export function TopProgressBar({ isLoading }: { isLoading: boolean }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (isLoading) {
      setProgress(75);
    } else {
      setProgress(100);
      const timer = setTimeout(() => {
        setProgress(0);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  if (progress === 0) return null;

  return (
    <div
      className="fixed top-0 left-0 h-[3px] bg-gradient-to-r from-sky-400 via-indigo-500 to-emerald-400 z-50 transition-all duration-300 ease-out shadow-[0_0_12px_rgba(56,189,248,0.8)]"
      style={{ width: `${progress}%`, opacity: progress > 0 ? 1 : 0 }}
    />
  );
}
