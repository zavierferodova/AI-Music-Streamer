"""
Persistent Playback List & Fair Shuffle Cycle Engine backed by SQLite.
"""

import random
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from music_streamer.db import DatabaseManager, db


def get_thumbnail_for_url(url: str) -> str:
    """Extract YouTube thumbnail URL or return empty string."""
    if not url:
        return ""
    m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/|watch\?.*v=)([a-zA-Z0-9_-]{11})", url)
    if m:
        return f"https://i.ytimg.com/vi/{m.group(1)}/hqdefault.jpg"
    return ""


class PlaybackManager:
    """Manages the full lifecycle of playback tracks: played, playing, and queued in SQLite."""

    def __init__(self, database: Optional[DatabaseManager] = None):
        self.db = database or db

    def get_state(self) -> Dict[str, Any]:
        """Returns the full playback state with categorized track lists."""
        tracks = self.db.get_tracks()
        mode = self.db.get_setting("playback_mode", "ordered")

        played = [t for t in tracks if t.get("status") == "played"]
        playing = [t for t in tracks if t.get("status") == "playing"]
        queued = [t for t in tracks if t.get("status") == "queued"]

        next_track = queued[0] if queued else None
        now_playing_track = playing[0] if playing else None

        return {
            "mode": mode,
            "total_count": len(tracks),
            "played_count": len(played),
            "playing_count": len(playing),
            "queued_count": len(queued),
            "now_playing": now_playing_track,
            "next": next_track,
            "tracks": tracks,
            "played_tracks": played,
            "queued_tracks": queued,
        }

    def add_track(
        self,
        url: str,
        title: str = "",
        thumbnail: Optional[str] = None,
        auto_fetch: bool = True,
        order: Optional[str] = None,
        after: Optional[Any] = None,
        before: Optional[Any] = None,
        position: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """
        Appends or inserts a new track in the playback list as 'queued' with fetched metadata.
        Supports custom ordering placement:
          - order='next' / 'top': Play immediately next (after currently playing track).
          - order='last' / 'bottom': Append to the end of the playback list.
          - after=<target>: Insert immediately after target track (by index, title query, URL, or ID).
          - before=<target>: Insert immediately before target track (by index, title query, URL, or ID).
          - position=<N>: Insert at 1-based position N in the playback list.
        """
        if not url or not url.strip():
            raise ValueError("Track URL or search query is required")

        url = url.strip()

        # If not a direct URL, search YouTube first
        if not url.startswith("http://") and not url.startswith("https://"):
            from music_streamer.search import search_music

            res = search_music(url, num=1)
            if res.results:
                url = res.results[0].url
                title = res.results[0].title

        if (not title or title == url) and auto_fetch and (url.startswith("http://") or url.startswith("https://")):
            from music_streamer.search import fetch_track_metadata

            meta = fetch_track_metadata(url)
            if meta.get("title") and meta["title"] != url:
                title = meta["title"]
            if not thumbnail and meta.get("thumbnail"):
                thumbnail = meta["thumbnail"]

        if not title or title == url:
            m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/|watch\?.*v=)([a-zA-Z0-9_-]{11})", url)
            title = f"YouTube Track ({m.group(1)})" if m else url

        if not thumbnail:
            thumbnail = get_thumbnail_for_url(url)

        track_res = self.db.add_track(url=url, title=title, thumbnail=thumbnail, status="queued")

        # Resolve custom ordering if requested
        order_type = None
        target_spec = None

        if after is not None:
            order_type = "after"
            target_spec = after
        elif before is not None:
            order_type = "before"
            target_spec = before
        elif position is not None:
            if isinstance(position, str):
                pos_lower = position.strip().lower()
                if pos_lower in ["next", "top", "first", "next-up"]:
                    order_type = "next"
                elif pos_lower in ["last", "bottom", "end"]:
                    order_type = "last"
                elif pos_lower.isdigit():
                    order_type = "position"
                    target_spec = int(pos_lower)
                else:
                    order_type = "position"
                    target_spec = position
            else:
                order_type = "position"
                target_spec = int(position)
        elif order is not None:
            order_str = str(order).strip()
            order_lower = order_str.lower()
            if order_lower in ["next", "top", "first", "next-up"]:
                order_type = "next"
            elif order_lower in ["last", "bottom", "end"]:
                order_type = "last"
            elif order_lower.startswith("after:") or order_lower.startswith("after "):
                order_type = "after"
                target_spec = order_str[5:].strip().lstrip(":").strip()
            elif order_lower.startswith("before:") or order_lower.startswith("before "):
                order_type = "before"
                target_spec = order_str[6:].strip().lstrip(":").strip()
            elif order_lower.startswith("pos:") or order_lower.startswith("position:"):
                order_type = "position"
                target_spec = order_str.split(":", 1)[1].strip()
            elif order_lower.isdigit():
                order_type = "position"
                target_spec = int(order_lower)
            else:
                order_type = "position"
                target_spec = order_str

        already_exists = track_res.get("already_exists", False)

        if order_type and order_type != "last":
            tracks = self.db.get_tracks()
            from_idx = next((i for i, t in enumerate(tracks) if t["id"] == track_res["id"]), None)
            if from_idx is not None and len(tracks) > 1:
                to_idx = None
                if order_type == "next":
                    playing_idx = next((i for i, t in enumerate(tracks) if t.get("status") == "playing"), None)
                    if playing_idx is not None:
                        to_idx = playing_idx + 1 if from_idx > playing_idx else playing_idx
                    else:
                        first_unplayed = next((i for i, t in enumerate(tracks) if t.get("status") != "played"), 0)
                        to_idx = first_unplayed

                elif order_type == "after":
                    ref_idx = self.find_track_index(target_spec)
                    if ref_idx is not None:
                        to_idx = ref_idx + 1 if from_idx > ref_idx else ref_idx
                    else:
                        to_idx = len(tracks) - 1

                elif order_type == "before":
                    ref_idx = self.find_track_index(target_spec)
                    if ref_idx is not None:
                        to_idx = ref_idx if from_idx > ref_idx else max(0, ref_idx - 1)
                    else:
                        first_unplayed = next((i for i, t in enumerate(tracks) if t.get("status") != "played"), 0)
                        to_idx = first_unplayed

                elif order_type == "position":
                    if isinstance(target_spec, str) and target_spec.isdigit():
                        target_spec = int(target_spec)
                    if isinstance(target_spec, int):
                        to_idx = max(0, min(len(tracks) - 1, target_spec - 1))
                    else:
                        ref_idx = self.find_track_index(target_spec)
                        to_idx = ref_idx if ref_idx is not None else len(tracks) - 1

                if to_idx is not None:
                    to_idx = max(0, min(len(tracks) - 1, to_idx))
                    self.move_track(from_idx, to_idx)
                    updated = self.db.get_track_by_id(track_res["id"])
                    if updated:
                        track_res = updated

        tracks = self.db.get_tracks()
        final_idx = next((i for i, t in enumerate(tracks) if t["id"] == track_res["id"]), None)
        if final_idx is not None:
            track_res["position"] = final_idx + 1
        track_res["already_exists"] = already_exists

        return track_res

    def add_tracks_bulk(
        self,
        items: List[Any],
        auto_fetch: bool = True,
        order: Optional[str] = None,
        after: Optional[Any] = None,
        before: Optional[Any] = None,
        position: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """
        Adds multiple tracks to the playback list in bulk with optional atomic batch placement.
        Each item in `items` can be:
          - A string (URL or search query)
          - A dictionary: {"url": str, "title": Optional[str], "thumbnail": Optional[str]}
        Supports batch placement:
          - order='next' / 'top': Inserts the whole batch immediately after the playing track.
          - order='last' / 'bottom': Appends the batch to the end of the list (default).
          - after=<target>: Inserts the batch immediately following target track.
          - before=<target>: Inserts the batch immediately preceding target track.
          - position=<N>: Inserts the batch starting at 1-based position N.
        """
        if not items:
            return {"status": "ok", "added_count": 0, "already_exists_count": 0, "tracks": []}

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

            # If search query, resolve via YouTube search
            if not u.startswith("http://") and not u.startswith("https://"):
                from music_streamer.search import search_music

                res = search_music(u, num=1)
                if res.results:
                    u = res.results[0].url
                    t = res.results[0].title
                    th = res.results[0].thumbnail

            if (not t or t == u) and auto_fetch and (u.startswith("http://") or u.startswith("https://")):
                from music_streamer.search import fetch_track_metadata

                meta = fetch_track_metadata(u)
                if meta.get("title") and meta["title"] != u:
                    t = meta["title"]
                if not th and meta.get("thumbnail"):
                    th = meta["thumbnail"]

            if not t or t == u:
                m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/|watch\?.*v=)([a-zA-Z0-9_-]{11})", u)
                t = f"YouTube Track ({m.group(1)})" if m else u

            if not th:
                th = get_thumbnail_for_url(u)

            resolved_items.append((u, t, th))

        if not resolved_items:
            return {"status": "ok", "added_count": 0, "already_exists_count": 0, "tracks": []}

        added_tracks = []
        already_exists_count = 0

        for u, t, th in resolved_items:
            res = self.db.add_track(url=u, title=t, thumbnail=th, status="queued")
            if res.get("already_exists"):
                already_exists_count += 1
            added_tracks.append(res)

        batch_ids = [t["id"] for t in added_tracks]

        # Resolve custom batch placement
        order_type = None
        target_spec = None

        if after is not None:
            order_type = "after"
            target_spec = after
        elif before is not None:
            order_type = "before"
            target_spec = before
        elif position is not None:
            if isinstance(position, str):
                pos_lower = position.strip().lower()
                if pos_lower in ["next", "top", "first", "next-up"]:
                    order_type = "next"
                elif pos_lower in ["last", "bottom", "end"]:
                    order_type = "last"
                elif pos_lower.isdigit():
                    order_type = "position"
                    target_spec = int(pos_lower)
                else:
                    order_type = "position"
                    target_spec = position
            else:
                order_type = "position"
                target_spec = int(position)
        elif order is not None:
            order_str = str(order).strip()
            order_lower = order_str.lower()
            if order_lower in ["next", "top", "first", "next-up"]:
                order_type = "next"
            elif order_lower in ["last", "bottom", "end"]:
                order_type = "last"
            elif order_lower.startswith("after:") or order_lower.startswith("after "):
                order_type = "after"
                target_spec = order_str[5:].strip().lstrip(":").strip()
            elif order_lower.startswith("before:") or order_lower.startswith("before "):
                order_type = "before"
                target_spec = order_str[6:].strip().lstrip(":").strip()
            elif order_lower.startswith("pos:") or order_lower.startswith("position:"):
                order_type = "position"
                target_spec = order_str.split(":", 1)[1].strip()
            elif order_lower.isdigit():
                order_type = "position"
                target_spec = int(order_lower)
            else:
                order_type = "position"
                target_spec = order_str

        all_tracks = self.db.get_tracks()
        remaining_tracks = [t for t in all_tracks if t["id"] not in batch_ids]

        if order_type and order_type != "last" and remaining_tracks:
            to_idx = len(remaining_tracks)
            if order_type == "next":
                playing_idx = next((i for i, t in enumerate(remaining_tracks) if t.get("status") == "playing"), None)
                if playing_idx is not None:
                    to_idx = playing_idx + 1
                else:
                    first_unplayed = next((i for i, t in enumerate(remaining_tracks) if t.get("status") != "played"), 0)
                    to_idx = first_unplayed

            elif order_type == "after":
                ref_idx = self._find_index_in_tracks(remaining_tracks, target_spec)
                to_idx = ref_idx + 1 if ref_idx is not None else len(remaining_tracks)

            elif order_type == "before":
                ref_idx = self._find_index_in_tracks(remaining_tracks, target_spec)
                to_idx = ref_idx if ref_idx is not None else 0

            elif order_type == "position":
                if isinstance(target_spec, str) and target_spec.isdigit():
                    target_spec = int(target_spec)
                if isinstance(target_spec, int):
                    to_idx = max(0, min(len(remaining_tracks), target_spec - 1))
                else:
                    ref_idx = self._find_index_in_tracks(remaining_tracks, target_spec)
                    to_idx = ref_idx if ref_idx is not None else len(remaining_tracks)

            # Clamp so to_idx is not before played tracks
            first_unplayed = next((i for i, t in enumerate(remaining_tracks) if t.get("status") != "played"), 0)
            if to_idx < first_unplayed:
                to_idx = first_unplayed

            to_idx = max(0, min(len(remaining_tracks), to_idx))
            reordered_ids = [t["id"] for t in remaining_tracks[:to_idx]] + batch_ids + [t["id"] for t in remaining_tracks[to_idx:]]
            self.db.reorder_tracks(reordered_ids)

        all_tracks = self.db.get_tracks()
        pos_map = {t["id"]: i + 1 for i, t in enumerate(all_tracks)}

        final_tracks = []
        for t in added_tracks:
            up = self.db.get_track_by_id(t["id"]) or t
            up["position"] = pos_map.get(t["id"], 0)
            up["already_exists"] = t.get("already_exists", False)
            final_tracks.append(up)

        return {
            "status": "ok",
            "added_count": len(final_tracks),
            "already_exists_count": already_exists_count,
            "tracks": final_tracks,
        }

    def _find_index_in_tracks(self, tracks: List[Dict[str, Any]], query_or_id_or_index: Any) -> Optional[int]:
        """Helper to find index of a track inside a specific track list."""
        if not tracks or query_or_id_or_index is None:
            return None

        if isinstance(query_or_id_or_index, int):
            if 0 <= query_or_id_or_index < len(tracks):
                return query_or_id_or_index
            return None

        query_str = str(query_or_id_or_index).strip()
        if query_str.isdigit():
            idx = int(query_str) - 1
            if 0 <= idx < len(tracks):
                return idx

        for i, t in enumerate(tracks):
            if t.get("id") == query_str or t.get("url") == query_str:
                return i

        q_lower = query_str.lower()
        for i, t in enumerate(tracks):
            title = (t.get("title") or "").lower()
            if q_lower in title:
                return i

        from music_streamer.db import calculate_match_similarity
        best_idx = None
        best_score = 0.0
        for i, t in enumerate(tracks):
            title = t.get("title") or ""
            score = calculate_match_similarity(query_str, title)
            if score > best_score and score >= 0.5:
                best_score = score
                best_idx = i

        return best_idx

    def mark_playing_url(
        self,
        url: str,
        title: str = "",
        thumbnail: Optional[str] = None,
        auto_fetch: bool = True,
    ):
        """Marks a track matching url as 'playing', while previous playing track becomes 'played'."""
        if not url or not url.strip():
            return

        url = url.strip()

        if (not title or title == url) and auto_fetch and (url.startswith("http://") or url.startswith("https://")):
            from music_streamer.search import fetch_track_metadata

            meta = fetch_track_metadata(url)
            if meta.get("title") and meta["title"] != url:
                title = meta["title"]
            if not thumbnail and meta.get("thumbnail"):
                thumbnail = meta["thumbnail"]

        if not title or title == url:
            m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/|watch\?.*v=)([a-zA-Z0-9_-]{11})", url)
            title = f"YouTube Track ({m.group(1)})" if m else url

        tracks = self.db.get_tracks()
        self.db.set_setting("last_played_url", url)
        tracks = self.db.get_tracks()
        currently_playing = [t for t in tracks if t.get("status") == "playing"]

        for t in currently_playing:
            if t.get("url") != url:
                self.db.update_track_status(t["id"], "played")

        matching_track = next((t for t in tracks if t.get("url") == url), None)
        if matching_track:
            self.db.update_track_status(matching_track["id"], "playing")
            if title or thumbnail:
                self.db.update_track_info(
                    matching_track["id"],
                    title=title if title else None,
                    thumbnail=thumbnail if thumbnail else None,
                )
            target_id = matching_track["id"]
        else:
            thumb = thumbnail or get_thumbnail_for_url(url)
            new_track = self.db.add_track(url=url, title=title or url, thumbnail=thumb, status="playing")
            target_id = new_track["id"]

        updated_tracks = self.db.get_tracks()
        played_ids = [t["id"] for t in updated_tracks if t.get("status") == "played" and t["id"] != target_id]
        queued_ids = [t["id"] for t in updated_tracks if t.get("status") == "queued" and t["id"] != target_id]
        reordered_ids = played_ids + [target_id] + queued_ids
        self.db.reorder_tracks(reordered_ids)

    def mark_current_finished(self):
        """Marks the currently playing track as 'played'."""
        tracks = self.db.get_tracks(status="playing")
        for t in tracks:
            self.db.update_track_status(t["id"], "played")
            self.db.set_setting("last_played_url", t.get("url", ""))

    def get_next_track_for_playback(self, loop: bool = True, allow_restart: bool = False) -> Tuple[Optional[Dict[str, Any]], bool]:
        """
        Picks the next track to play:
          1. If unplayed tracks ('queued') exist:
             - Picks the first unplayed track and marks it 'playing'.
             - Returns (track, False).
          2. If ALL tracks in playback list are already 'played' (or no unplayed tracks exist):
             - If loop is True OR allow_restart is True:
               - Resets all tracks to 'queued'.
               - If in Shuffle mode:
                   Performs a Fair Reshuffle: randomizes list such that the first song
                   is NOT the same as the last played song (if total tracks > 1).
               - Picks the first track of the new cycle, marks it 'playing'.
               - Returns (track, True [indicating new cycle started]).
             - Else:
               - Returns (None, False).
        """
        # Mark currently playing track as played
        playing = self.db.get_tracks(status="playing")
        last_played = self.db.get_setting("last_played_url", "")
        for t in playing:
            self.db.update_track_status(t["id"], "played")
            last_played = t.get("url", "")
            self.db.set_setting("last_played_url", last_played)

        tracks = self.db.get_tracks()
        if not tracks:
            return None, False

        queued = [t for t in tracks if t.get("status") == "queued"]
        if queued:
            target_track = queued[0]
            self.db.update_track_status(target_track["id"], "playing")
            self.db.set_setting("last_played_url", target_track["url"])
            return self.db.get_track_by_id(target_track["id"]), False

        # All tracks already played! Check loop or allow_restart setting
        if (loop or allow_restart) and len(tracks) > 0:
            self.db.reset_track_history()
            mode = self.db.get_setting("playback_mode", "ordered")

            if mode == "shuffled" and len(tracks) > 1:
                track_ids = [t["id"] for t in tracks]
                for _ in range(20):
                    random.shuffle(track_ids)
                    first_track = self.db.get_track_by_id(track_ids[0])
                    if first_track and first_track["url"] != last_played:
                        break
                self.db.reorder_tracks(track_ids)

            # Re-fetch after reset and shuffle
            refreshed_tracks = self.db.get_tracks(status="queued")
            if refreshed_tracks:
                first_track = refreshed_tracks[0]
                self.db.update_track_status(first_track["id"], "playing")
                self.db.set_setting("last_played_url", first_track["url"])
                return self.db.get_track_by_id(first_track["id"]), True

        return None, False

    def get_previous_track_for_playback(self, loop: bool = True) -> Tuple[Optional[Dict[str, Any]], bool]:
        """
        Picks the previous track to play:
          1. If played tracks exist:
             - Moves currently playing track (if any) back to 'queued'.
             - Picks the most recently played track (last track in 'played' status).
             - Marks it as 'playing' and returns (track, False).
          2. If NO played tracks exist, but tracks exist:
             - If loop is True and len(tracks) > 1:
               - The currently playing track (if any) is marked 'queued'.
               - Marks all other tracks before the last track as 'played'.
               - Marks the last track as 'playing' and returns (last_track, True).
             - Else (or if single track / loop=False):
               - Returns the current or first track (replaying it).
        """
        tracks = self.db.get_tracks()
        if not tracks:
            return None, False

        playing = [t for t in tracks if t.get("status") == "playing"]
        played = [t for t in tracks if t.get("status") == "played"]

        # Case 1: Played tracks exist
        if played:
            target_track = played[-1]
            for t in playing:
                self.db.update_track_status(t["id"], "queued")
            self.db.update_track_status(target_track["id"], "playing")
            self.db.set_setting("last_played_url", target_track["url"])
            return self.db.get_track_by_id(target_track["id"]), False

        # Case 2: No played tracks, but we have multiple tracks and loop is enabled
        if loop and len(tracks) > 1:
            target_track = tracks[-1]
            for t in tracks:
                if t["id"] == target_track["id"]:
                    self.db.update_track_status(t["id"], "playing")
                elif playing and t["id"] in [p["id"] for p in playing]:
                    self.db.update_track_status(t["id"], "queued")
                else:
                    self.db.update_track_status(t["id"], "played")
            self.db.set_setting("last_played_url", target_track["url"])
            return self.db.get_track_by_id(target_track["id"]), True

        # Case 3: Replay currently playing or first track
        if playing:
            target = playing[0]
            self.db.set_setting("last_played_url", target["url"])
            return self.db.get_track_by_id(target["id"]), False

        target = tracks[0]
        self.db.update_track_status(target["id"], "playing")
        self.db.set_setting("last_played_url", target["url"])
        return self.db.get_track_by_id(target["id"]), False

    def shuffle_unplayed_tracks(self) -> str:
        """Shuffles ONLY unplayed tracks, keeping played history intact."""
        tracks = self.db.get_tracks()
        played = [t["id"] for t in tracks if t.get("status") == "played"]
        playing = [t["id"] for t in tracks if t.get("status") == "playing"]
        queued = [t["id"] for t in tracks if t.get("status") == "queued"]

        if len(queued) > 1:
            random.shuffle(queued)

        reordered_ids = played + playing + queued
        self.db.reorder_tracks(reordered_ids)
        self.db.set_setting("playback_mode", "shuffled")
        return "shuffled"

    def set_mode(self, mode: str) -> str:
        """Sets playback mode to 'ordered' or 'shuffled'."""
        current_mode = self.db.get_setting("playback_mode", "ordered")
        if mode == "toggle":
            target_mode = "ordered" if current_mode == "shuffled" else "shuffled"
        else:
            target_mode = "shuffled" if mode in ["shuffled", "shuffle"] else "ordered"

        self.db.set_setting("playback_mode", target_mode)
        if target_mode == "shuffled":
            self.shuffle_unplayed_tracks()
        return target_mode

    def play_track_by_id(self, track_id: str) -> Optional[Dict[str, Any]]:
        """
        Plays/replays a track by ID.
        - Marks currently playing track as 'played' (adding it to played history).
        - Marks target track as 'playing' and shifts it to the active currently playing position in sort_order.
        - Preserves remaining queued and played tracks in relative order.
        """
        target = self.db.get_track_by_id(str(track_id))
        if not target:
            return None

        tracks = self.db.get_tracks()
        currently_playing = [t for t in tracks if t.get("status") == "playing"]

        # If already playing this exact track, just return it
        if currently_playing and currently_playing[0]["id"] == target["id"]:
            self.db.set_setting("last_played_url", target["url"])
            return self.db.get_track_by_id(target["id"])

        # Mark any other currently playing track as played
        for t in currently_playing:
            if t["id"] != target["id"]:
                self.db.update_track_status(t["id"], "played")

        # Mark target track as playing
        self.db.update_track_status(target["id"], "playing")
        self.db.set_setting("last_played_url", target["url"])

        # Re-fetch tracks to construct the shifted order
        updated_tracks = self.db.get_tracks()

        # Played tracks: all played tracks except the target track
        played_ids = [t["id"] for t in updated_tracks if t.get("status") == "played" and t["id"] != target["id"]]
        # Queued tracks: all queued tracks except the target track
        queued_ids = [t["id"] for t in updated_tracks if t.get("status") == "queued" and t["id"] != target["id"]]

        # Shifted order: Played History -> Target (Now Playing) -> Remaining Queue
        reordered_ids = played_ids + [target["id"]] + queued_ids
        self.db.reorder_tracks(reordered_ids)

        return self.db.get_track_by_id(target["id"])

    def play_track_by_index(self, index: int) -> Optional[Dict[str, Any]]:
        """Jumps to/replays a track at a specific index in the list, shifting it to active playing position."""
        tracks = self.db.get_tracks()
        if 0 <= index < len(tracks):
            target = tracks[index]
            return self.play_track_by_id(target["id"])
        return None

    def find_track_index(self, query_or_id_or_index: Any) -> Optional[int]:
        """
        Finds the 0-based index of a track by:
        1. 0-based or 1-based numeric index
        2. Exact track ID string
        3. URL match
        4. Substring / fuzzy title match
        """
        tracks = self.db.get_tracks()
        if not tracks:
            return None

        if isinstance(query_or_id_or_index, int):
            if 0 <= query_or_id_or_index < len(tracks):
                return query_or_id_or_index
            return None

        query_str = str(query_or_id_or_index).strip()
        if query_str.isdigit():
            idx = int(query_str) - 1
            if 0 <= idx < len(tracks):
                return idx

        for i, t in enumerate(tracks):
            if t.get("id") == query_str or t.get("url") == query_str:
                return i

        q_lower = query_str.lower()
        for i, t in enumerate(tracks):
            title = (t.get("title") or "").lower()
            if q_lower in title:
                return i

        from music_streamer.db import calculate_match_similarity
        best_idx = None
        best_score = 0.0
        for i, t in enumerate(tracks):
            title = t.get("title") or ""
            score = calculate_match_similarity(query_str, title)
            if score > best_score and score >= 0.5:
                best_score = score
                best_idx = i

        return best_idx

    def move_to_next(self, query_or_id_or_index: Any) -> bool:
        """Moves specified track to play immediately next (after currently playing track)."""
        tracks = self.db.get_tracks()
        if not tracks or len(tracks) <= 1:
            return False

        from_idx = self.find_track_index(query_or_id_or_index)
        if from_idx is None:
            return False

        playing_idx = None
        for i, t in enumerate(tracks):
            if t.get("status") == "playing":
                playing_idx = i
                break

        if playing_idx is not None:
            to_idx = playing_idx + 1 if from_idx > playing_idx else playing_idx
        else:
            to_idx = 0

        to_idx = max(0, min(len(tracks) - 1, to_idx))
        return self.move_track(from_idx, to_idx)

    def move_track(self, from_index: int, to_index: int) -> bool:
        """
        Moves a track from from_index to to_index (0-indexed) in the playback list,
        preserving all statuses and updating sort_order in SQLite.
        Played tracks cannot be moved.
        """
        tracks = self.db.get_tracks()
        if not tracks:
            return False
        if not (0 <= from_index < len(tracks)) or not (0 <= to_index < len(tracks)):
            return False
        if from_index == to_index:
            return True

        # Prevent moving played tracks
        if tracks[from_index].get("status") == "played":
            return False

        # If to_index points to a played track, clamp to first unplayed position
        first_unplayed_idx = next((i for i, t in enumerate(tracks) if t.get("status") != "played"), 0)
        if to_index < first_unplayed_idx:
            to_index = first_unplayed_idx

        if from_index == to_index:
            return True

        track_ids = [t["id"] for t in tracks]
        item = track_ids.pop(from_index)
        track_ids.insert(to_index, item)
        self.db.reorder_tracks(track_ids)
        return True

    def reorder_tracks(self, track_ids: List[str]) -> bool:
        """
        Reorders playback tracks according to the provided list of track IDs.
        Supports full list or queued-only track list reordering.
        """
        tracks = self.db.get_tracks()
        if not tracks:
            return False

        played_ids = [t["id"] for t in tracks if t.get("status") == "played"]
        playing_ids = [t["id"] for t in tracks if t.get("status") == "playing"]
        queued_ids = [t["id"] for t in tracks if t.get("status") == "queued"]

        # Case 1: Reordering only queued tracks
        if len(track_ids) == len(queued_ids) and set(track_ids) == set(queued_ids):
            full_reordered = played_ids + playing_ids + track_ids
            self.db.reorder_tracks(full_reordered)
            return True

        # Case 2: Full tracklist provided
        if len(track_ids) == len(tracks) and set(track_ids) == {t["id"] for t in tracks}:
            self.db.reorder_tracks(track_ids)
            return True

        return False

    def reorder_by_indices(self, new_order: List[int]) -> bool:
        """
        Reorders playback tracks according to a list of 0-based indices.
        Example: [2, 0, 1] puts the 3rd track first, then 1st, then 2nd.
        """
        tracks = self.db.get_tracks()
        if not tracks or len(new_order) != len(tracks):
            return False

        if sorted(new_order) != list(range(len(tracks))):
            return False

        reordered_ids = [tracks[i]["id"] for i in new_order]
        self.db.reorder_tracks(reordered_ids)
        return True

    def remove_track(self, index_or_id: Any) -> bool:
        """Removes a track from the playback list by index or ID."""
        try:
            idx = int(index_or_id)
            if self.db.remove_track_by_index(idx):
                return True
        except (ValueError, TypeError):
            pass
        return self.db.remove_track_by_id(str(index_or_id))

    def reset_history(self):
        """Resets all played tracks back to 'queued' state for a fresh replay."""
        self.db.reset_track_history()

    def clear_all(self):
        """Empties the playback list completely."""
        self.db.clear_all_tracks()
        self.db.set_setting("playback_mode", "ordered")
        self.db.set_setting("last_played_url", "")



# Global singleton instance
playback_mgr = PlaybackManager()
