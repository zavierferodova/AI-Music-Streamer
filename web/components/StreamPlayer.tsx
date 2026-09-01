"use client";

import { Play, Pause, Loader2, Radio, ExternalLink, Copy, Zap, Volume2, VolumeX, ShieldCheck, Headphones } from "lucide-react";
import { useAudioStream, StreamEngineMode } from "@/hooks/useAudioStream";
import { ServerStatus } from "@/types";

interface LatencyStyle {
  badge: string;
  icon: string;
  dot: string;
  statusText: string;
  detailText: string;
}

function getLatencyStyle(latencyMs: number, engineMode: StreamEngineMode): LatencyStyle {
  if (engineMode === "direct_mp3") {
    return {
      badge: "bg-indigo-500/15 border-indigo-500/30 text-indigo-300 shadow-indigo-500/10",
      icon: "text-indigo-400 fill-indigo-400",
      dot: "bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)]",
      statusText: "Direct MP3",
      detailText: "Continuous HTTP stream with native background playback",
    };
  }

  if (latencyMs < 100) {
    return {
      badge: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 shadow-emerald-500/10",
      icon: "text-emerald-400 fill-emerald-400",
      dot: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]",
      statusText: "Ultra-Low Latency",
      detailText: `Sub-100ms sync (${latencyMs}ms buffer)`,
    };
  } else if (latencyMs <= 300) {
    return {
      badge: "bg-amber-500/15 border-amber-500/30 text-amber-300 shadow-amber-500/10",
      icon: "text-amber-400 fill-amber-400",
      dot: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]",
      statusText: "Smooth Live Broadcast",
      detailText: `Live broadcast sync (${latencyMs}ms buffer)`,
    };
  } else if (latencyMs <= 600) {
    return {
      badge: "bg-orange-500/15 border-orange-500/30 text-orange-300 shadow-orange-500/10",
      icon: "text-orange-400 fill-orange-400",
      dot: "bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.8)]",
      statusText: "Moderate Buffer Delay",
      detailText: `Buffered stream playback (${latencyMs}ms delay)`,
    };
  } else {
    return {
      badge: "bg-rose-500/15 border-rose-500/30 text-rose-300 shadow-rose-500/10",
      icon: "text-rose-400 fill-rose-400",
      dot: "bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.8)]",
      statusText: "High Buffer Latency",
      detailText: `High network latency (${latencyMs}ms delay)`,
    };
  }
}

export interface StreamPlayerProps {
  status?: ServerStatus | null;
  isAdmin?: boolean;
  onTogglePlayPause?: () => void;
  onPlayPrevious?: () => void;
  onSkipTrack?: () => void;
  onSeekRelative?: (seconds: number) => void;
}

