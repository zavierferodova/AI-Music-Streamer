"use client";

import { Play, Pause, Loader2, Radio, ExternalLink, Copy, Zap, Volume2, VolumeX } from "lucide-react";
import { useAudioStream } from "@/hooks/useAudioStream";

export function StreamPlayer() {
  const {
    isPlaying,
    isBuffering,
    errorMessage,
    latencyMs,
    localVolume,
    isMuted,
    setBrowserVolume,
    toggleBrowserMute,
    toggleStreamAudio,
    copyStreamUrl,
  } = useAudioStream();

  return (
    <section
      className="w-full my-6 p-4 sm:p-5 rounded-3xl bg-gradient-to-r from-slate-900/90 via-indigo-950/40 to-slate-900/90 border border-slate-700/60 shadow-xl backdrop-blur-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
      aria-label="Live Audio Stream"
    >
      <div className="flex items-center gap-4 min-w-0 flex-1">
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

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Radio className="w-4 h-4 text-sky-400 animate-pulse shrink-0" />
              <h3 className="text-sm font-bold text-white tracking-tight truncate">
                Listen Live (Browser)
              </h3>
            </div>
            {isPlaying && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold tracking-wide">
                <Zap className="w-3 h-3 text-emerald-400 fill-emerald-400 animate-pulse" />
                <span>Live Broadcast ({latencyMs}ms latency)</span>
              </span>
            )}
          </div>

          <div className="text-xs text-slate-400 mt-0.5 truncate">
            {isBuffering
              ? "Connecting to broadcast stream..."
              : isPlaying
              ? "Web Audio API Active — Smooth Live Broadcast"
              : "Direct audio broadcast over WebSocket"}
          </div>
          {errorMessage && (
            <div className="text-xs text-rose-400 font-medium mt-1">{errorMessage}</div>
          )}
        </div>
      </div>

      {/* Browser Local Volume & Action Controls */}
      <div className="flex items-center gap-3 self-stretch md:self-center justify-between md:justify-end shrink-0 flex-wrap">
        {/* Local Browser Volume Slider */}
        {isPlaying && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700/70 text-xs">
            <button
              onClick={toggleBrowserMute}
              className="text-slate-400 hover:text-white transition-colors"
              title={isMuted ? "Unmute Browser Audio" : "Mute Browser Audio"}
            >
              {isMuted || localVolume === 0 ? (
                <VolumeX className="w-4 h-4 text-rose-400" />
              ) : (
                <Volume2 className="w-4 h-4 text-sky-400" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={isMuted ? 0 : localVolume}
              onChange={(e) => setBrowserVolume(Number(e.target.value))}
              className="w-16 sm:w-20 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-400"
              title="Browser playback volume"
            />
            <span className="text-[11px] font-mono text-slate-300 w-7 text-right">
              {isMuted ? 0 : localVolume}%
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <a
            href="/stream.mp3"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition-all hover:scale-105"
            title="Open traditional MP3 HTTP live stream in external player (VLC, mpv, etc.)"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Direct MP3</span>
            <span className="sm:hidden">MP3</span>
          </a>
          <button
            onClick={copyStreamUrl}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition-all hover:scale-105"
            title="Copy direct stream URL"
          >
            <Copy className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Copy Link</span>
          </button>
        </div>
      </div>
    </section>
  );
}
