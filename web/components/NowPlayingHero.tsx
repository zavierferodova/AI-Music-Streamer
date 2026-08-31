"use client";

import { useState } from "react";
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
} from "lucide-react";
import { ServerStatus } from "@/types";
import { formatTrackDisplay, copyToClipboard } from "@/lib/utils";
import { VolumeControls } from "./VolumeControls";
import { useToast } from "@/hooks/useToast";

interface NowPlayingHeroProps {
  status: ServerStatus | null;
  volume: number;
  onTogglePlayPause: () => void;
  onPlayPrevious: () => void;
  onSkipTrack: () => void;
  onStopMusic: () => void;
  onToggleLoop: () => void;
  onToggleMode: () => void;
  onVolumeChange: (val: number) => void;
  onVolumeStep: (delta: number) => void;
  onToggleMute: () => void;
}

export function NowPlayingHero({
  status,
  volume,
  onTogglePlayPause,
  onPlayPrevious,
  onSkipTrack,
  onStopMusic,
  onToggleLoop,
  onToggleMode,
  onVolumeChange,
  onVolumeStep,
  onToggleMute,
}: NowPlayingHeroProps) {
  const { showToast } = useToast();
  const [imgError, setImgError] = useState(false);

  const isPlaying = status?.state === "playing";
  const isPaused = status?.state === "paused";
  const isBuffering = isPlaying && !!status?.is_buffering;
  const loopMode = (status?.loop || "repeat").toLowerCase();
  const broadcastMode = status?.mode || "silent";

  const rawTitle = status?.now_playing?.title || (isPlaying ? "Audio stream decoding..." : "Idle (Ready to play)");
  const rawUrl = status?.now_playing?.url || "";
  const thumbUrl = status?.now_playing?.thumbnail;
  const display = formatTrackDisplay(rawTitle, rawUrl);

  const handleCopyLink = async () => {
    if (!rawUrl) return;
    const ok = await copyToClipboard(rawUrl);
    if (ok) {
      showToast("Copied track URL to clipboard!", "success", "check_circle");
    }
  };

  return (
    <main
      className="w-full rounded-3xl bg-slate-900/80 border border-slate-700/60 p-6 shadow-2xl backdrop-blur-xl transition-all"
      id="hero-now-playing-card"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
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
      <div className="flex flex-col sm:flex-row items-center gap-6 my-6">
        {/* Artwork Thumbnail Box */}
        <div className="relative w-36 h-36 sm:w-40 sm:h-40 rounded-2xl overflow-hidden bg-slate-800 border border-slate-700/80 shadow-xl shrink-0 group">
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
        <div className="flex-1 min-w-0 text-center sm:text-left space-y-2.5">
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight leading-tight line-clamp-2">
            {display.title}
          </h2>

          <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap text-xs text-slate-400">
            {rawUrl ? (
              <div className="flex items-center gap-1.5 max-w-md bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700/60">
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

      {/* Control Buttons Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
        {/* Previous Button */}
        <button
          onClick={onPlayPrevious}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 text-xs font-semibold transition-all hover:scale-105 active:scale-95"
          title="Play Previous Track"
        >
          <SkipBack className="w-4 h-4 text-slate-300" />
          <span>Previous</span>
        </button>

        {/* Play/Pause Button */}
        <button
          onClick={onTogglePlayPause}
          className="col-span-2 sm:col-span-1 flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-sm shadow-lg shadow-sky-500/25 transition-all hover:scale-105 active:scale-95"
        >
          {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white" />}
          <span>{isPlaying ? "Pause" : isPaused ? "Resume" : "Play"}</span>
        </button>

        {/* Skip Next */}
        <button
          onClick={onSkipTrack}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 text-xs font-semibold transition-all hover:scale-105 active:scale-95"
          title="Skip to Next Track"
        >
          <SkipForward className="w-4 h-4 text-slate-300" />
          <span>Next</span>
        </button>

        {/* Loop Toggle */}
        <button
          onClick={onToggleLoop}
          className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl border text-xs font-semibold transition-all hover:scale-105 active:scale-95 ${
            loopMode === "repeat-one" || loopMode === "one"
              ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
              : loopMode === "repeat" || loopMode === "yes"
              ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
              : "bg-slate-800/80 text-slate-400 border-slate-700"
          }`}
        >
          {loopMode === "repeat-one" || loopMode === "one" ? (
            <Repeat1 className="w-4 h-4 text-indigo-400" />
          ) : (
            <Repeat className="w-4 h-4" />
          )}
          <span>
            Loop:{" "}
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
          className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl border text-xs font-semibold transition-all hover:scale-105 active:scale-95 ${
            broadcastMode === "speaker"
              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
              : "bg-slate-800/80 text-slate-300 border-slate-700"
          }`}
        >
          {broadcastMode === "speaker" ? (
            <Volume2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <VolumeX className="w-4 h-4 text-slate-400" />
          )}
          <span>
            Mode: <strong>{broadcastMode.toUpperCase()}</strong>
          </span>
        </button>

        {/* Stop Button */}
        <button
          onClick={onStopMusic}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold transition-all hover:scale-105 active:scale-95"
        >
          <Square className="w-3.5 h-3.5 fill-rose-400" />
          <span>Stop</span>
        </button>
      </div>

      {/* Volume Bar */}
      <VolumeControls
        volume={volume}
        onVolumeChange={onVolumeChange}
        onVolumeStep={onVolumeStep}
        onToggleMute={onToggleMute}
      />
    </main>
  );
}
