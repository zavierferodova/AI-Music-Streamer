"use client";

import { AlertCircle, RefreshCw, SkipForward, X } from "lucide-react";
import { PlaybackError } from "@/types";

interface PlaybackErrorBannerProps {
  error: PlaybackError | null | undefined;
  onRetry: () => void;
  onSkip: () => void;
  onDismiss: () => void;
}

export function PlaybackErrorBanner({
  error,
  onRetry,
  onSkip,
  onDismiss,
}: PlaybackErrorBannerProps) {
  if (!error || !error.message) return null;

  return (
    <div className="w-full mb-4 px-4 py-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 backdrop-blur-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-rose-200 shadow-xl animate-in fade-in">
      <div className="flex items-start gap-3 min-w-0">
        <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-rose-100 leading-tight">
            {error.title ? `Failed: ${error.title}` : "Playback Error"}
          </div>
          <div className="text-xs text-rose-300/90 mt-0.5 leading-snug">{error.message}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 text-xs font-semibold border border-rose-500/40 transition-all hover:scale-105"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry</span>
        </button>
        <button
          onClick={onSkip}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 text-xs font-semibold border border-rose-500/40 transition-all hover:scale-105"
        >
          <SkipForward className="w-3.5 h-3.5" />
          <span>Skip</span>
        </button>
        <button
          onClick={onDismiss}
          className="p-1.5 rounded-xl text-rose-300 hover:text-white hover:bg-white/10 transition-colors"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
