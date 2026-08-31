"""
Multi-Playlist Management & SQLite Persistence.
Enables creating and managing persistent named collections of tracks.
"""

import random
from typing import Any, Dict, List, Optional

from music_streamer.db import DatabaseManager, db
from music_streamer.playback import PlaybackManager, playback_mgr


class PlaylistManager:
    """Manages persistent named playlists and their track collections in SQLite."""

    def __init__(
        self,
        database: Optional[DatabaseManager] = None,
        playback: Optional[PlaybackManager] = None,
    ):
        self.db = database or db
        self.playback_mgr = playback or playback_mgr

    def create_playlist(self, name: str) -> Dict[str, Any]:
        """Creates a new playlist or returns existing playlist."""
        return self.db.create_playlist(name)

    def get_playlists(self) -> List[Dict[str, Any]]:
        """Returns all playlists with track counts."""
        return self.db.get_playlists()

    def get_playlist(self, name_or_id: str) -> Optional[Dict[str, Any]]:
        """Gets a playlist with its full tracklist by name or ID."""
        return self.db.get_playlist(name_or_id)

    def delete_playlist(self, name_or_id: str) -> bool:
        """Deletes a playlist and all its tracks from SQLite."""
        return self.db.delete_playlist(name_or_id)

    def add_track(
        self,
        name_or_id: str,
        url: str,
        title: str = "",
        thumbnail: Optional[str] = None,
        auto_fetch: bool = True,
    ) -> Optional[Dict[str, Any]]:
        """Adds a track to a playlist with optional automatic title and thumbnail resolution."""
        if not url:
            raise ValueError("Track URL or search query is required")

        # If not a direct URL, search YouTube
        if not url.startswith("http://") and not url.startswith("https://"):
            from music_streamer.search import search_music

            res = search_music(url, num=1)
            if not res.results:
                raise ValueError(f"No search results found for '{url}'")
            r = res.results[0]
            url = r.url
            title = r.title

        # Auto-fetch title from URL if missing
        if (not title or title == url) and auto_fetch and (url.startswith("http://") or url.startswith("https://")):
            from music_streamer.search import fetch_track_metadata

            meta = fetch_track_metadata(url)
            if meta.get("title") and meta["title"] != url:
                title = meta["title"]
            if not thumbnail and meta.get("thumbnail"):
                thumbnail = meta["thumbnail"]

        if not title:
            title = url

        return self.db.add_track_to_playlist(name_or_id, url=url, title=title, thumbnail=thumbnail)

    def remove_track(self, name_or_id: str, track_id_or_index: Any) -> bool:
        """Removes a track from a playlist by index or ID."""
        return self.db.remove_track_from_playlist(name_or_id, track_id_or_index)

    def play_playlist(self, name_or_id: str, shuffle: bool = False) -> Dict[str, Any]:
        """
        Loads the playlist tracks into active playback queue and starts playback.
        Can be played in sequential order or fairly shuffled.
        """
        pl = self.get_playlist(name_or_id)
        if not pl:
            return {"success": False, "error": f"Playlist '{name_or_id}' not found"}

        tracks = list(pl.get("tracks", []))
        if not tracks:
            return {"success": False, "error": f"Playlist '{pl['name']}' is empty"}

        # Clear ephemeral playback queue (playlist tracks in SQLite remain untouched!)
        self.playback_mgr.clear_all()

        if shuffle:
            random.shuffle(tracks)
            self.db.set_setting("playback_mode", "shuffled")
        else:
            self.db.set_setting("playback_mode", "ordered")

        # Populate playback queue
        for t in tracks:
            self.playback_mgr.add_track(
                url=t["url"],
                title=t["title"],
                thumbnail=t.get("thumbnail"),
                auto_fetch=False,
            )

        # Mark first track playing
        first_track, _ = self.playback_mgr.get_next_track_for_playback(loop=True)

        return {
            "success": True,
            "playlist": pl["name"],
            "count": len(tracks),
            "mode": "shuffled" if shuffle else "ordered",
            "first_track": first_track,
        }

    def queue_playlist(self, name_or_id: str, shuffle: bool = False) -> Dict[str, Any]:
        """Appends all tracks of a playlist to the current playback queue without stopping now playing."""
        pl = self.get_playlist(name_or_id)
        if not pl:
            return {"success": False, "error": f"Playlist '{name_or_id}' not found"}

        tracks = list(pl.get("tracks", []))
        if not tracks:
            return {"success": False, "error": f"Playlist '{pl['name']}' is empty"}

        if shuffle:
            random.shuffle(tracks)

        for t in tracks:
            self.playback_mgr.add_track(
                url=t["url"],
                title=t["title"],
                thumbnail=t.get("thumbnail"),
                auto_fetch=False,
            )

        return {
            "success": True,
            "playlist": pl["name"],
            "added_count": len(tracks),
            "mode": "shuffled" if shuffle else "ordered",
        }


# Global singleton instance
playlist_mgr = PlaylistManager()
