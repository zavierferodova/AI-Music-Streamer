"""
Universal Music Search Provider (YouTube, SoundCloud, Bandcamp, Spotify) using yt-dlp.
"""

import json
import os
import subprocess
import sys
from dataclasses import asdict, dataclass
from typing import List, Optional

from music_streamer.config import NODE_BIN, YTDL_BIN


@dataclass
class SearchResult:
    id: str
    title: str
    url: str


@dataclass
class SearchResults:
    query: str
    provider: str
    count: int
    results: List[SearchResult]

    def to_dict(self) -> dict:
        return {
            "query": self.query,
            "provider": self.provider,
            "count": self.count,
            "results": [asdict(r) for r in self.results],
        }


def parse_search_output(query: str, provider: str, raw_output: str) -> SearchResults:
    """Parses raw yt-dlp output into structured SearchResults."""
    results: List[SearchResult] = []
    lines = [line.rstrip("\r") for line in raw_output.splitlines() if line.rstrip("\r")]

    i = 0
    id_buf, title_buf, url_buf = "", "", ""
    for line in lines:
        i += 1
        if i == 1:
            id_buf = line
        elif i == 2:
            title_buf = line
        elif i == 3:
            url_buf = line
            if not url_buf.startswith("http"):
                url_buf = f"https://www.youtube.com/watch?v={id_buf}"
            results.append(SearchResult(id=id_buf, title=title_buf, url=url_buf))
            i = 0
            id_buf, title_buf, url_buf = "", "", ""

    # Handle leftover id + title without url
    if i == 2 and id_buf:
        url_buf = f"https://www.youtube.com/watch?v={id_buf}"
        results.append(SearchResult(id=id_buf, title=title_buf, url=url_buf))

    return SearchResults(
        query=query,
        provider=provider,
        count=len(results),
        results=results,
    )


def format_search_results(results: SearchResults, mode: str = "text", select_index: int = 0) -> str:
    """Formats search results as json, direct url, video id, or readable text."""
    if mode == "json":
        return json.dumps(results.to_dict(), indent=2, ensure_ascii=False)

    if mode == "url":
        idx = (select_index - 1) if select_index > 0 else 0
        if 0 <= idx < len(results.results):
            return results.results[idx].url
        raise IndexError(f"Search index {select_index} out of range (1..{results.count})")

    if mode == "id":
        idx = (select_index - 1) if select_index > 0 else 0
        if 0 <= idx < len(results.results):
            return results.results[idx].id
        raise IndexError(f"Search index {select_index} out of range (1..{results.count})")

    # Text mode
    out = [f"Query: {results.query}", f"Provider: {results.provider}", f"Results: {results.count}\n"]
    for n, r in enumerate(results.results, 1):
        out.append(f"  [{n}] ---")
        out.append(f"      id:    {r.id}")
        out.append(f"      title: {r.title}")
        out.append(f"      url:   {r.url}\n")
    return "\n".join(out)


def search_music(
    query: str,
    num: int = 5,
    provider: str = "youtube",
    node_bin: Optional[str] = None,
    ytdl_bin: Optional[str] = None,
) -> SearchResults:
    """Executes yt-dlp search and returns SearchResults."""
    if not query or not query.strip():
        raise ValueError("Search query cannot be empty")

    node_path = node_bin or NODE_BIN
    ytdl_path = ytdl_bin or YTDL_BIN

    prefix_map = {
        "youtube": "ytsearch",
        "yt": "ytsearch",
        "soundcloud": "scsearch",
        "sc": "scsearch",
        "bandcamp": "bcsearch",
        "bc": "bcsearch",
        "spotify": "spsearch",
        "sp": "spsearch",
    }
    search_prefix = prefix_map.get(provider.lower(), "ytsearch")
    search_term = f"{search_prefix}{num}:{query}"

    cmd = [
        ytdl_path,
        "--no-update",
        "--js-runtimes",
        f"node:{node_path}",
        "--remote-components",
        "ejs:github",
        "--extractor-args",
        "youtube:player_client=mweb",
        "--flat-playlist",
        "--print",
        "id",
        "--print",
        "title",
        "--print",
        "webpage_url",
        search_term,
    ]

    try:
        raw = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, text=True, timeout=15)
        return parse_search_output(query, provider, raw)
    except subprocess.CalledProcessError as e:
        return SearchResults(query=query, provider=provider, count=0, results=[])
    except Exception as e:
        return SearchResults(query=query, provider=provider, count=0, results=[])


def fetch_track_metadata(
    url: str,
    node_bin: Optional[str] = None,
    ytdl_bin: Optional[str] = None,
    timeout: float = 10.0,
) -> dict:
    """
    Fetches actual track title and thumbnail from a direct URL (YouTube, SoundCloud, Bandcamp, etc.) using yt-dlp.
    Returns: {"title": str, "thumbnail": str, "url": str}
    """
    import re

    if not url or not url.strip():
        return {"title": "", "thumbnail": "", "url": ""}

    node_path = node_bin or NODE_BIN
    ytdl_path = ytdl_bin or YTDL_BIN
    thumb_fallback = ""
    m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/|watch\?.*v=)([a-zA-Z0-9_-]{11})", url)
    if m:
        thumb_fallback = f"https://i.ytimg.com/vi/{m.group(1)}/hqdefault.jpg"

    cmd = [
        ytdl_path,
        "-q",
        "--no-warnings",
        "--no-update",
        "--js-runtimes",
        f"node:{node_path}",
        "--remote-components",
        "ejs:github",
        "--extractor-args",
        "youtube:player_client=mweb",
        "--no-playlist",
        "--skip-download",
        "--print",
        "%(title)s",
        "--print",
        "%(thumbnail)s",
        "--print",
        "%(duration)s",
        url,
    ]

    try:
        raw = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, text=True, timeout=timeout)
        lines = [line.strip() for line in raw.splitlines() if line.strip()]
        title = lines[0] if lines else url
        thumbnail = lines[1] if len(lines) > 1 and lines[1].startswith("http") else thumb_fallback
        duration = 0
        if len(lines) > 2:
            try:
                duration = int(float(lines[2]))
            except Exception:
                duration = 0
        return {
            "title": title,
            "thumbnail": thumbnail,
            "duration": duration,
            "url": url,
        }
    except Exception:
        return {
            "title": url,
            "thumbnail": thumb_fallback,
            "duration": 0,
            "url": url,
        }


def search_unified(
    query: str,
    count: int = 5,
    include_web: bool = True,
    database=None,
) -> dict:
    """
    Performs unified search across local library (playlists + playback queue) first,
    and optionally queries online providers (YouTube/SoundCloud).
    """
    from music_streamer.db import db as default_db

    target_db = database or default_db
    local_matches = target_db.search_local_tracks(query, limit=count * 2)

    web_res_list = []
    if include_web:
        web_res = search_music(query, provider="youtube", num=count)
        web_res_list = [asdict(r) for r in web_res.results]

    return {
        "query": query,
        "local_results": local_matches,
        "web_results": web_res_list,
        "local_count": len(local_matches),
        "web_count": len(web_res_list),
    }
