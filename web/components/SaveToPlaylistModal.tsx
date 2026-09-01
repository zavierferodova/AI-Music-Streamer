"use client";

import { useState, useEffect } from "react";
import { BookmarkPlus, X, Search, PlusCircle, Music2, Radio, CheckCircle2 } from "lucide-react";
import { Playlist } from "@/types";
import { addTrackToPlaylist, createPlaylist } from "@/lib/api";
import { formatTrackDisplay, getThumbnailFromUrl, matchesSearchQuery } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";

interface SaveToPlaylistModalProps {
  isOpen: boolean;
  trackData: { url: string; title: string; thumbnail?: string } | null;
  playlists: Playlist[];
  onClose: () => void;
  onRefreshPlaylists: () => void;
}

export function SaveToPlaylistModal({
  isOpen,
  trackData,
  playlists,
  onClose,
  onRefreshPlaylists,
}: SaveToPlaylistModalProps) {
  const { showToast } = useToast();
  const [selectedPlaylist, setSelectedPlaylist] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (playlists.length > 0) {
      setSelectedPlaylist(playlists[0].name);
    }
  }, [playlists]);

  if (!isOpen || !trackData) return null;

  const display = formatTrackDisplay(trackData.title, trackData.url);
  const thumb = trackData.thumbnail || getThumbnailFromUrl(trackData.url);
  const filteredPlaylists = searchFilter
    ? playlists.filter((p) => matchesSearchQuery(p.name, searchFilter))
    : playlists;

  const handleSave = async () => {
    let targetName = newPlaylistName.trim() || selectedPlaylist;
    if (!targetName) {
      showToast("Please select or enter a playlist name", "warning", "warning");
      return;
    }

    setSaving(true);
    try {
      if (newPlaylistName.trim() && !playlists.some((p) => p.name.toLowerCase() === targetName.toLowerCase())) {
        await createPlaylist(targetName);
      }

      const result = await addTrackToPlaylist(targetName, trackData.url, trackData.title, thumb || undefined);
      if (result.success) {
        if (result.already_exists) {
          showToast(`Track "${display.title}" already exists in playlist "${targetName}"`, "warning");
        } else {
          showToast(`Saved to playlist "${targetName}"!`, "success", "playlist_add");
        }
        onRefreshPlaylists();
        onClose();
      } else {
        showToast(result.message || "Failed to save track", "error", "error_outline");
      }
    } catch (err: any) {
      showToast(err?.message || "Failed to save track", "error", "error_outline");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md flex flex-col rounded-3xl bg-slate-900 border border-slate-700/70 shadow-2xl overflow-hidden animate-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2">
            <BookmarkPlus className="w-5 h-5 text-sky-400" />
            <h3 className="text-sm font-bold text-white">Save to Playlist</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Track Preview Card */}
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-800/50 border border-slate-700/60">
            {thumb ? (
              <img
                src={thumb}
                alt={display.title}
                className="w-11 h-11 rounded-xl object-cover shrink-0 border border-slate-700"
              />
            ) : (
              <div className="w-11 h-11 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 shrink-0 border border-slate-700">
                <Music2 className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white truncate">{display.title}</div>
              <div className="text-[10px] text-slate-400 truncate mt-0.5">{trackData.url}</div>
            </div>
          </div>

          {/* Target Playlist Selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300">Select Playlist:</span>
              <span className="text-[11px] text-slate-400">{filteredPlaylists.length} available</span>
            </div>

            {/* Filter */}
            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter playlists..."
                className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-white placeholder-slate-400 outline-none focus:border-sky-500/50"
              />
            </div>

            {/* List */}
            <div className="max-h-40 overflow-y-auto space-y-1 p-1 rounded-2xl bg-slate-800/30 border border-slate-700/40">
              {filteredPlaylists.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-400">
                  {playlists.length === 0 ? "No playlists created yet." : "No matching playlists."}
                </div>
              ) : (
                filteredPlaylists.map((p) => {
                  const isSelected = p.name === selectedPlaylist;
                  return (
                    <button
                      key={p.name}
                      onClick={() => {
                        setSelectedPlaylist(p.name);
                        setNewPlaylistName("");
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-all ${
                        isSelected
                          ? "bg-sky-500/20 border border-sky-500/40 text-sky-200"
                          : "hover:bg-slate-800 text-slate-300 border border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isSelected ? (
                          <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
                        ) : (
                          <Radio className="w-4 h-4 text-slate-500 shrink-0" />
                        )}
                        <span className="text-xs font-medium truncate">{p.name}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 px-1.5 py-0.5 rounded bg-slate-800">
                        {p.track_count || 0}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Or Create New */}
          <div className="p-3 rounded-2xl bg-slate-800/40 border border-slate-700/50 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <PlusCircle className="w-3.5 h-3.5 text-sky-400" />
              <span>Or create a new playlist:</span>
            </div>
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => {
                setNewPlaylistName(e.target.value);
                if (e.target.value.trim()) setSelectedPlaylist(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              placeholder="New playlist name..."
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white placeholder-slate-400 outline-none focus:border-sky-500/50"
            />
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-sky-500/20 transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              <span>{saving ? "Saving..." : "Save to Playlist"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
