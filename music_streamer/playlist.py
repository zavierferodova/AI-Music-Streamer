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

    def rename_playlist(self, name_or_id: str, new_name: str) -> Dict[str, Any]:
        """Renames a playlist to a new name."""
        try:
            pl = self.db.rename_playlist(name_or_id, new_name)
            if not pl:
                return {"success": False, "error": f"Playlist '{name_or_id}' not found"}
            return {"success": True, "playlist": pl}
        except Exception as e:
            return {"success": False, "error": str(e)}

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

        if not title or title == url:
            import re
            m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/|watch\?.*v=)([a-zA-Z0-9_-]{11})", url)
            title = f"YouTube Track ({m.group(1)})" if m else url

        return self.db.add_track_to_playlist(name_or_id, url=url, title=title, thumbnail=thumbnail)

    def add_tracks_bulk(
        self,
        name_or_id: str,
        items: List[Any],
        auto_fetch: bool = True,
    ) -> Dict[str, Any]:
        """
        Adds multiple tracks to a playlist in bulk.
        Each item in `items` can be:
          - A string (URL or search query)
          - A dict: {"url": str, "title": Optional[str], "thumbnail": Optional[str]}
        """
        pl = self.get_playlist(name_or_id)
        if not pl:
            return {"success": False, "error": f"Playlist '{name_or_id}' not found"}

        if not items:
            return {"success": True, "playlist": pl["name"], "added_count": 0, "already_exists_count": 0, "tracks": []}

        import re
        from music_streamer.search import fetch_track_metadata, search_music

        resolved_items = []
        for it in items:
            if isinstance(it, dict):
                u = (it.get("url") or it.get("query") or "").strip()
                t = (it.get("title") or "").strip()
                th = (it.get("thumbnail") or "").strip()
            else:
                u = str(it).strip()
                t = ""
                th = ""

            if not u:
                continue

            if not u.startswith("http://") and not u.startswith("https://"):
                res = search_music(u, num=1)
                if res.results:
                    u = res.results[0].url
                    t = res.results[0].title
                    th = res.results[0].thumbnail

            if (not t or t == u) and auto_fetch and (u.startswith("http://") or u.startswith("https://")):
                meta = fetch_track_metadata(u)
                if meta.get("title") and meta["title"] != u:
                    t = meta["title"]
                if not th and meta.get("thumbnail"):
                    th = meta["thumbnail"]

            if not t or t == u:
                m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/|watch\?.*v=)([a-zA-Z0-9_-]{11})", u)
                t = f"YouTube Track ({m.group(1)})" if m else u

            resolved_items.append((u, t, th))

        if not resolved_items:
            return {"success": True, "playlist": pl["name"], "added_count": 0, "already_exists_count": 0, "tracks": []}

        added_tracks = []
        already_exists_count = 0

        for u, t, th in resolved_items:
            res = self.db.add_track_to_playlist(pl["id"], url=u, title=t, thumbnail=th)
            if res:
                if res.get("already_exists"):
                    already_exists_count += 1
                added_tracks.append(res)

        return {
            "success": True,
            "playlist": pl["name"],
            "added_count": len(added_tracks),
            "already_exists_count": already_exists_count,
            "tracks": added_tracks,
        }

    def remove_track(self, name_or_id: str, track_id_or_index: Any) -> bool:
        """Removes a track from a playlist by index, ID, URL, or title substring."""
        pl = self.get_playlist(name_or_id)
        if not pl:
            return False

        tracks = pl.get("tracks", [])
        target_id = None

        if isinstance(track_id_or_index, int) or (isinstance(track_id_or_index, str) and track_id_or_index.isdigit()):
            val = int(track_id_or_index)
            if 1 <= val <= len(tracks):
                target_id = tracks[val - 1]["id"]
            elif 0 <= val < len(tracks):
                target_id = tracks[val]["id"]
        else:
            target_str = str(track_id_or_index).strip()
            for t in tracks:
                if t.get("id") == target_str or t.get("url") == target_str:
                    target_id = t["id"]
                    break
            if not target_id:
                target_lower = target_str.lower()
                for t in tracks:
                    if target_lower in (t.get("title") or "").lower():
                        target_id = t["id"]
                        break

        if not target_id:
            target_id = str(track_id_or_index)

        return self.db.remove_track_from_playlist(pl["id"], target_id)

    def remove_tracks_bulk(self, name_or_id: str, items: List[Any]) -> Dict[str, Any]:
        """
        Removes multiple tracks from a playlist in bulk.
        References can be 1-based index (int or str), track ID, URL, or title substring.
        """
        pl = self.get_playlist(name_or_id)
        if not pl:
            return {"success": False, "error": f"Playlist '{name_or_id}' not found"}

        tracks = pl.get("tracks", [])
        if not tracks or not items:
            return {
                "success": True,
                "playlist": pl["name"],
                "removed_count": 0,
                "removed_tracks": [],
                "remaining_count": len(tracks),
            }

        to_remove = []
        used_ids = set()

        for it in items:
            if isinstance(it, dict):
                ref = it.get("id") or it.get("url") or it.get("title") or it.get("index")
            else:
                ref = it

            if ref is None:
                continue

            matched = None
            if isinstance(ref, int) or (isinstance(ref, str) and ref.isdigit()):
                val = int(ref)
                if 1 <= val <= len(tracks):
                    matched = tracks[val - 1]
                elif 0 <= val < len(tracks):
                    matched = tracks[val]

            if not matched:
                ref_str = str(ref).strip()
                for t in tracks:
                    if t.get("id") == ref_str or t.get("url") == ref_str:
                        matched = t
                        break

            if not matched:
                ref_str_lower = str(ref).strip().lower()
                for t in tracks:
                    if ref_str_lower in (t.get("title") or "").lower():
                        matched = t
                        break

            if not matched:
                from music_streamer.db import calculate_match_similarity
                best_score = 0.0
                for t in tracks:
                    score = calculate_match_similarity(str(ref).strip(), t.get("title") or "")
                    if score > best_score and score >= 0.5:
                        best_score = score
                        matched = t

            if matched and matched["id"] not in used_ids:
                to_remove.append(matched)
                used_ids.add(matched["id"])

        if not to_remove:
            return {
                "success": False,
                "error": "No matching playlist tracks found to remove",
                "playlist": pl["name"],
                "removed_count": 0,
                "remaining_count": len(tracks),
            }

        for t in to_remove:
            self.db.remove_track_from_playlist(pl["id"], t["id"])

        updated_pl = self.get_playlist(pl["id"])
        remaining_count = len(updated_pl.get("tracks", [])) if updated_pl else 0

        return {
            "success": True,
            "playlist": pl["name"],
            "removed_count": len(to_remove),
            "removed_tracks": to_remove,
            "remaining_count": remaining_count,
        }

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
