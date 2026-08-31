"use client";

import { PlayCircle, Volume2, Radio, Repeat, ListMusic, FastForward } from "lucide-react";
import { ServerStatus } from "@/types";
import { formatTrackDisplay } from "@/lib/utils";

interface StatusGridProps {
  status: ServerStatus | null;
}

export function StatusGrid({ status }: StatusGridProps) {
  const isPlaying = status?.state === "playing";
  const isPaused = status?.state === "paused";
  const isBuffering = isPlaying && !!status?.is_buffering;
  const loopMode = (status?.loop || "repeat").toUpperCase();
  const broadcastMode = (status?.mode || "silent").toUpperCase();
  const volumeVal = status?.volume ?? 80;

  const playback = status?.playback;
  const totalCount = playback?.total_count ?? 0;
  const playedCount = playback?.played_count ?? 0;
  const queuedCount = playback?.queued_count ?? 0;

  const nextTrack = status?.next || playback?.next;
  const nextDisplay = formatTrackDisplay(nextTrack?.title, nextTrack?.url);

  return (
    <section className="grid grid-cols-2 md:grid-cols-3 gap-3.5 my-6" aria-label="Music Status Metrics">
      {/* 1. Playback State */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-md flex flex-col justify-between">
        <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
          <PlayCircle className="w-4 h-4 text-sky-400" />
          <span>Playback State</span>
        </div>
        <div className="my-2">
          <div
            className={`text-lg font-bold tracking-tight ${
              isBuffering
                ? "text-sky-400 animate-pulse"
                : isPlaying
                ? "text-emerald-400"
                : isPaused
                ? "text-amber-400"
                : "text-slate-400"
            }`}
          >
            {isBuffering ? "BUFFERING" : isPlaying ? "PLAYING" : isPaused ? "PAUSED" : "STOPPED"}
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {isBuffering
              ? "Buffering audio chunks..."
              : isPlaying
              ? "Audio decoding active"
              : isPaused
              ? "Playback paused (silence stream)"
              : "Broadcasting comfort silence"}
          </div>
        </div>
      </div>

      {/* 2. Server Volume */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-md flex flex-col justify-between">
        <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
          <Volume2 className="w-4 h-4 text-indigo-400" />
          <span>Server Volume</span>
        </div>
        <div className="my-2">
          <div className="text-lg font-bold text-white tracking-tight">{volumeVal}%</div>
          <div className="text-[11px] text-slate-500">ALSA Master Synced</div>
        </div>
      </div>

      {/* 3. Broadcast Mode */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-md flex flex-col justify-between">
        <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
          <Radio className="w-4 h-4 text-emerald-400" />
          <span>Broadcast Mode</span>
        </div>
        <div className="my-2">
          <div
            className={`text-lg font-bold tracking-tight ${
              broadcastMode === "SPEAKER" ? "text-emerald-400" : "text-slate-300"
            }`}
          >
            {broadcastMode}
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {broadcastMode === "SPEAKER" ? "Server speaker unmuted + stream" : "HTTP stream broadcast only"}
          </div>
        </div>
      </div>

      {/* 4. Loop Setting */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-md flex flex-col justify-between">
        <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
          <Repeat className="w-4 h-4 text-purple-400" />
          <span>Loop Setting</span>
        </div>
        <div className="my-2">
          <div
            className={`text-lg font-bold tracking-tight ${
              loopMode === "REPEAT-ONE"
                ? "text-indigo-400"
                : loopMode === "REPEAT" || loopMode === "YES"
                ? "text-sky-400"
                : "text-slate-400"
            }`}
          >
            {loopMode}
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {loopMode === "REPEAT-ONE"
              ? "Repeats single current track"
              : loopMode === "REPEAT" || loopMode === "YES"
              ? "Full cycle repetition"
              : "Plays once then stops"}
          </div>
        </div>
      </div>

      {/* 5. Playback Tracklist Summary */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-md flex flex-col justify-between">
        <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
          <ListMusic className="w-4 h-4 text-sky-400" />
          <span>Playback Tracklist</span>
        </div>
        <div className="my-2">
          <div className="text-lg font-bold text-white tracking-tight">{totalCount} Tracks</div>
          <div className="text-[11px] text-slate-500 truncate">
            {playedCount} played, {queuedCount} upcoming
          </div>
        </div>
      </div>

      {/* 6. Next Up (Wide on desktop or span) */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-md flex flex-col justify-between col-span-2 md:col-span-1">
        <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
          <FastForward className="w-4 h-4 text-amber-400" />
          <span>Next Up</span>
        </div>
        <div className="my-2 min-w-0">
          <div className="text-sm font-semibold text-white truncate">
            {nextTrack ? nextDisplay.title : "None (End of list)"}
          </div>
          <div className="text-[11px] text-slate-500 truncate mt-0.5">
            {nextTrack?.url || "—"}
          </div>
        </div>
      </div>
    </section>
  );
}
