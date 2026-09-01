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
            if not thumbnail:
                thumbnail = r.thumbnail

        # Auto-fetch title or thumbnail from URL if missing
        if (not title or title == url or not thumbnail) and auto_fetch and (url.startswith("http://") or url.startswith("https://")):
            from music_streamer.search import fetch_track_metadata

            meta = fetch_track_metadata(url)
            if meta.get("title") and meta["title"] != url and (not title or title == url):
                title = meta["title"]
            if not thumbnail and meta.get("thumbnail"):
                thumbnail = meta["thumbnail"]

        if not thumbnail and (url.startswith("http://") or url.startswith("https://")):
            from music_streamer.playback import get_thumbnail_for_url
            thumbnail = get_thumbnail_for_url(url)

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

            if (not t or t == u or not th) and auto_fetch and (u.startswith("http://") or u.startswith("https://")):
                meta = fetch_track_metadata(u)
                if meta.get("title") and meta["title"] != u and (not t or t == u):
                    t = meta["title"]
                if not th and meta.get("thumbnail"):
                    th = meta["thumbnail"]

            if not th and (u.startswith("http://") or u.startswith("https://")):
                from music_streamer.playback import get_thumbnail_for_url
                th = get_thumbnail_for_url(u)

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

    def _find_track_index_in_playlist(self, tracks: List[Dict[str, Any]], query_or_id_or_index: Any) -> Optional[int]:
        """Helper to find the 0-based index of a track inside a playlist track list."""
        if not tracks or query_or_id_or_index is None:
            return None

        if isinstance(query_or_id_or_index, int):
            if 1 <= query_or_id_or_index <= len(tracks):
                return query_or_id_or_index - 1
            elif 0 <= query_or_id_or_index < len(tracks):
                return query_or_id_or_index
            return None

        query_str = str(query_or_id_or_index).strip()
        if query_str.isdigit():
            val = int(query_str)
            if 1 <= val <= len(tracks):
                return val - 1
            elif val == 0 and len(tracks) > 0:
                return 0

        for i, t in enumerate(tracks):
            if t.get("id") == query_str or t.get("url") == query_str:
                return i

        q_lower = query_str.lower()
        for i, t in enumerate(tracks):
            if q_lower in (t.get("title") or "").lower():
                return i

        from music_streamer.db import calculate_match_similarity
        best_idx = None
        best_score = 0.0
        for i, t in enumerate(tracks):
            score = calculate_match_similarity(query_str, t.get("title") or "")
            if score > best_score and score >= 0.5:
                best_score = score
                best_idx = i

        return best_idx

    def move_track(self, name_or_id: str, from_item: Any, to_item: Any) -> Dict[str, Any]:
        """
        Moves a track within a playlist from `from_item` to `to_item`.
        `from_item`: 1-based index, ID, URL, or title substring.
        `to_item`: 1-based index, 'top'/'first', 'bottom'/'last', ID, URL, or title.
        """
        pl = self.get_playlist(name_or_id)
        if not pl:
            return {"success": False, "error": f"Playlist '{name_or_id}' not found"}

        tracks = pl.get("tracks", [])
        if not tracks:
            return {"success": False, "error": "Playlist is empty"}

        from_idx = self._find_track_index_in_playlist(tracks, from_item)
        if from_idx is None:
            return {"success": False, "error": f"Source track '{from_item}' not found in playlist"}

        to_str = str(to_item).strip().lower()
        if to_str in ["top", "first", "start", "0"]:
            to_idx = 0
        elif to_str in ["bottom", "last", "end"]:
            to_idx = len(tracks) - 1
        else:
            to_idx = self._find_track_index_in_playlist(tracks, to_item)
            if to_idx is None:
                try:
                    to_idx = int(to_item) - 1
                except Exception:
                    pass

        if to_idx is None or not (0 <= to_idx < len(tracks)):
            return {"success": False, "error": f"Invalid destination position '{to_item}'"}

        ok = self.db.move_playlist_track(pl["id"], from_idx, to_idx)
        updated_pl = self.get_playlist(pl["id"])
        return {
            "success": ok,
            "playlist": pl["name"],
            "from_index": from_idx + 1,
            "to_index": to_idx + 1,
            "track": updated_pl["tracks"][to_idx] if updated_pl and 0 <= to_idx < len(updated_pl["tracks"]) else None,
        }

    def reorder_tracks(self, name_or_id: str, track_ids: List[str]) -> Dict[str, Any]:
        """Reorders playlist tracks given an explicit list of track IDs."""
        pl = self.get_playlist(name_or_id)
        if not pl:
            return {"success": False, "error": f"Playlist '{name_or_id}' not found"}
        self.db.reorder_playlist_tracks(pl["id"], track_ids)
        updated_pl = self.get_playlist(pl["id"])
        return {
            "success": True,
            "playlist": pl["name"],
            "reordered_count": len(track_ids),
            "tracks": updated_pl.get("tracks", []),
        }

    def reorder_bulk(self, name_or_id: str, sequence: List[Any]) -> Dict[str, Any]:
        """
        Reorders playlist tracks based on a sequence of 1-based indices, track titles, IDs, or URLs.
        Supports full queue permutations and partial sequence prioritization.
        """
        pl = self.get_playlist(name_or_id)
        if not pl:
            return {"success": False, "error": f"Playlist '{name_or_id}' not found"}

        tracks = pl.get("tracks", [])
        if not tracks or not sequence:
            return {"success": True, "playlist": pl["name"], "reordered_count": 0, "tracks": tracks}

        # Check if full numeric 1-based permutation
        if len(sequence) == len(tracks) and all(
            (isinstance(x, int) or (isinstance(x, str) and str(x).isdigit())) for x in sequence
        ):
            indices = [int(x) - 1 for x in sequence]
            if sorted(indices) == list(range(len(tracks))):
                reordered_ids = [tracks[i]["id"] for i in indices]
                self.db.reorder_playlist_tracks(pl["id"], reordered_ids)
                updated_pl = self.get_playlist(pl["id"])
                return {
                    "success": True,
                    "playlist": pl["name"],
                    "reordered_count": len(reordered_ids),
                    "tracks": updated_pl.get("tracks", []),
                }

        resolved_ids = []
        used_ids = set()

        for item in sequence:
            idx = self._find_track_index_in_playlist(tracks, item)
            if idx is not None:
                tid = tracks[idx]["id"]
                if tid not in used_ids:
                    resolved_ids.append(tid)
                    used_ids.add(tid)

        if not resolved_ids:
            return {"success": False, "error": "None of the sequence items matched playlist tracks"}

        # Append remaining unmentioned playlist tracks
        remaining_ids = [t["id"] for t in tracks if t["id"] not in used_ids]
        final_ids = resolved_ids + remaining_ids

        self.db.reorder_playlist_tracks(pl["id"], final_ids)
        updated_pl = self.get_playlist(pl["id"])
        return {
            "success": True,
            "playlist": pl["name"],
            "reordered_count": len(resolved_ids),
            "tracks": updated_pl.get("tracks", []),
        }

    def move_bulk(
        self,
        name_or_id: str,
        items: List[Any],
        order: Optional[str] = None,
        after: Optional[str] = None,
        before: Optional[str] = None,
        position: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """
        Moves multiple playlist tracks together as a contiguous batch to the specified destination.
        """
        pl = self.get_playlist(name_or_id)
        if not pl:
            return {"success": False, "error": f"Playlist '{name_or_id}' not found"}

        tracks = pl.get("tracks", [])
        if not tracks or not items:
            return {"success": True, "playlist": pl["name"], "moved_count": 0, "tracks": tracks}

        selected_tracks = []
        selected_ids = set()

        for it in items:
            idx = self._find_track_index_in_playlist(tracks, it)
            if idx is not None:
                t = tracks[idx]
                if t["id"] not in selected_ids:
                    selected_tracks.append(t)
                    selected_ids.add(t["id"])

        if not selected_tracks:
            return {"success": False, "error": "No matching tracks found to move"}

        remaining_tracks = [t for t in tracks if t["id"] not in selected_ids]

        # Determine target index in remaining_tracks
        target_idx = 0
        if order in ["top", "first", "next", "start"]:
            target_idx = 0
        elif order in ["bottom", "last", "end"]:
            target_idx = len(remaining_tracks)
        elif position is not None:
            try:
                p_val = int(position)
                target_idx = max(0, min(len(remaining_tracks), p_val - 1))
            except Exception:
                target_idx = 0
        elif after:
            a_idx = self._find_track_index_in_playlist(remaining_tracks, after)
            target_idx = (a_idx + 1) if a_idx is not None else len(remaining_tracks)
        elif before:
            b_idx = self._find_track_index_in_playlist(remaining_tracks, before)
            target_idx = b_idx if b_idx is not None else 0
        else:
            target_idx = 0

        final_track_ids = (
            [t["id"] for t in remaining_tracks[:target_idx]]
            + [t["id"] for t in selected_tracks]
            + [t["id"] for t in remaining_tracks[target_idx:]]
        )

        self.db.reorder_playlist_tracks(pl["id"], final_track_ids)
        updated_pl = self.get_playlist(pl["id"])
        return {
            "success": True,
            "playlist": pl["name"],
            "moved_count": len(selected_tracks),
            "moved_tracks": selected_tracks,
            "tracks": updated_pl.get("tracks", []),
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
