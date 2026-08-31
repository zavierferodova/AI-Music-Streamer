"use client";

import { useEffect, useState } from "react";
import {
  Compass,
  X,
  Library,
  Globe,
  Play,
  ListPlus,
  BookmarkPlus,
  Music2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { SearchResponse, SearchResultLocal, SearchResultWeb } from "@/types";
import { searchMusic } from "@/lib/api";
import { formatTrackDisplay } from "@/lib/utils";

interface UniversalSearchModalProps {
  isOpen: boolean;
  query: string;
  onClose: () => void;
  onPlayUrl: (url: string, title?: string) => void;
  onQueueUrl: (url: string, title?: string) => void;
  onSaveToPlaylist: (url: string, title?: string, thumbnail?: string) => void;
}

export function UniversalSearchModal({
  isOpen,
  query,
  onClose,
  onPlayUrl,
  onQueueUrl,
  onSaveToPlaylist,
}: UniversalSearchModalProps) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !query.trim()) return;

    let isMounted = true;
    setLoading(true);
    setError(null);

    searchMusic(query.trim(), 6, true)
      .then((res) => {
        if (isMounted) {
          setResults(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message || "Failed to search music");
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, query]);

  if (!isOpen) return null;

  const localMatches = results?.local_results || [];
  const webMatches = results?.web_results || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-3xl bg-slate-900 border border-slate-700/70 shadow-2xl overflow-hidden animate-in zoom-in-95">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <Compass className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-bold text-white">
              Search Results: <span className="text-sky-300 font-semibold">"{query}"</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-3 text-rose-200">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
                <span className="text-sm">{error}</span>
              </div>
              <button
                onClick={() => {
                  setLoading(true);
                  setError(null);
                  searchMusic(query.trim(), 6, true)
                    .then((res) => {
                      setResults(res);
                      setLoading(false);
                    })
                    .catch((err) => {
                      setError(err.message || "Failed to search");
                      setLoading(false);
                    });
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/20 text-xs font-semibold hover:bg-rose-500/30 text-rose-100"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            </div>
          )}

          {/* Skeletons when loading */}
          {loading && (
            <div className="space-y-4">
              <div className="h-5 w-48 bg-slate-800 rounded-lg animate-pulse" />
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-slate-800/40 rounded-2xl animate-pulse">
                  <div className="w-10 h-10 bg-slate-700 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-slate-700 rounded w-3/4" />
                    <div className="h-3 bg-slate-700/60 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Local Matches Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Library className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      Found in Playlists &amp; Library
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[11px] font-semibold">
                      {localMatches.length} found
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">Instant Local Play</span>
                </div>

                {localMatches.length === 0 ? (
                  <div className="py-4 text-center text-xs text-slate-400">
                    No matching tracks in your playlists or queue.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {localMatches.map((item, idx) => {
                      const display = formatTrackDisplay(item.title, item.url);
                      return (
                        <div
                          key={idx}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-2xl bg-slate-800/40 hover:bg-slate-800/80 border border-slate-700/40 transition-all"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {item.thumbnail ? (
                              <img
                                src={item.thumbnail}
                                alt={display.title}
                                className="w-10 h-10 rounded-xl object-cover shrink-0 border border-slate-700"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 shrink-0 border border-slate-700">
                                <Music2 className="w-5 h-5" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white truncate">
                                {display.title}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="px-2 py-0.5 rounded-md bg-slate-700/60 text-slate-300 text-[10px] font-medium">
                                  {item.source_label || "Local"}
                                </span>
                                {item.is_exact_match ? (
                                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 text-[10px] font-semibold border border-emerald-500/30">
                                    Exact Match
                                  </span>
                                ) : item.match_score ? (
                                  <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-semibold border border-amber-500/30">
                                    {Math.round(item.match_score * 100)}% Similar
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                            <button
                              onClick={() => {
                                onPlayUrl(item.url, item.title);
                                onClose();
                              }}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 text-xs font-medium border border-sky-500/40 transition-all"
                            >
                              <Play className="w-3.5 h-3.5" />
                              <span>Play Local</span>
                            </button>
                            <button
                              onClick={() => onQueueUrl(item.url, item.title)}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-all"
                              title="Add to Queue"
                            >
                              <ListPlus className="w-3.5 h-3.5" />
                              <span>Queue</span>
                            </button>
                            <button
                              onClick={() => onSaveToPlaylist(item.url, item.title, item.thumbnail || undefined)}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-all"
                              title="Save to Playlist"
                            >
                              <BookmarkPlus className="w-3.5 h-3.5" />
                              <span>Save</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Web YouTube Matches Section */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-rose-400" />
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      Online Web Results (YouTube)
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[11px] font-semibold">
                      {webMatches.length} found
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">Online Stream</span>
                </div>

                {webMatches.length === 0 ? (
                  <div className="py-4 text-center text-xs text-slate-400">
                    No web results found.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {webMatches.map((item, idx) => {
                      const display = formatTrackDisplay(item.title, item.url);
                      const thumb = item.thumbnail || (item.id ? `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg` : "");
                      return (
                        <div
                          key={idx}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-2xl bg-slate-800/40 hover:bg-slate-800/80 border border-slate-700/40 transition-all"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {thumb ? (
                              <img
                                src={thumb}
                                alt={display.title}
                                className="w-10 h-10 rounded-xl object-cover shrink-0 border border-slate-700"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 shrink-0 border border-slate-700">
                                <Globe className="w-5 h-5" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white truncate">
                                {display.title}
                              </div>
                              <div className="text-[11px] text-slate-400 truncate mt-0.5">
                                YouTube • {display.url}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                            <button
                              onClick={() => {
                                onPlayUrl(item.url, item.title);
                                onClose();
                              }}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-semibold shadow-sm transition-all"
                            >
                              <Play className="w-3.5 h-3.5 fill-white" />
                              <span>Play Web</span>
                            </button>
                            <button
                              onClick={() => onQueueUrl(item.url, item.title)}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-all"
                              title="Add to Queue"
                            >
                              <ListPlus className="w-3.5 h-3.5" />
                              <span>Queue</span>
                            </button>
                            <button
                              onClick={() => onSaveToPlaylist(item.url, item.title, thumb)}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-all"
                              title="Save to Playlist"
                            >
                              <BookmarkPlus className="w-3.5 h-3.5" />
                              <span>Save</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
