"use client";

import { useState, KeyboardEvent, DragEvent, useMemo } from "react";
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
  AlertCircle,
  Eye,
  GripVertical,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Lock,
} from "lucide-react";
import { ServerStatus, Track } from "@/types";
import { formatTrackDisplay } from "@/lib/utils";
import { ConfirmationModal } from "./ConfirmationModal";

interface PlaybackListProps {
  status: ServerStatus | null;
  isAdmin?: boolean;
  onTogglePlaybackMode: () => void;
  onResetHistory: () => void;
  onClearList: () => void;
  onPlayTrack: (index: number) => void;
  onRemoveTrack: (index: number) => void;
  onMoveTrack?: (fromIndex: number, toIndex: number) => void;
  onReorderTracks?: (trackIds: string[]) => void;
  onQuickAdd: (url: string, title?: string) => void;
  onQuickInterrupt: (url: string, title?: string) => void;
  onSaveToPlaylist: (url: string, title?: string, thumbnail?: string) => void;
}

interface CategorizedTrack {
  track: Track;
  globalIndex: number;
  queueIndex?: number;
  playedIndex?: number;
}

export function PlaybackList({
  status,
  isAdmin = true,
  onTogglePlaybackMode,
  onResetHistory,
  onClearList,
  onPlayTrack,
  onRemoveTrack,
  onMoveTrack,
  onReorderTracks,
  onQuickAdd,
  onQuickInterrupt,
  onSaveToPlaylist,
}: PlaybackListProps) {
  const [quickInput, setQuickInput] = useState("");
  const [trackToDelete, setTrackToDelete] = useState<{ index: number; title: string } | null>(null);
  const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
  const [draggedQueueIndex, setDraggedQueueIndex] = useState<number | null>(null);
  const [dragOverQueueIndex, setDragOverQueueIndex] = useState<number | null>(null);

  const playback = status?.playback;
  const tracks = playback?.tracks || [];
  const mode = playback?.mode || status?.queue?.mode || "ordered";
  const totalCount = playback?.total_count || 0;
  const playedCount = playback?.played_count || 0;
  const queuedCount = playback?.queued_count || 0;
  const playingCount = playback?.playing_count || (status?.state === "playing" ? 1 : 0);

  // Group tracks with their original global indices
  const { playingTrack, queuedTracks, playedTracks } = useMemo<{
    playingTrack: CategorizedTrack | null;
    queuedTracks: CategorizedTrack[];
    playedTracks: CategorizedTrack[];
  }>(() => {
    let currentPlaying: CategorizedTrack | null = null;
    const upcoming: CategorizedTrack[] = [];
    const completed: CategorizedTrack[] = [];

    let qIdx = 0;
    let pIdx = 0;

    tracks.forEach((track, globalIndex) => {
      const trackStatus = track.status || "queued";
      if (trackStatus === "playing" && !currentPlaying) {
        currentPlaying = { track, globalIndex };
      } else if (trackStatus === "played") {
        completed.push({ track, globalIndex, playedIndex: pIdx++ });
      } else {
        upcoming.push({ track, globalIndex, queueIndex: qIdx++ });
      }
    });

    return {
      playingTrack: currentPlaying,
      queuedTracks: upcoming,
      playedTracks: completed,
    };
  }, [tracks]);

  const handleAdd = () => {
    if (!isAdmin || !quickInput.trim()) return;
    onQuickAdd(quickInput.trim());
    setQuickInput("");
  };

  const handleInterrupt = () => {
    if (!isAdmin || !quickInput.trim()) return;
    onQuickInterrupt(quickInput.trim());
    setQuickInput("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleAdd();
    }
  };

  // Reorder handlers strictly for queued / upcoming tracks
  const handleMoveQueuedUp = (queueIdx: number) => {
    if (!isAdmin || queueIdx <= 0 || queueIdx >= queuedTracks.length) return;
    const sourceGlobal = queuedTracks[queueIdx].globalIndex;
    const targetGlobal = queuedTracks[queueIdx - 1].globalIndex;

    if (onMoveTrack) {
      onMoveTrack(sourceGlobal, targetGlobal);
    } else if (onReorderTracks) {
      const reorderedQueue = [...queuedTracks];
      const [moved] = reorderedQueue.splice(queueIdx, 1);
      reorderedQueue.splice(queueIdx - 1, 0, moved);
      onReorderTracks(reorderedQueue.map((item) => String(item.track.id)));
    }
  };

  const handleMoveQueuedDown = (queueIdx: number) => {
    if (!isAdmin || queueIdx < 0 || queueIdx >= queuedTracks.length - 1) return;
    const sourceGlobal = queuedTracks[queueIdx].globalIndex;
    const targetGlobal = queuedTracks[queueIdx + 1].globalIndex;

    if (onMoveTrack) {
      onMoveTrack(sourceGlobal, targetGlobal);
    } else if (onReorderTracks) {
      const reorderedQueue = [...queuedTracks];
      const [moved] = reorderedQueue.splice(queueIdx, 1);
      reorderedQueue.splice(queueIdx + 1, 0, moved);
      onReorderTracks(reorderedQueue.map((item) => String(item.track.id)));
    }
  };

  // Drag and Drop strictly for upcoming tracks
  const handleDragStart = (e: DragEvent<HTMLDivElement>, queueIdx: number) => {
    if (!isAdmin) return;
    setDraggedQueueIndex(queueIdx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", queueIdx.toString());
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, queueIdx: number) => {
    if (!isAdmin || draggedQueueIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverQueueIndex !== queueIdx) {
      setDragOverQueueIndex(queueIdx);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, targetQueueIdx: number) => {
    if (!isAdmin || draggedQueueIndex === null) return;
    e.preventDefault();
    const sourceQueueIdx = draggedQueueIndex;
    setDraggedQueueIndex(null);
    setDragOverQueueIndex(null);

    if (sourceQueueIdx === targetQueueIdx) return;
    if (sourceQueueIdx < 0 || sourceQueueIdx >= queuedTracks.length) return;
    if (targetQueueIdx < 0 || targetQueueIdx >= queuedTracks.length) return;

    const sourceGlobal = queuedTracks[sourceQueueIdx].globalIndex;
    const targetGlobal = queuedTracks[targetQueueIdx].globalIndex;

    if (onMoveTrack) {
      onMoveTrack(sourceGlobal, targetGlobal);
    } else if (onReorderTracks) {
      const reorderedQueue = [...queuedTracks];
      const [moved] = reorderedQueue.splice(sourceQueueIdx, 1);
      reorderedQueue.splice(targetQueueIdx, 0, moved);
      onReorderTracks(reorderedQueue.map((item) => String(item.track.id)));
    }
  };

  const handleDragEnd = () => {
    setDraggedQueueIndex(null);
    setDragOverQueueIndex(null);
  };

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
          {!isAdmin && (
            <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/30 text-[11px] font-semibold text-sky-300">
              <Eye className="w-3 h-3" />
              <span>View Only</span>
            </span>
          )}
        </div>

        {isAdmin ? (
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
              onClick={() => setIsConfirmClearOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-rose-500/20 border border-slate-700 hover:border-rose-500/40 text-xs font-semibold text-slate-400 hover:text-rose-300 transition-all hover:scale-105"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear List</span>
            </button>
          </div>
        ) : (
          <div className="text-xs text-slate-400 font-medium">
            Mode: <strong className="text-slate-200 capitalize">{mode}</strong>
          </div>
        )}
      </div>

      {/* Summary Pills */}
      <div className="flex items-center gap-2 my-4 overflow-x-auto pb-1 text-xs font-medium">
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 shrink-0">
          <Radio className="w-3.5 h-3.5 animate-pulse" />
          <span>{playingCount} Playing</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-300 shrink-0">
          <Clock className="w-3.5 h-3.5" />
          <span>{queuedCount} Upcoming</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{playedCount} Played</span>
        </div>
      </div>

      {/* Main Track List Container */}
      <div className="max-h-[500px] overflow-y-auto space-y-4 pr-1">
        {tracks.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">
            Playback list is currently empty. Add tracks using the input below or search for music.
          </div>
        ) : (
          <>
            {/* 1. NOW PLAYING SECTION (Locked, Elevated Glow) */}
            {playingTrack && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 px-1 text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
                  <Radio className="w-3.5 h-3.5 animate-pulse" />
                  <span>Now Broadcasting</span>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl border bg-emerald-950/20 border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.15)] transition-all">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Live Radio Badge */}
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold uppercase shrink-0">
                      <Radio className="w-3 h-3 animate-pulse" />
                      <span>LIVE</span>
                    </span>

                    {/* Thumbnail */}
                    {playingTrack.track.thumbnail ? (
                      <img
                        src={playingTrack.track.thumbnail}
                        alt={formatTrackDisplay(playingTrack.track.title, playingTrack.track.url).title}
                        className="w-11 h-11 rounded-xl object-cover shrink-0 border border-emerald-500/30"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-xl bg-emerald-900/40 flex items-center justify-center text-emerald-400 shrink-0 border border-emerald-500/30">
                        <Music2 className="w-5 h-5" />
                      </div>
                    )}

                    {/* Title & Info */}
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white truncate">
                        {formatTrackDisplay(playingTrack.track.title, playingTrack.track.url).title}
                      </div>
                      <div className="text-[11px] text-emerald-300/70 truncate mt-0.5">
                        {formatTrackDisplay(playingTrack.track.title, playingTrack.track.url).url || "Current stream"}
                      </div>
                    </div>
                  </div>

                  {/* Controls */}
                  {isAdmin ? (
                    <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                      <button
                        onClick={() => onPlayTrack(playingTrack.globalIndex)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-xs font-semibold border border-emerald-500/40 transition-all hover:scale-105"
                        title="Restart current track"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                        <span>Replay</span>
                      </button>
                      <button
                        onClick={() =>
                          onSaveToPlaylist(
                            playingTrack.track.url,
                            playingTrack.track.title,
                            playingTrack.track.thumbnail || undefined
                          )
                        }
                        className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        title="Save to Playlist"
                      >
                        <BookmarkPlus className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() =>
                          setTrackToDelete({
                            index: playingTrack.globalIndex,
                            title: formatTrackDisplay(playingTrack.track.title, playingTrack.track.url).title,
                          })
                        }
                        className="p-1.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        title="Remove track"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="text-[11px] text-emerald-400 font-semibold self-end sm:self-center">Playing</div>
                  )}
                </div>
              </div>
            )}

            {/* 2. UPCOMING QUEUE SECTION (Reorderable with Drag & Drop & Move Up/Down) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1 text-[11px] font-bold text-sky-400 uppercase tracking-wider">
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Upcoming Queue ({queuedTracks.length})</span>
                </div>
                {isAdmin && queuedTracks.length > 1 && (
                  <span className="text-[10px] font-medium text-slate-400 lowercase">
                    Drag handle or use ▲/▼ to reorder
                  </span>
                )}
              </div>

              {queuedTracks.length === 0 ? (
                <div className="py-6 px-4 rounded-2xl bg-slate-900/40 border border-slate-800 text-center text-xs text-slate-400">
                  No upcoming tracks in queue. Add songs below or search to append.
                </div>
              ) : (
                queuedTracks.map(({ track, globalIndex, queueIndex = 0 }) => {
                  const display = formatTrackDisplay(track.title, track.url);
                  const thumb = track.thumbnail;
                  const isNext = queueIndex === 0;
                  const isBeingDragged = draggedQueueIndex === queueIndex;
                  const isTargetOver = dragOverQueueIndex === queueIndex && draggedQueueIndex !== queueIndex;

                  return (
                    <div
                      key={track.id || globalIndex}
                      draggable={isAdmin}
                      onDragStart={(e) => handleDragStart(e, queueIndex)}
                      onDragOver={(e) => handleDragOver(e, queueIndex)}
                      onDrop={(e) => handleDrop(e, queueIndex)}
                      onDragEnd={handleDragEnd}
                      className={`group flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-2xl border transition-all ${
                        isBeingDragged
                          ? "opacity-40 scale-[0.98] border-dashed border-sky-500 bg-sky-950/40"
                          : isTargetOver
                          ? "border-sky-400 ring-2 ring-sky-400/40 bg-sky-900/40 scale-[1.01]"
                          : isNext
                          ? "bg-amber-500/10 border-amber-500/30"
                          : "bg-slate-800/40 hover:bg-slate-800/80 border-slate-700/40"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* Reorder Controls (Admin only on queued items) */}
                        {isAdmin && (
                          <div className="flex items-center gap-1 shrink-0">
                            {/* Drag Handle */}
                            <div
                              className="p-1 rounded-lg text-slate-500 group-hover:text-slate-300 hover:text-sky-400 cursor-grab active:cursor-grabbing transition-colors"
                              title="Drag to reorder queue"
                            >
                              <GripVertical className="w-4 h-4" />
                            </div>

                            {/* Move Up / Down Buttons */}
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveQueuedUp(queueIndex);
                                }}
                                disabled={queueIndex === 0}
                                className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-sky-300 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-colors"
                                title="Move Up in Queue"
                              >
                                <ChevronUp className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveQueuedDown(queueIndex);
                                }}
                                disabled={queueIndex === queuedTracks.length - 1}
                                className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-sky-300 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-colors"
                                title="Move Down in Queue"
                              >
                                <ChevronDown className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Queue Position Badge */}
                        <span
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold shrink-0 ${
                            isNext
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                              : "bg-slate-800 text-slate-400 border border-slate-700"
                          }`}
                        >
                          <Clock className="w-3 h-3" />
                          <span>{isNext ? "NEXT UP" : `#${queueIndex + 1}`}</span>
                        </span>

                        {/* Thumbnail Preview */}
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={display.title}
                            className="w-10 h-10 rounded-xl object-cover shrink-0 border border-slate-700"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 shrink-0 border border-slate-700">
                            <Music2 className="w-4 h-4" />
                          </div>
                        )}

                        {/* Title & Info */}
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">{display.title}</div>
                          <div className="text-[10px] text-slate-400 truncate mt-0.5">
                            {display.url || "Audio track"}
                          </div>
                        </div>
                      </div>

                      {/* Track Actions */}
                      {isAdmin ? (
                        <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                          <button
                            onClick={() => onPlayTrack(globalIndex)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 text-xs font-semibold border border-sky-500/40 transition-all hover:scale-105"
                            title="Play immediately"
                          >
                            <Play className="w-3.5 h-3.5 fill-sky-300" />
                            <span>Play Now</span>
                          </button>
                          <button
                            onClick={() => onSaveToPlaylist(track.url, track.title, thumb || undefined)}
                            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                            title="Save to Playlist"
                          >
                            <BookmarkPlus className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setTrackToDelete({ index: globalIndex, title: display.title })}
                            className="p-1.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Remove from queue"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500 font-medium self-end sm:self-center">
                          Queued
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* 3. PLAYED HISTORY SECTION (Locked & Non-Reorderable) */}
            {playedTracks.length > 0 && (
              <div className="pt-2 border-t border-slate-800/80 space-y-2">
                <button
                  type="button"
                  onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                  className="w-full flex items-center justify-between px-1 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider hover:text-slate-200 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" />
                    <span>Played History ({playedTracks.length})</span>
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 lowercase font-normal">
                      <Lock className="w-2.5 h-2.5" />
                      locked
                    </span>
                  </div>
                  <ChevronRight
                    className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-200 ${
                      isHistoryOpen ? "rotate-90" : ""
                    }`}
                  />
                </button>

                {isHistoryOpen && (
                  <div className="space-y-1.5 opacity-80 hover:opacity-100 transition-opacity">
                    {playedTracks.map(({ track, globalIndex }) => {
                      const display = formatTrackDisplay(track.title, track.url);
                      const thumb = track.thumbnail;

                      return (
                        <div
                          key={track.id || globalIndex}
                          draggable={false}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2.5 rounded-2xl border bg-slate-900/40 border-slate-800/80 transition-all"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {/* Played Status Badge (No Drag Handles, No Move Buttons) */}
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800 text-slate-400 text-[10px] font-medium shrink-0">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              <span>PLAYED</span>
                            </span>

                            {/* Thumbnail Preview */}
                            {thumb ? (
                              <img
                                src={thumb}
                                alt={display.title}
                                className="w-9 h-9 rounded-xl object-cover shrink-0 border border-slate-800 opacity-80"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center text-slate-500 shrink-0 border border-slate-800">
                                <Music2 className="w-3.5 h-3.5" />
                              </div>
                            )}

                            {/* Title & Info */}
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-slate-300 truncate">{display.title}</div>
                              <div className="text-[10px] text-slate-500 truncate mt-0.5">
                                {display.url || "Played track"}
                              </div>
                            </div>
                          </div>

                          {/* Played Track Actions */}
                          {isAdmin ? (
                            <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                              <button
                                onClick={() => onPlayTrack(globalIndex)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium border border-slate-700 transition-all"
                                title="Replay track"
                              >
                                <RotateCw className="w-3 h-3" />
                                <span>Replay</span>
                              </button>
                              <button
                                onClick={() => onSaveToPlaylist(track.url, track.title, thumb || undefined)}
                                className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                                title="Save to Playlist"
                              >
                                <BookmarkPlus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setTrackToDelete({ index: globalIndex, title: display.title })}
                                className="p-1 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                                title="Remove from list"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="text-[10px] text-slate-500 font-medium self-end sm:self-center">
                              Completed
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Quick Add / Interrupt Bar (Admin only) */}
      {isAdmin && (
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
      )}

      {/* Duplicate Notice */}
      {isAdmin &&
        Boolean(quickInput.trim()) &&
        tracks.some(
          (t) =>
            t.url?.trim().toLowerCase() === quickInput.trim().toLowerCase() ||
            (t.title && t.title.toLowerCase() === quickInput.trim().toLowerCase())
        ) && (
          <div className="flex items-center gap-1.5 text-xs text-amber-400 mt-2 px-1 animate-in fade-in">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>This track is already in the playback list.</span>
          </div>
        )}

      {/* Confirmation Dialogs */}
      <ConfirmationModal
        isOpen={trackToDelete !== null}
        title="Remove Track from Playback"
        message={`Are you sure you want to remove "${trackToDelete?.title}" from the playback list?`}
        confirmLabel="Remove"
        onConfirm={() => {
          if (trackToDelete !== null) {
            onRemoveTrack(trackToDelete.index);
            setTrackToDelete(null);
          }
        }}
        onClose={() => setTrackToDelete(null)}
      />

      <ConfirmationModal
        isOpen={isConfirmClearOpen}
        title="Clear Playback List"
        message="Are you sure you want to clear the entire playback list? All unplayed tracks will be removed."
        confirmLabel="Clear All"
        onConfirm={() => {
          onClearList();
          setIsConfirmClearOpen(false);
        }}
        onClose={() => setIsConfirmClearOpen(false)}
      />
    </section>
  );
}