export function StreamPlayer({
  status,
  isAdmin = false,
  onTogglePlayPause,
  onPlayPrevious,
  onSkipTrack,
  onSeekRelative,
}: StreamPlayerProps) {
  const {
    isPlaying,
    isBuffering,
    errorMessage,
    latencyMs,
    localVolume,
    isMuted,
    engineMode,
    setEngineMode,
    setBrowserVolume,
    toggleBrowserMute,
    toggleStreamAudio,
    copyStreamUrl,
  } = useAudioStream({
    nowPlaying: status?.now_playing,
    playbackState: status?.state,
    isAdmin,
    onTogglePlayPause,
    onPlayPrevious,
    onSkipTrack,
    onSeekRelative,
  });

  const latencyStyle = getLatencyStyle(latencyMs, engineMode);

  return (
    <section
      className="w-full my-5 sm:my-6 p-4 sm:p-5 rounded-3xl bg-gradient-to-r from-slate-900/95 via-indigo-950/40 to-slate-900/95 border border-slate-700/60 shadow-xl backdrop-blur-xl flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3.5 sm:gap-4"
      aria-label="Live Audio Stream"
    >
      {/* Top / Left: Play Button & Stream Info */}
      <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
        <button
          onClick={toggleStreamAudio}
          className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-sky-500/20 shrink-0 transition-all hover:scale-105 active:scale-95 border border-sky-400/30"
          aria-label={isPlaying ? "Pause Live Audio" : "Play Live Audio"}
        >
          {isBuffering ? (
            <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-5 h-5 sm:w-6 sm:h-6 fill-white" />
          ) : (
            <Play className="w-5 h-5 sm:w-6 sm:h-6 fill-white ml-0.5" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 shrink-0">
              <Radio className="w-4 h-4 text-sky-400 animate-pulse" />
              <h3 className="text-sm font-bold text-white tracking-tight">
                Listen Live <span className="hidden xs:inline">(Browser)</span>
              </h3>
            </div>

            {isPlaying && (
              <span
                className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-0.5 rounded-full border text-[10px] sm:text-[11px] font-semibold tracking-wide shadow-sm transition-all shrink-0 ${latencyStyle.badge}`}
                title={`Live stream playback sync latency: ${latencyMs}ms`}
              >
                <Zap className={`w-3 h-3 animate-pulse ${latencyStyle.icon}`} />
                <span className="hidden sm:inline">{latencyStyle.statusText}</span>
                <span className="sm:hidden">{engineMode === "direct_mp3" ? "MP3" : "Live"}</span>
                <span className="text-[10px] opacity-75 font-mono">({latencyMs}ms)</span>
              </span>
            )}

            {isPlaying && (
              <span
                className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-[10px] text-sky-300 font-medium shrink-0"
                title={
                  isAdmin
                    ? "Background playback and lockscreen media controls are active (Admin: full control)"
                    : "Background playback is active (Subscriber: listen-only, lockscreen controls disabled)"
                }
              >
                <ShieldCheck className="w-3 h-3 text-sky-400" />
                <span className="hidden xs:inline">{isAdmin ? "Background Active" : "Background (Listen Only)"}</span>
                <span className="xs:hidden">BG</span>
              </span>
            )}
          </div>

          <div className="text-xs text-slate-400 mt-1 min-w-0 truncate">
            {isBuffering ? (
              <span className="text-sky-300 animate-pulse font-medium">
                Connecting to broadcast stream...
              </span>
            ) : isPlaying ? (
              <span>
                <span className="hidden sm:inline text-slate-400">
                  {engineMode === "direct_mp3" ? "Direct MP3 • " : "Web Audio API • "}
                </span>
                <span className="text-slate-300">{latencyStyle.detailText}</span>
              </span>
            ) : (
              <span className="text-slate-400">
                Direct raw PCM audio broadcast with background & lockscreen playback support
              </span>
            )}
          </div>
          {errorMessage && (
            <div className="text-xs text-rose-400 font-medium mt-1 truncate">{errorMessage}</div>
          )}
        </div>
      </div>

      {/* Bottom / Right: Engine Selector, Local Volume & Action Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between xl:justify-end gap-2.5 sm:gap-3 shrink-0 pt-3 xl:pt-0 border-t xl:border-t-0 border-slate-800/80">
        {/* Stream Engine Mode Switcher (Web Audio vs Direct MP3) */}
        <div className="flex items-center p-0.5 rounded-xl bg-slate-800/90 border border-slate-700/80 text-[11px] font-medium shrink-0 self-start sm:self-auto">
          <button
            onClick={() => setEngineMode("webaudio")}
            className={`px-2 sm:px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 ${
              engineMode === "webaudio"
                ? "bg-sky-500 text-white font-semibold shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="Ultra-Low Latency raw PCM stream over WebSocket (<100ms sync)"
          >
            <Zap className="w-3 h-3 shrink-0" />
            <span>Web Audio</span>
          </button>
          <button
            onClick={() => setEngineMode("direct_mp3")}
            className={`px-2 sm:px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 ${
              engineMode === "direct_mp3"
                ? "bg-indigo-600 text-white font-semibold shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="Continuous HTTP MP3 Stream with native mobile background playback"
          >
            <Headphones className="w-3 h-3 shrink-0" />
            <span>Native MP3</span>
          </button>
        </div>

        {/* Volume & External Links Row */}
        <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
          {/* Local Browser Volume Slider */}
          {isPlaying && (
            <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700/70 text-xs shrink-0 flex-1 sm:flex-none justify-between sm:justify-start">
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
                className="w-16 xs:w-20 sm:w-20 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-400"
                title="Browser playback volume"
              />
              <span className="text-[10px] sm:text-[11px] font-mono text-slate-300 w-6 sm:w-7 text-right">
                {isMuted ? 0 : localVolume}%
              </span>
            </div>
          )}

          {/* Quick Action Links */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <a
              href="/stream.mp3"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition-all hover:scale-105"
              title="Open traditional MP3 HTTP live stream in external player (VLC, mpv, etc.)"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Direct MP3</span>
              <span className="sm:hidden">MP3</span>
            </a>
            <button
              onClick={copyStreamUrl}
              className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition-all hover:scale-105"
              title="Copy direct stream URL"
            >
              <Copy className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Copy Link</span>
              <span className="sm:hidden">Copy</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
