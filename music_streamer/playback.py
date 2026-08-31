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
    ) -> Dict[str, Any]:
        """Appends a new track to the playback list as 'queued' with fetched metadata if title is not provided."""
        if (not title or title == url) and auto_fetch and (url.startswith("http://") or url.startswith("https://")):
            from music_streamer.search import fetch_track_metadata

            meta = fetch_track_metadata(url)
            if meta.get("title") and meta["title"] != url:
                title = meta["title"]
            if not thumbnail and meta.get("thumbnail"):
                thumbnail = meta["thumbnail"]

        if not title:
            title = url
        if not thumbnail:
            thumbnail = get_thumbnail_for_url(url)
        return self.db.add_track(url=url, title=title, thumbnail=thumbnail, status="queued")

    def mark_playing_url(
        self,
        url: str,
        title: str = "",
        thumbnail: Optional[str] = None,
        auto_fetch: bool = True,
    ):
        """Marks a track matching url as 'playing', while previous playing track becomes 'played'."""
        if (not title or title == url) and auto_fetch and (url.startswith("http://") or url.startswith("https://")):
            from music_streamer.search import fetch_track_metadata

            meta = fetch_track_metadata(url)
            if meta.get("title") and meta["title"] != url:
                title = meta["title"]
            if not thumbnail and meta.get("thumbnail"):
                thumbnail = meta["thumbnail"]

        tracks = self.db.get_tracks()
        self.db.set_setting("last_played_url", url)

        found = False
        for t in tracks:
            if t.get("status") == "playing" and t.get("url") != url:
                self.db.update_track_status(t["id"], "played")
            elif t.get("url") == url and not found:
                self.db.update_track_status(t["id"], "playing")
                if title or thumbnail:
                    self.db.update_track_info(
                        t["id"],
                        title=title if title else None,
                        thumbnail=thumbnail if thumbnail else None,
                    )
                found = True

        if not found:
            thumb = thumbnail or get_thumbnail_for_url(url)
            self.db.add_track(url=url, title=title or url, thumbnail=thumb, status="playing")

    def mark_current_finished(self):
        """Marks the currently playing track as 'played'."""
        tracks = self.db.get_tracks(status="playing")
        for t in tracks:
            self.db.update_track_status(t["id"], "played")
            self.db.set_setting("last_played_url", t.get("url", ""))

    def get_next_track_for_playback(self, loop: bool = True) -> Tuple[Optional[Dict[str, Any]], bool]:
        """
        Picks the next track to play:
          1. If unplayed tracks ('queued') exist:
             - Picks the first unplayed track and marks it 'playing'.
             - Returns (track, False).
          2. If ALL tracks in playback list are already 'played':
             - If loop is True:
               - Resets all tracks to 'queued'.
               - If in Shuffle mode:
                   Performs a Fair Reshuffle: randomizes list such that the first song
                   is NOT the same as the last played song (if total tracks > 1).
               - Picks the first track of the new cycle, marks it 'playing'.
               - Returns (track, True [indicating new cycle started]).
             - If loop is False:
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

        # All tracks already played! Check loop setting
        if loop and len(tracks) > 0:
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

    def play_track_by_index(self, index: int) -> Optional[Dict[str, Any]]:
        """Jumps directly to track at specific index in the list, marking it as 'playing'."""
        tracks = self.db.get_tracks()
        if 0 <= index < len(tracks):
            target = tracks[index]
            for t in tracks:
                if t["id"] == target["id"]:
                    self.db.update_track_status(t["id"], "playing")
                    self.db.set_setting("last_played_url", t["url"])
                elif t.get("status") == "playing":
                    self.db.update_track_status(t["id"], "played")
            return self.db.get_track_by_id(target["id"])
        return None

    def play_track_by_id(self, track_id: str) -> Optional[Dict[str, Any]]:
        """Jumps directly to a track by ID."""
        target = self.db.get_track_by_id(str(track_id))
        if target:
            tracks = self.db.get_tracks()
            for t in tracks:
                if t["id"] == target["id"]:
                    self.db.update_track_status(t["id"], "playing")
                    self.db.set_setting("last_played_url", t["url"])
                elif t.get("status") == "playing":
                    self.db.update_track_status(t["id"], "played")
            return self.db.get_track_by_id(target["id"])
        return None

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
