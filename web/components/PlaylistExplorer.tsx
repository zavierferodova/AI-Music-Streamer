"use client";

import { useState, useEffect, useCallback, KeyboardEvent, DragEvent } from "react";
import {
  Library,
  Plus,
  Search,
  ListMusic,
  Disc3,
  Edit2,
  Play,
  Shuffle,
  ListPlus,
  Trash2,
  PlusCircle,
  X,
  Music2,
  ChevronUp,
  ChevronDown,
  GripVertical,
} from "lucide-react";
import { Playlist, Track } from "@/types";
import {
  fetchPlaylist,
  createPlaylist,
  renamePlaylist,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  movePlaylistTrack,
  reorderPlaylistTracks,
} from "@/lib/api";
import { formatTrackDisplay, getThumbnailFromUrl, matchesSearchQuery } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { ConfirmationModal } from "./ConfirmationModal";
import { PromptInputModal } from "./PromptInputModal";

interface PlaylistExplorerProps {
  playlists: Playlist[];
  onPlayPlaylist: (name: string, shuffle?: boolean) => void;
  onQueuePlaylist: (name: string, shuffle?: boolean) => void;
  onPlaySingleUrl: (url: string, title?: string) => void;
  onRefreshStatus: () => void;
}

export function PlaylistExplorer({
  playlists,
  onPlayPlaylist,
  onQueuePlaylist,
  onPlaySingleUrl,
  onRefreshStatus,
}: PlaylistExplorerProps) {
  const { showToast } = useToast();
  const [selectedPlaylistName, setSelectedPlaylistName] = useState<string | null>(null);
  const [activePlaylistData, setActivePlaylistData] = useState<Playlist | null>(null);
  const [playlistSearchFilter, setPlaylistSearchFilter] = useState("");
  const [trackSearchFilter, setTrackSearchFilter] = useState("");
  const [newTrackInput, setNewTrackInput] = useState("");
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [trackToDelete, setTrackToDelete] = useState<{ index: number; title: string } | null>(null);
  const [playlistToDelete, setPlaylistToDelete] = useState<string | null>(null);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Auto-select first playlist if none selected
  useEffect(() => {
    if (playlists.length > 0) {
      if (
        !selectedPlaylistName ||
        !playlists.some((p) => p.name.toLowerCase() === selectedPlaylistName.toLowerCase())
      ) {
        setSelectedPlaylistName(playlists[0].name);
      }
    } else {
      setSelectedPlaylistName(null);
      setActivePlaylistData(null);
    }
  }, [playlists, selectedPlaylistName]);

  // Load active playlist data
  const loadPlaylistDetails = useCallback(
    async (name: string, showSkeleton: boolean = false) => {
      if (!name) return;
      if (showSkeleton) setLoadingTracks(true);
      try {
        const data = await fetchPlaylist(name);
        if (data) {
          setActivePlaylistData(data);
        }
      } catch (err) {
        console.error("loadPlaylistDetails error:", err);
      } finally {
        setLoadingTracks(false);
      }
    },
    []
  );

  useEffect(() => {
    if (selectedPlaylistName) {
      loadPlaylistDetails(selectedPlaylistName, true);
    }
  }, [selectedPlaylistName, loadPlaylistDetails]);

  // Actions
  const handleCreateNewPlaylist = () => {
    setIsCreateModalOpen(true);
  };

  const executeCreatePlaylist = async (name: string) => {
    const ok = await createPlaylist(name);
    if (ok) {
      showToast(`Created playlist "${name}"`, "success", "library_add");
      setSelectedPlaylistName(name);
      onRefreshStatus();
    } else {
      showToast("Failed to create playlist", "error", "error_outline");
    }
  };

  const handleRenamePlaylist = () => {
    if (!selectedPlaylistName) return;
    setIsRenameModalOpen(true);
  };

  const executeRenamePlaylist = async (newName: string) => {
    if (!selectedPlaylistName || newName === selectedPlaylistName) return;
    const ok = await renamePlaylist(selectedPlaylistName, newName);
    if (ok) {
      showToast(`Renamed playlist to "${newName}"`, "success", "edit");
      setSelectedPlaylistName(newName);
      onRefreshStatus();
    } else {
      showToast("Failed to rename playlist", "error", "error_outline");
    }
  };

  const executeDeletePlaylist = async (target: string) => {
    const ok = await deletePlaylist(target);
    if (ok) {
      showToast(`Deleted playlist "${target}"`, "info", "delete");
      setSelectedPlaylistName(null);
      setActivePlaylistData(null);
      onRefreshStatus();
    } else {
      showToast("Failed to delete playlist", "error", "error_outline");
    }
  };

  const handleAddTrack = async () => {
    if (!selectedPlaylistName || !newTrackInput.trim()) return;
    const val = newTrackInput.trim();
    setNewTrackInput("");
    showToast(`Adding track to "${selectedPlaylistName}"...`, "info", "playlist_add");
    const thumb = getThumbnailFromUrl(val);
    const result = await addTrackToPlaylist(selectedPlaylistName, val, "", thumb || undefined);
    if (result.success) {
      if (result.already_exists) {
        showToast(`Track "${result.track?.title || val}" already exists in playlist "${selectedPlaylistName}"`, "warning");
      } else {
        showToast(`Added track to "${selectedPlaylistName}"!`, "success", "check_circle");
      }
      loadPlaylistDetails(selectedPlaylistName, false);
      onRefreshStatus();
    } else {
      showToast(result.message || "Failed to add track", "error", "error_outline");
    }
  };

  const handleRemoveTrack = async (index: number) => {
    if (!selectedPlaylistName) return;
    const ok = await removeTrackFromPlaylist(selectedPlaylistName, index);
    if (ok) {
      showToast("Removed track from playlist", "info", "close");
      loadPlaylistDetails(selectedPlaylistName, false);
      onRefreshStatus();
    } else {
      showToast("Failed to remove track", "error", "error_outline");
    }
  };

  const handleMoveTrack = async (fromIndex: number, toIndex: number) => {
    if (!selectedPlaylistName || !activePlaylistData) return;
    const tracks = [...(activePlaylistData.tracks || [])];
    if (fromIndex < 0 || fromIndex >= tracks.length || toIndex < 0 || toIndex >= tracks.length) return;

    // Optimistic UI update
    const [moved] = tracks.splice(fromIndex, 1);
    tracks.splice(toIndex, 0, moved);
    setActivePlaylistData({
      ...activePlaylistData,
      tracks,
    });

    const ok = await movePlaylistTrack(selectedPlaylistName, fromIndex, toIndex);
    if (ok) {
      showToast(`Moved track to position #${toIndex + 1}`, "success");
      loadPlaylistDetails(selectedPlaylistName, false);
      onRefreshStatus();
    } else {
      showToast("Failed to move track", "error", "error_outline");
      loadPlaylistDetails(selectedPlaylistName, false);
    }
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>, idx: number) => {
    setDraggedIndex(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", idx.toString());
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, idx: number) => {
    if (draggedIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIndex !== idx) {
      setDragOverIndex(idx);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, targetIdx: number) => {
    if (draggedIndex === null) return;
    e.preventDefault();
    const sourceIdx = draggedIndex;
    setDraggedIndex(null);
    setDragOverIndex(null);

    if (sourceIdx === targetIdx) return;
    handleMoveTrack(sourceIdx, targetIdx);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const filteredPlaylists = playlistSearchFilter
    ? playlists.filter((p) => matchesSearchQuery(p.name, playlistSearchFilter))
    : playlists;

  const rawTracks: Track[] = activePlaylistData?.tracks || [];
  const filteredTracks = trackSearchFilter
    ? rawTracks.filter((t) => matchesSearchQuery(`${t.title || ""} ${t.url || ""}`, trackSearchFilter))
    : rawTracks;

  return (
    <section
      className="w-full my-6 p-5 sm:p-6 rounded-3xl bg-slate-900/80 border border-slate-700/60 shadow-xl backdrop-blur-xl"
      aria-label="Persistent Playlists Library"
    >
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <Library className="w-5 h-5 text-indigo-400" />
          <h3 className="text-base font-bold text-white tracking-tight">Playlists Library</h3>
          <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-xs font-semibold text-indigo-300">
            {playlists.length}
          </span>
        </div>

        <button
          onClick={handleCreateNewPlaylist}
          className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-500/20 transition-all hover:scale-105 active:scale-95 shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Playlist</span>
        </button>
      </div>

      {/* 2-Column Explorer Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 mt-5">
        {/* Left Sidebar: Navigation list */}
        <div className="md:col-span-4 flex flex-col gap-3">
          {/* Filter box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={playlistSearchFilter}
              onChange={(e) => setPlaylistSearchFilter(e.target.value)}
              placeholder="Search playlists..."
              className="w-full pl-9 pr-3 py-2 rounded-2xl bg-slate-800/80 border border-slate-700 text-xs text-white placeholder-slate-400 outline-none focus:border-indigo-500/50"
            />
          </div>

          {/* Navigation Items */}
          <div className="max-h-[320px] md:max-h-[420px] overflow-y-auto space-y-1.5 pr-1">
            {filteredPlaylists.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400">
                {playlists.length === 0 ? 'No playlists created yet. Click "+ New Playlist"!' : "No playlists match search."}
              </div>
            ) : (
              filteredPlaylists.map((p) => {
                const isSelected = p.name.toLowerCase() === (selectedPlaylistName || "").toLowerCase();
                return (
                  <button
                    key={p.name}
                    onClick={() => {
                      setSelectedPlaylistName(p.name);
                      loadPlaylistDetails(p.name, true);
                    }}
                    className={`w-full flex items-center justify-between p-3 rounded-2xl border text-left transition-all ${
                      isSelected
                        ? "bg-indigo-500/20 border-indigo-500/50 text-white shadow-md shadow-indigo-500/10"
                        : "bg-slate-800/40 hover:bg-slate-800/80 border-slate-700/40 text-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ListMusic
                        className={`w-4 h-4 shrink-0 ${isSelected ? "text-indigo-400" : "text-slate-400"}`}
                      />
                      <span className="text-xs font-semibold truncate">{p.name}</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${
                        isSelected ? "bg-indigo-400/30 text-indigo-200" : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {p.track_count || 0}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Main Content */}
        <div className="md:col-span-8 flex flex-col rounded-2xl bg-slate-800/30 border border-slate-700/40 p-4 sm:p-5">
          {activePlaylistData ? (
            <>
              {/* Active Playlist Toolbar Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-700/60">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white shrink-0 shadow-md">
                    <Disc3 className="w-6 h-6 animate-spin-slow" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
                      Playlist
                    </span>
                    <div className="flex items-center gap-2">
                      <h4 className="text-base font-bold text-white truncate">
                        {activePlaylistData.name}
                      </h4>
                      <button
                        onClick={handleRenamePlaylist}
                        className="p-1 rounded-md text-slate-400 hover:text-white transition-colors"
                        title="Rename Playlist"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {rawTracks.length} tracks • Persistent SQLite Collection
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 w-full sm:w-auto mt-2 sm:mt-0">
                  <button
                    onClick={() => onPlayPlaylist(activePlaylistData.name, false)}
                    className="flex items-center justify-center gap-1 px-3 py-2 sm:py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 text-xs font-semibold border border-sky-500/40 transition-all hover:scale-105"
                    title="Play sequential"
                  >
                    <Play className="w-3.5 h-3.5 fill-sky-300" />
                    <span>Play Ordered</span>
                  </button>
                  <button
                    onClick={() => onPlayPlaylist(activePlaylistData.name, true)}
                    className="flex items-center justify-center gap-1 px-3 py-2 sm:py-1.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 text-xs font-semibold border border-indigo-500/40 transition-all hover:scale-105"
                    title="Play shuffled"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                    <span>Play Shuffled</span>
                  </button>
                  <button
                    onClick={() => onQueuePlaylist(activePlaylistData.name, false)}
                    className="flex items-center justify-center gap-1 px-3 py-2 sm:py-1.5 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all hover:scale-105"
                    title="Append to queue"
                  >
                    <ListPlus className="w-3.5 h-3.5" />
                    <span>Queue</span>
                  </button>
                  <button
                    onClick={() => setPlaylistToDelete(activePlaylistData.name)}
                    className="flex items-center justify-center gap-1 px-3 py-2 sm:py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-all hover:scale-105"
                    title="Delete playlist"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>

              {/* Track Search Filter */}
              {rawTracks.length > 0 && (
                <div className="relative my-3">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={trackSearchFilter}
                    onChange={(e) => setTrackSearchFilter(e.target.value)}
                    placeholder="Search & filter tracks in this playlist..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-white placeholder-slate-400 outline-none focus:border-indigo-500/50"
                  />
                </div>
              )}

              {/* Tracks List */}
              <div className="flex-1 max-h-[260px] overflow-y-auto space-y-1.5 my-2 pr-1">
                {loadingTracks ? (
                  <div className="space-y-2 py-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-10 bg-slate-800/60 rounded-xl animate-pulse" />
                    ))}
                  </div>
                ) : filteredTracks.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    {rawTracks.length === 0
                      ? "This playlist is empty. Add songs using the input below!"
                      : `No tracks match "${trackSearchFilter}".`}
                  </div>
                ) : (
                  filteredTracks.map((t, idx) => {
                    const display = formatTrackDisplay(t.title, t.url);
                    const isDragged = draggedIndex === idx;
                    const isDragOver = dragOverIndex === idx;

                    return (
                      <div
                        key={idx}
                        draggable={!trackSearchFilter}
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDrop={(e) => handleDrop(e, idx)}
                        onDragEnd={handleDragEnd}
                        className={`group flex items-center justify-between gap-3 p-2.5 rounded-xl border transition-all select-none ${
                          isDragged
                            ? "opacity-30 border-dashed border-indigo-400 bg-indigo-500/5 scale-95"
                            : isDragOver
                            ? "border-indigo-500/80 bg-indigo-500/10 scale-[1.01] shadow-lg shadow-indigo-500/10"
                            : "bg-slate-800/40 hover:bg-slate-800/80 border-slate-700/40"
                        }`}
                      >
                        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
                          {/* Drag Grip Handle */}
                          {!trackSearchFilter && (
                            <div
                              className="p-1 rounded-lg text-slate-500 group-hover:text-slate-300 hover:text-indigo-400 cursor-grab active:cursor-grabbing transition-colors shrink-0"
                              title="Drag to reorder playlist track"
                            >
                              <GripVertical className="w-4 h-4" />
                            </div>
                          )}

                          <span className="text-[10px] font-mono text-slate-400 w-4 sm:w-5 text-right shrink-0">
                            #{idx + 1}
                          </span>
                          {(() => {
                            const thumb = t.thumbnail || getThumbnailFromUrl(t.url);
                            return thumb ? (
                              <img
                                src={thumb}
                                alt={display.title}
                                className="w-8 h-8 rounded-lg object-cover shrink-0 border border-slate-700"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 shrink-0">
                                <Music2 className="w-4 h-4" />
                              </div>
                            );
                          })()}
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-white truncate">
                              {display.title}
                            </div>
                            {display.url && (
                              <div className="text-[10px] text-slate-400 truncate">{display.url}</div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                          <button
                            onClick={() => handleMoveTrack(idx, idx - 1)}
                            disabled={idx === 0}
                            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/60 disabled:opacity-20 disabled:hover:bg-transparent transition-all"
                            title="Move Up"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleMoveTrack(idx, idx + 1)}
                            disabled={idx === rawTracks.length - 1}
                            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/60 disabled:opacity-20 disabled:hover:bg-transparent transition-all"
                            title="Move Down"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onPlaySingleUrl(t.url, t.title)}
                            className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 text-xs font-medium border border-sky-500/30 transition-all"
                            title="Play directly"
                          >
                            <Play className="w-3 h-3 fill-sky-300" />
                            <span className="hidden sm:inline">Play</span>
                          </button>
                          <button
                            onClick={() => setTrackToDelete({ index: idx, title: display.title })}
                            className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Remove from playlist"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Add Track Input */}
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-700/60">
                <input
                  type="text"
                  value={newTrackInput}
                  onChange={(e) => setNewTrackInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddTrack();
                  }}
                  placeholder="Add song or YouTube URL to this playlist..."
                  className="flex-1 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-white placeholder-slate-400 px-3 py-2 outline-none focus:border-indigo-500/50"
                />
                <button
                  onClick={handleAddTrack}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 text-xs font-semibold border border-indigo-500/40 transition-all hover:scale-105"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-center text-slate-400">
              <ListMusic className="w-10 h-10 stroke-[1.5] mb-2 opacity-50 text-indigo-400" />
              <p className="text-xs">Select or create a playlist on the left.</p>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Dialogs */}
      <ConfirmationModal
        isOpen={trackToDelete !== null}
        title="Remove Track from Playlist"
        message={`Are you sure you want to remove "${trackToDelete?.title}" from "${selectedPlaylistName}"?`}
        confirmLabel="Remove"
        onConfirm={() => {
          if (trackToDelete !== null) {
            handleRemoveTrack(trackToDelete.index);
            setTrackToDelete(null);
          }
        }}
        onClose={() => setTrackToDelete(null)}
      />

      <ConfirmationModal
        isOpen={playlistToDelete !== null}
        title="Delete Playlist"
        message={`Are you sure you want to delete playlist "${playlistToDelete}"? All tracks in this collection will be removed.`}
        confirmLabel="Delete Playlist"
        onConfirm={() => {
          if (playlistToDelete !== null) {
            executeDeletePlaylist(playlistToDelete);
            setPlaylistToDelete(null);
          }
        }}
        onClose={() => setPlaylistToDelete(null)}
      />

      {/* Rename Playlist Modal */}
      <PromptInputModal
        isOpen={isRenameModalOpen}
        title="Rename Playlist"
        description={`Enter a new name for playlist "${selectedPlaylistName}":`}
        initialValue={selectedPlaylistName || ""}
        placeholder="New playlist name..."
        confirmLabel="Rename"
        icon={<Edit2 className="w-4 h-4" />}
        onSubmit={executeRenamePlaylist}
        onClose={() => setIsRenameModalOpen(false)}
      />

      {/* Create New Playlist Modal */}
      <PromptInputModal
        isOpen={isCreateModalOpen}
        title="Create New Playlist"
        description="Enter a name for your new persistent playlist collection:"
        initialValue=""
        placeholder="My Awesome Playlist..."
        confirmLabel="Create"
        icon={<Plus className="w-4 h-4" />}
        onSubmit={executeCreatePlaylist}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </section>
  );
}
