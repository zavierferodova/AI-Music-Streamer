"""Unit tests for Multi-Playlist Management & SQLite Persistence in music_streamer.playlist."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from music_streamer.db import DatabaseManager
from music_streamer.playback import PlaybackManager
from music_streamer.playlist import PlaylistManager


class TestPlaylistManager(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_playlists.db"
        self.db = DatabaseManager(self.db_path)
        self.playback = PlaybackManager(self.db)
        self.playlist_mgr = PlaylistManager(self.db, self.playback)

    def tearDown(self):
        self.db.close()
        self.temp_dir.cleanup()

    def test_create_and_list_multiple_playlists(self):
        """Verify creating multiple independent named playlists."""
        p1 = self.playlist_mgr.create_playlist("Favorites")
        p2 = self.playlist_mgr.create_playlist("Chill Vibes")
        p3 = self.playlist_mgr.create_playlist("Rock Classics")

        self.assertEqual(p1["name"], "Favorites")
        self.assertEqual(p2["name"], "Chill Vibes")
        self.assertEqual(p3["name"], "Rock Classics")

        playlists = self.playlist_mgr.get_playlists()
        self.assertEqual(len(playlists), 3)
        names = [p["name"] for p in playlists]
        self.assertIn("Favorites", names)
        self.assertIn("Chill Vibes", names)
        self.assertIn("Rock Classics", names)

    def test_add_and_remove_tracks_in_playlist(self):
        """Verify adding and deleting tracks in a specific playlist."""
        self.playlist_mgr.create_playlist("My Playlist")

        # Add 2 tracks with explicit titles
        t1 = self.playlist_mgr.add_track(
            "My Playlist",
            url="https://www.youtube.com/watch?v=vid1",
            title="Song One",
            thumbnail="https://img.youtube.com/vi/vid1/0.jpg",
            auto_fetch=False,
        )
        t2 = self.playlist_mgr.add_track(
            "My Playlist",
            url="https://www.youtube.com/watch?v=vid2",
            title="Song Two",
            thumbnail="https://img.youtube.com/vi/vid2/0.jpg",
            auto_fetch=False,
        )

        pl = self.playlist_mgr.get_playlist("My Playlist")
        self.assertIsNotNone(pl)
        self.assertEqual(pl["track_count"], 2)
        self.assertEqual(pl["tracks"][0]["title"], "Song One")
        self.assertEqual(pl["tracks"][1]["title"], "Song Two")

        # Remove track 0 by index
        self.assertTrue(self.playlist_mgr.remove_track("My Playlist", 0))
        pl = self.playlist_mgr.get_playlist("My Playlist")
        self.assertEqual(pl["track_count"], 1)
        self.assertEqual(pl["tracks"][0]["title"], "Song Two")

        # Remove remaining track by ID
        self.assertTrue(self.playlist_mgr.remove_track("My Playlist", t2["id"]))
        pl = self.playlist_mgr.get_playlist("My Playlist")
        self.assertEqual(pl["track_count"], 0)

    def test_delete_playlist_isolation(self):
        """Verify deleting a playlist does not affect other playlists."""
        self.playlist_mgr.create_playlist("List A")
        self.playlist_mgr.create_playlist("List B")

        self.playlist_mgr.add_track("List A", "https://youtube.com/watch?v=a", "Song A", auto_fetch=False)
        self.playlist_mgr.add_track("List B", "https://youtube.com/watch?v=b", "Song B", auto_fetch=False)

        self.assertTrue(self.playlist_mgr.delete_playlist("List A"))
        self.assertIsNone(self.playlist_mgr.get_playlist("List A"))

        list_b = self.playlist_mgr.get_playlist("List B")
        self.assertIsNotNone(list_b)
        self.assertEqual(list_b["track_count"], 1)
        self.assertEqual(list_b["tracks"][0]["title"], "Song B")

    def test_play_playlist_ordered(self):
        """Verify loading playlist into playback starts playing in ordered mode."""
        self.playlist_mgr.create_playlist("Summer")
        self.playlist_mgr.add_track("Summer", "https://youtube.com/watch?v=1", "Track 1", auto_fetch=False)
        self.playlist_mgr.add_track("Summer", "https://youtube.com/watch?v=2", "Track 2", auto_fetch=False)

        res = self.playlist_mgr.play_playlist("Summer", shuffle=False)
        self.assertTrue(res["success"])
        self.assertEqual(res["mode"], "ordered")
        self.assertEqual(res["count"], 2)

        # Check PlaybackManager state
        pb_state = self.playback.get_state()
        self.assertEqual(pb_state["total_count"], 2)
        self.assertEqual(pb_state["mode"], "ordered")
        self.assertIsNotNone(pb_state["now_playing"])
        self.assertEqual(pb_state["now_playing"]["title"], "Track 1")

    def test_play_playlist_shuffled(self):
        """Verify loading playlist into playback in shuffle mode."""
        self.playlist_mgr.create_playlist("Party")
        for i in range(5):
            self.playlist_mgr.add_track("Party", f"https://youtube.com/watch?v={i}", f"Track {i}", auto_fetch=False)

        res = self.playlist_mgr.play_playlist("Party", shuffle=True)
        self.assertTrue(res["success"])
        self.assertEqual(res["mode"], "shuffled")
        self.assertEqual(res["count"], 5)

        pb_state = self.playback.get_state()
        self.assertEqual(pb_state["mode"], "shuffled")
        self.assertEqual(pb_state["total_count"], 5)
        self.assertIsNotNone(pb_state["now_playing"])

    def test_clear_playback_does_not_clear_playlists(self):
        """Verify clearing the active playback queue preserves persistent playlists."""
        self.playlist_mgr.create_playlist("Permanent Collection")
        self.playlist_mgr.add_track(
            "Permanent Collection", "https://youtube.com/watch?v=fav", "Favorite Song", auto_fetch=False
        )

        # Play it (populating playback queue)
        self.playlist_mgr.play_playlist("Permanent Collection")
        self.assertEqual(self.playback.get_state()["total_count"], 1)

        # Clear ephemeral playback queue
        self.playback.clear_all()
        self.assertEqual(self.playback.get_state()["total_count"], 0)

        # Playlist in SQLite MUST still be intact!
        pl = self.playlist_mgr.get_playlist("Permanent Collection")
        self.assertIsNotNone(pl)
        self.assertEqual(pl["track_count"], 1)
        self.assertEqual(pl["tracks"][0]["title"], "Favorite Song")

    def test_queue_playlist(self):
        """Verify queue_playlist appends tracks without stopping now playing."""
        # Initial song playing
        self.playback.add_track("https://youtube.com/watch?v=initial", "Initial Song", auto_fetch=False)
        self.playback.get_next_track_for_playback()

        self.playlist_mgr.create_playlist("Queue List")
        self.playlist_mgr.add_track("Queue List", "https://youtube.com/watch?v=q1", "Queue 1", auto_fetch=False)
        self.playlist_mgr.add_track("Queue List", "https://youtube.com/watch?v=q2", "Queue 2", auto_fetch=False)

        res = self.playlist_mgr.queue_playlist("Queue List")
        self.assertTrue(res["success"])

        pb_state = self.playback.get_state()
        self.assertEqual(pb_state["total_count"], 3)
        self.assertEqual(pb_state["now_playing"]["title"], "Initial Song")
        self.assertEqual(pb_state["queued_count"], 2)

    def test_rename_playlist(self):
        """Verify renaming a playlist updates its name while preserving all tracks."""
        self.playlist_mgr.create_playlist("Old Name")
        self.playlist_mgr.add_track("Old Name", "https://youtube.com/watch?v=1", "Song 1", auto_fetch=False)

        res = self.playlist_mgr.rename_playlist("Old Name", "New Fancy Name")
        self.assertTrue(res["success"])
        self.assertEqual(res["playlist"]["name"], "New Fancy Name")

        # Old name no longer exists
        self.assertIsNone(self.playlist_mgr.get_playlist("Old Name"))

        # New name has all tracks
        new_pl = self.playlist_mgr.get_playlist("New Fancy Name")
        self.assertIsNotNone(new_pl)
        self.assertEqual(new_pl["track_count"], 1)
        self.assertEqual(new_pl["tracks"][0]["title"], "Song 1")

    def test_rename_playlist_duplicate_prevented(self):
        """Verify renaming to an existing playlist name fails cleanly."""
        self.playlist_mgr.create_playlist("List 1")
        self.playlist_mgr.create_playlist("List 2")

        res = self.playlist_mgr.rename_playlist("List 1", "List 2")
        self.assertFalse(res["success"])
        self.assertIn("already exists", res["error"])


if __name__ == "__main__":
    unittest.main()
