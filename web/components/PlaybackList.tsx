"use client";

import { useState, KeyboardEvent } from "react";
import {
  ListMusic,
  Shuffle,
  ListOrdered,
  RotateCcw,
  Trash2,
  Play,
  RotateCw,
  BookmarkPlus,
  X,
  Plus,
  Zap,
  Music2,
  CheckCircle2,
  Clock,
  Radio,
} from "lucide-react";
import { ServerStatus } from "@/types";
import { formatTrackDisplay } from "@/lib/utils";

interface PlaybackListProps {
  status: ServerStatus | null;
  onTogglePlaybackMode: () => void;
  onResetHistory: () => void;
  onClearList: () => void;
  onPlayTrack: (index: number) => void;
  onRemoveTrack: (index: number) => void;
  onQuickAdd: (url: string, title?: string) => void;
  onQuickInterrupt: (url: string, title?: string) => void;
  onSaveToPlaylist: (url: string, title?: string, thumbnail?: string) => void;
}

export function PlaybackList({
  status,
  onTogglePlaybackMode,
  onResetHistory,
  onClearList,
  onPlayTrack,
  onRemoveTrack,
  onQuickAdd,
  onQuickInterrupt,
  onSaveToPlaylist,
}: PlaybackListProps) {
  const [quickInput, setQuickInput] = useState("");

  const playback = status?.playback;
  const tracks = playback?.tracks || [];
  const mode = playback?.mode || status?.queue?.mode || "ordered";
  const totalCount = playback?.total_count || 0;
  const playedCount = playback?.played_count || 0;
  const queuedCount = playback?.queued_count || 0;
  const playingCount = playback?.playing_count || (status?.state === "playing" ? 1 : 0);

  const handleAdd = () => {
    if (!quickInput.trim()) return;
    onQuickAdd(quickInput.trim());
    setQuickInput("");
  };

  const handleInterrupt = () => {
    if (!quickInput.trim()) return;
    onQuickInterrupt(quickInput.trim());
    setQuickInput("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleAdd();
    }
  };

  let upcomingIndex = 1;

  return (
    <section className="w-full my-6 p-5 sm:p-6 rounded-3xl bg-slate-900/80 border border-slate-700/60 shadow-xl backdrop-blur-xl">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <ListMusic className="w-5 h-5 text-sky-400" />
          <h3 className="text-base font-bold text-white tracking-tight">Playback List</h3>
          <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-xs font-semibold text-sky-300">
            {totalCount}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Mode Toggle Button */}
          <button
            onClick={onTogglePlaybackMode}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all hover:scale-105 ${
              mode === "shuffled"
                ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
                : "bg-slate-800/80 text-slate-300 border-slate-700 hover:text-white"
            }`}
          >
            {mode === "shuffled" ? <Shuffle className="w-3.5 h-3.5" /> : <ListOrdered className="w-3.5 h-3.5" />}
            <span>{mode === "shuffled" ? "Shuffled" : "Ordered"}</span>
          </button>

          {/* Replay All */}
          <button
            onClick={onResetHistory}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition-all hover:scale-105"
            title="Reset played history for a fresh replay cycle"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Replay All</span>
          </button>

          {/* Clear List */}
          <button
            onClick={onClearList}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-rose-500/20 border border-slate-700 hover:border-rose-500/40 text-xs font-semibold text-slate-400 hover:text-rose-300 transition-all hover:scale-105"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear List</span>
          </button>
        </div>
      </div>

      {/* Summary Pills */}
      <div className="flex items-center gap-2 my-4 overflow-x-auto pb-1 text-xs font-medium">
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
          <Radio className="w-3.5 h-3.5 animate-pulse" />
          <span>{playingCount} Playing</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-300">
          <Clock className="w-3.5 h-3.5" />
          <span>{queuedCount} Upcoming</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-800 border border-slate-700 text-slate-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{playedCount} Played</span>
        </div>
      </div>

      {/* Track Items List */}
      <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
        {tracks.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            Playback list is currently empty. Add tracks below or search YouTube.
          </div>
        ) : (
          tracks.map((track, idx) => {
            const status = track.status || "queued";
            const display = formatTrackDisplay(track.title, track.url);
            const thumb = track.thumbnail;

            const isNext = status === "queued" && upcomingIndex === 1;
            if (status === "queued") upcomingIndex++;

            return (
              <div
                key={idx}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-2xl border transition-all ${
                  status === "playing"
                    ? "bg-sky-500/10 border-sky-500/30 shadow-[0_0_15px_rgba(56,189,248,0.15)]"
                    : status === "played"
                    ? "bg-slate-900/40 border-slate-800/80 opacity-70"
                    : isNext
                    ? "bg-amber-500/10 border-amber-500/30"
                    : "bg-slate-800/40 hover:bg-slate-800/80 border-slate-700/40"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Status Badge */}
                  {status === "playing" ? (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold uppercase shrink-0">
                      <Radio className="w-3 h-3 animate-pulse" />
                      <span>PLAYING</span>
                    </span>
                  ) : status === "played" ? (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800 text-slate-400 text-[10px] font-medium shrink-0">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>PLAYED</span>
                    </span>
                  ) : (
                    <span
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold shrink-0 ${
                        isNext
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                          : "bg-slate-800 text-slate-300"
                      }`}
                    >
                      <Clock className="w-3 h-3" />
                      <span>#{upcomingIndex - 1}{isNext ? " NEXT" : ""}</span>
                    </span>
                  )}

                  {/* Thumbnail */}
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={display.title}
                      className="w-10 h-10 rounded-xl object-cover shrink-0 border border-slate-700"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 shrink-0 border border-slate-700">
                      <Music2 className="w-5 h-5" />
                    </div>
                  )}

                  {/* Info */}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{display.title}</div>
                    {display.url && (
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">{display.url}</div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                  {status === "playing" ? (
                    <button
                      onClick={() => onPlayTrack(idx)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 text-xs font-semibold border border-sky-500/40 transition-all"
                      title="Restart playback"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>Restart</span>
                    </button>
                  ) : status === "played" ? (
                    <button
                      onClick={() => onPlayTrack(idx)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-all"
                      title="Replay this track"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>Replay</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => onPlayTrack(idx)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 text-xs font-semibold border border-sky-500/40 transition-all"
                      title="Play now"
                    >
                      <Play className="w-3.5 h-3.5 fill-sky-300" />
                      <span>Play Now</span>
                    </button>
                  )}

                  <button
                    onClick={() => onSaveToPlaylist(track.url, track.title, thumb || undefined)}
                    className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                    title="Save to Playlist"
                  >
                    <BookmarkPlus className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onRemoveTrack(idx)}
                    className="p-1.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    title="Remove track"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Quick Add / Interrupt Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-2.5 mt-5 pt-4 border-t border-slate-800">
        <input
          type="text"
          value={quickInput}
          onChange={(e) => setQuickInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste YouTube URL or song name..."
          className="w-full sm:flex-1 rounded-2xl bg-slate-800/80 border border-slate-700 text-sm text-white placeholder-slate-400 px-4 py-2.5 outline-none focus:border-sky-500/50"
        />
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={handleAdd}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-2xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 text-xs font-semibold border border-sky-500/40 shadow-sm transition-all hover:scale-105 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Add to List</span>
          </button>
          <button
            onClick={handleInterrupt}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-sky-500/20 transition-all hover:scale-105 active:scale-95"
          >
            <Zap className="w-4 h-4 fill-white" />
            <span>Play Now</span>
          </button>
        </div>
      </div>
    </section>
  );
}
