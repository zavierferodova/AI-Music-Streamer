"use client";

import { RefreshCw, Radio } from "lucide-react";
import { ConnectionState } from "@/lib/ws";

interface ConnectionBannerProps {
  connectionState: ConnectionState;
  message: string;
  onRetry: () => void;
}

export function ConnectionBanner({ connectionState, message, onRetry }: ConnectionBannerProps) {
  if (connectionState === "connected") return null;

  return (
    <div className="w-full mb-4 px-4 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 backdrop-blur-md flex items-center justify-between gap-4 text-amber-200 shadow-lg animate-in fade-in">
      <div className="flex items-center gap-3">
        <Radio className="w-5 h-5 text-amber-400 animate-pulse shrink-0" />
        <span className="text-sm font-medium">{message}</span>
      </div>
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 text-xs font-semibold border border-amber-500/40 transition-all hover:scale-105 active:scale-95 shrink-0"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        <span>Retry</span>
      </button>
    </div>
  );
}
