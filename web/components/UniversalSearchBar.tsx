"use client";

import { useState, KeyboardEvent } from "react";
import { Search, Loader2 } from "lucide-react";

interface UniversalSearchBarProps {
  onSearch: (query: string) => void;
  isSearching?: boolean;
}

export function UniversalSearchBar({ onSearch, isSearching }: UniversalSearchBarProps) {
  const [query, setQuery] = useState("");

  const handleExecute = () => {
    if (!query.trim()) return;
    onSearch(query.trim());
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleExecute();
    }
  };

  return (
    <section className="w-full my-5" aria-label="Search Music">
      <div className="relative flex items-center w-full rounded-2xl bg-slate-900/70 border border-slate-700/60 p-1.5 shadow-xl backdrop-blur-md focus-within:border-sky-500/50 focus-within:shadow-[0_0_20px_rgba(56,189,248,0.2)] transition-all">
        <Search className="w-5 h-5 text-slate-400 ml-3 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search song in playlists, queue, or online YouTube..."
          className="w-full bg-transparent text-sm text-white placeholder-slate-400 px-3 py-2 outline-none"
        />
        <button
          onClick={handleExecute}
          disabled={isSearching}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-sky-500/20 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 shrink-0"
        >
          {isSearching ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          <span>Search</span>
        </button>
      </div>
    </section>
  );
}
