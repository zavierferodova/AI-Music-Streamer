"use client";

import { useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Square,
  Link as LinkIcon,
  Copy,
  Music2,
  Loader2,
  ExternalLink,
  Headphones,
  Radio,
  RotateCcw,
  RotateCw,
  Clock,
} from "lucide-react";
import { ServerStatus } from "@/types";
import { formatTrackDisplay, copyToClipboard, formatSeconds } from "@/lib/utils";
import { VolumeControls } from "./VolumeControls";
import { useToast } from "@/hooks/useToast";

interface NowPlayingHeroProps {
  status: ServerStatus | null;
  volume: number;
  isAdmin?: boolean;
  onTogglePlayPause: () => void;
  onPlayPrevious: () => void;
  onSkipTrack: () => void;
  onStopMusic: () => void;
  onToggleLoop: () => void;
  onToggleMode: () => void;
  onVolumeChange: (val: number) => void;
  onVolumeStep: (delta: number) => void;
  onToggleMute: () => void;
  onSeekTo?: (seconds: number) => void;
  onSeekRelative?: (deltaSeconds: number) => void;
}

export function NowPlayingHero({
  status,
  volume,
  isAdmin = true,
  onTogglePlayPause,
  onPlayPrevious,
  onSkipTrack,
  onStopMusic,
  onToggleLoop,
  onToggleMode,
  onVolumeChange,
  onVolumeStep,
  onToggleMute,
  onSeekTo,
  onSeekRelative,
}: NowPlayingHeroProps) {
  const { showToast } = useToast();
  const [imgError, setImgError] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);

  const isPlaying = status?.state === "playing";
  const isPaused = status?.state === "paused";
  const isBuffering = isPlaying && !!status?.is_buffering;
  const loopMode = (status?.loop || "repeat").toLowerCase();
  const broadcastMode = status?.mode || "silent";

  const rawTitle = status?.now_playing?.title || (isPlaying ? "Audio stream decoding..." : "Idle (Ready to play)");
  const rawUrl = status?.now_playing?.url || "";
  const thumbUrl = status?.now_playing?.thumbnail;
  const display = formatTrackDisplay(rawTitle, rawUrl);

  const serverElapsed = status?.now_playing?.elapsed_seconds || 0;
  const duration = status?.now_playing?.duration_seconds || 0;

  // Local continuous smooth clock ticker between WebSocket updates
  const [localElapsed, setLocalElapsed] = useState(serverElapsed);
  const lastSyncTimeRef = useRef(Date.now());
  const baseElapsedRef = useRef(serverElapsed);

  useEffect(() => {
    baseElapsedRef.current = serverElapsed;
    lastSyncTimeRef.current = Date.now();
    setLocalElapsed(serverElapsed);
  }, [serverElapsed]);

  useEffect(() => {
    if (!isPlaying || isBuffering || !status?.now_playing?.url) {
      setLocalElapsed(serverElapsed);
      return;
    }

    const interval = setInterval(() => {
      if (!isScrubbing) {
        const elapsedSec = baseElapsedRef.current + Math.floor((Date.now() - lastSyncTimeRef.current) / 1000);
        setLocalElapsed(duration > 0 ? Math.min(duration, Math.max(0, elapsedSec)) : Math.max(0, elapsedSec));
      }
    }, 250);

    return () => clearInterval(interval);
  }, [isPlaying, isBuffering, isScrubbing, duration, serverElapsed, status?.now_playing?.url]);

  // Sync scrub value when not dragging
  useEffect(() => {
    if (!isScrubbing) {
      setScrubValue(localElapsed);
    }
  }, [localElapsed, isScrubbing]);

  const currentDisplayElapsed = isScrubbing ? scrubValue : localElapsed;
  const effectiveDuration = duration > 0 ? duration : (isPlaying || isPaused ? Math.max(localElapsed + 60, 300) : 0);
  const progressPercent = effectiveDuration > 0 ? Math.min(100, Math.max(0, (currentDisplayElapsed / effectiveDuration) * 100)) : 0;

  const handleSeekInput = (val: number) => {
    setIsScrubbing(true);
    setScrubValue(val);
  };

  const handleSeekCommit = () => {
    setIsScrubbing(false);
    if (onSeekTo) {
      onSeekTo(scrubValue);
      showToast(`Seeked to ${formatSeconds(scrubValue)}`, "info", "fast_forward");
    }
  };

  const handleCopyLink = async () => {
    if (!rawUrl) return;
    const ok = await copyToClipboard(rawUrl);
    if (ok) {
      showToast("Copied track URL to clipboard!", "success", "check_circle");
    }
  };

  return (
    <main
      className="w-full rounded-3xl bg-slate-900/80 border border-slate-700/60 p-4 sm:p-6 shadow-2xl backdrop-blur-xl transition-all"
      id="hero-now-playing-card"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
          <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">
            Now Playing
          </span>
        </div>

        <div className="flex items-center gap-3">
          {isBuffering && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-500/20 text-sky-300 text-xs font-medium animate-pulse border border-sky-500/30">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Buffering audio...</span>
            </div>
          )}

          {/* Equalizer frequency visualizer */}
          <div className="flex items-end gap-1 h-5 px-2 py-1">
            <span
              className={`w-1 rounded-full bg-sky-400 transition-all ${
                isPlaying ? "animate-eq-1" : "h-1 opacity-40"
              }`}
            />
            <span
              className={`w-1 rounded-full bg-indigo-400 transition-all ${
                isPlaying ? "animate-eq-2" : "h-2 opacity-40"
              }`}
            />
            <span
              className={`w-1 rounded-full bg-purple-400 transition-all ${
                isPlaying ? "animate-eq-3" : "h-1 opacity-40"
              }`}
            />
            <span
              className={`w-1 rounded-full bg-sky-400 transition-all ${
                isPlaying ? "animate-eq-4" : "h-2 opacity-40"
              }`}
            />
            <span
              className={`w-1 rounded-full bg-emerald-400 transition-all ${
                isPlaying ? "animate-eq-5" : "h-1 opacity-40"
              }`}
            />
          </div>
        </div>
      </div>

      {/* Main artwork & track info */}
      <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 my-4 sm:my-6">
        {/* Artwork Thumbnail Box */}
        <div className="relative w-32 h-32 sm:w-40 sm:h-40 rounded-2xl overflow-hidden bg-slate-800 border border-slate-700/80 shadow-xl shrink-0 group">
          {thumbUrl && !imgError ? (
            <img
              src={thumbUrl}
              alt="Track Artwork"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-2">
              <Music2 className="w-12 h-12 stroke-[1.5]" />
              <span className="text-[11px] font-medium">No Artwork</span>
            </div>
          )}

          {isBuffering && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
            </div>
          )}
        </div>

        {/* Track Title & Metadata */}
        <div className="flex-1 min-w-0 text-center sm:text-left space-y-2">
          <h2 className="text-lg sm:text-2xl font-extrabold text-white tracking-tight leading-tight line-clamp-2">
            {display.title}
          </h2>

          <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap text-xs text-slate-400">
            {rawUrl ? (
              <div className="flex items-center gap-1.5 max-w-full bg-slate-800/80 px-2.5 sm:px-3 py-1.5 rounded-xl border border-slate-700/60 text-[11px] sm:text-xs">
                <LinkIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <a
                  href={rawUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-sky-300 truncate transition-colors flex items-center gap-1"
                >
                  <span className="truncate">{rawUrl}</span>
                  <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                </a>
                <button
                  onClick={handleCopyLink}
                  className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors shrink-0"
                  title="Copy URL"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <span className="text-slate-500">No active media stream URL</span>
            )}
          </div>
        </div>
      </div>

      {/* Real-time Track Duration Progress & Seeking */}
      <div className="w-full my-3 p-3 sm:p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 shadow-inner">
        {/* Progress Bar & Timestamps */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-1.5 text-sky-400 font-semibold">
              <Clock className="w-3.5 h-3.5" />
              <span>{formatSeconds(currentDisplayElapsed)}</span>
            </div>

            <div className="flex items-center gap-2">
              {isAdmin ? (
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Seek Active
                </span>
              ) : (
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">
                  Read-Only Sync
                </span>
              )}
              <span className="text-slate-400 font-medium">
                {duration > 0 ? formatSeconds(duration) : isPlaying ? "Live / Stream" : "--:--"}
              </span>
            </div>
          </div>

          {/* Interactive Scrub Slider (Admin) or Read-Only Progress (Subscriber) */}
          {isAdmin ? (
            <div className="relative flex items-center group py-1">
              <input
                type="range"
                min="0"
                max={effectiveDuration}
                step="1"
                value={currentDisplayElapsed}
                onPointerDown={() => setIsScrubbing(true)}
                onMouseDown={() => setIsScrubbing(true)}
                onTouchStart={() => setIsScrubbing(true)}
                onInput={(e) => handleSeekInput(Number((e.target as HTMLInputElement).value))}
                onChange={(e) => handleSeekInput(Number(e.target.value))}
                onPointerUp={handleSeekCommit}
                onMouseUp={handleSeekCommit}
                onTouchEnd={handleSeekCommit}
                onKeyUp={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    handleSeekCommit();
                  }
                }}
                disabled={!isPlaying && !isPaused}
                className="w-full h-2.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400 focus:outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: `linear-gradient(to right, #38bdf8 0%, #6366f1 ${progressPercent}%, #1e293b ${progressPercent}%, #1e293b 100%)`,
                }}
                title="Click or drag to seek track position"
              />
            </div>
          ) : (
            <div className="w-full h-2.5 rounded-lg bg-slate-800 overflow-hidden relative">
              <div
                className="h-full bg-gradient-to-r from-sky-400 via-indigo-500 to-sky-400 transition-all duration-300 rounded-lg"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </div>

        {/* Admin Quick Progress Togglers (+10s, +30s, -10s, -30s) */}
        {isAdmin && isPlaying && (
          <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-slate-800/60 flex-wrap">
            <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
              <span>Progress Toggler</span>
            </span>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onSeekRelative?.(-30)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                title="Rewind 30 seconds"
              >
                <RotateCcw className="w-3 h-3 text-sky-400" />
                <span>-30s</span>
              </button>
              <button
                onClick={() => onSeekRelative?.(-10)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                title="Rewind 10 seconds"
              >
                <RotateCcw className="w-3 h-3 text-sky-400" />
                <span>-10s</span>
              </button>
              <button
                onClick={() => onSeekRelative?.(10)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                title="Forward 10 seconds"
              >
                <span>+10s</span>
                <RotateCw className="w-3 h-3 text-sky-400" />
              </button>
              <button
                onClick={() => onSeekRelative?.(30)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                title="Forward 30 seconds"
              >
                <span>+30s</span>
                <RotateCw className="w-3 h-3 text-sky-400" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Admin Playback Controls & Master Volume */}
      {isAdmin ? (
        <>
          {/* Control Buttons Bar */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-2.5">
            {/* Previous Button */}
            <button
              onClick={onPlayPrevious}
              className="flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2.5 sm:py-3 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 text-xs font-semibold transition-all hover:scale-105 active:scale-95 min-h-[44px]"
              title="Play Previous Track"
            >
              <SkipBack className="w-4 h-4 text-slate-300 shrink-0" />
              <span className="truncate">Previous</span>
            </button>

            {/* Play/Pause Button */}
            <button
              onClick={onTogglePlayPause}
              className="flex items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2.5 sm:py-3 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs sm:text-sm shadow-lg shadow-sky-500/25 transition-all hover:scale-105 active:scale-95 min-h-[44px]"
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-white shrink-0" /> : <Play className="w-4 h-4 fill-white shrink-0" />}
              <span className="truncate">{isPlaying ? "Pause" : isPaused ? "Resume" : "Play"}</span>
            </button>

            {/* Skip Next */}
            <button
              onClick={onSkipTrack}
              className="flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2.5 sm:py-3 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 text-xs font-semibold transition-all hover:scale-105 active:scale-95 min-h-[44px]"
              title="Skip to Next Track"
            >
              <SkipForward className="w-4 h-4 text-slate-300 shrink-0" />
              <span className="truncate">Next</span>
            </button>

            {/* Loop Toggle */}
            <button
              onClick={onToggleLoop}
              className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2.5 sm:py-3 rounded-2xl border text-xs font-semibold transition-all hover:scale-105 active:scale-95 min-h-[44px] ${
                loopMode === "repeat-one" || loopMode === "one"
                  ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
                  : loopMode === "repeat" || loopMode === "yes"
                  ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
                  : "bg-slate-800/80 text-slate-400 border-slate-700"
              }`}
            >
              {loopMode === "repeat-one" || loopMode === "one" ? (
                <Repeat1 className="w-4 h-4 text-indigo-400 shrink-0" />
              ) : (
                <Repeat className="w-4 h-4 shrink-0" />
              )}
              <span className="truncate">
                <span className="hidden sm:inline">Loop: </span>
                <strong>
                  {loopMode === "repeat-one" || loopMode === "one"
                    ? "ONE"
                    : loopMode === "repeat" || loopMode === "yes"
                    ? "REPEAT"
                    : "OFF"}
                </strong>
              </span>
            </button>

            {/* Broadcast Mode Toggle */}
            <button
              onClick={onToggleMode}
              className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2.5 sm:py-3 rounded-2xl border text-xs font-semibold transition-all hover:scale-105 active:scale-95 min-h-[44px] ${
                broadcastMode === "speaker"
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  : "bg-slate-800/80 text-slate-300 border-slate-700"
              }`}
            >
              {broadcastMode === "speaker" ? (
                <Volume2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-400 shrink-0" />
              )}
              <span className="truncate">
                <span className="hidden sm:inline">Mode: </span>
                <strong>{broadcastMode.toUpperCase()}</strong>
              </span>
            </button>

            {/* Stop Button */}
            <button
              onClick={onStopMusic}
              className="flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2.5 sm:py-3 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold transition-all hover:scale-105 active:scale-95 min-h-[44px]"
            >
              <Square className="w-3.5 h-3.5 fill-rose-400 shrink-0" />
              <span className="truncate">Stop</span>
            </button>
          </div>

          {/* Volume Bar */}
          <VolumeControls
            volume={volume}
            onVolumeChange={onVolumeChange}
            onVolumeStep={onVolumeStep}
            onToggleMute={onToggleMute}
          />
        </>
      ) : (
        /* Subscriber Stream Info Box */
        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-800/60 border border-slate-700/50 mt-2 text-xs">
          <div className="flex items-center gap-2.5 text-slate-300">
            <div className="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
              <Headphones className="w-4 h-4" />
            </div>
            <div>
              <div className="font-semibold text-white">Live Stream Listening</div>
              <div className="text-[11px] text-slate-400">Continuous 24/7 synchronized broadcast</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span>Audio Live</span>
          </div>
        </div>
      )}
    </main>
  );
}
