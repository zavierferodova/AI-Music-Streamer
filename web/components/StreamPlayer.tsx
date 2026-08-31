"use client";

import { Play, Pause, Loader2, Radio, ExternalLink, Copy } from "lucide-react";
import { useAudioStream } from "@/hooks/useAudioStream";

export function StreamPlayer() {
  const { isPlaying, isBuffering, errorMessage, toggleStreamAudio, copyStreamUrl } =
    useAudioStream();

  return (
    <section
      className="w-full my-6 p-4 sm:p-5 rounded-3xl bg-gradient-to-r from-slate-900/90 via-indigo-950/30 to-slate-900/90 border border-slate-700/60 shadow-xl backdrop-blur-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
      aria-label="Live Audio Stream"
    >
      <div className="flex items-center gap-4 min-w-0">
        <button
          onClick={toggleStreamAudio}
          className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-sky-500/20 shrink-0 transition-all hover:scale-105 active:scale-95 border border-sky-400/30"
          aria-label={isPlaying ? "Pause Live Audio" : "Play Live Audio"}
        >
          {isBuffering ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-6 h-6 fill-white" />
          ) : (
            <Play className="w-6 h-6 fill-white ml-0.5" />
          )}
        </button>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-sky-400 animate-pulse shrink-0" />
            <h3 className="text-sm font-bold text-white tracking-tight truncate">
              Listen Live Stream
            </h3>
          </div>
          <div className="text-xs text-slate-400 mt-0.5 truncate">
            {isBuffering
              ? "Connecting to broadcast stream..."
              : isPlaying
              ? "Connected & Playing Live in Browser"
              : "Continuous MP3 Broadcast (24/7)"}
          </div>
          {errorMessage && (
            <div className="text-xs text-rose-400 font-medium mt-1">{errorMessage}</div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
        <a
          href="/stream.mp3"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition-all hover:scale-105"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>Direct Stream</span>
        </a>
        <button
          onClick={copyStreamUrl}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition-all hover:scale-105"
        >
          <Copy className="w-3.5 h-3.5" />
          <span>Copy Link</span>
        </button>
      </div>
    </section>
  );
}
