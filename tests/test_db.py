"""Unit tests for SQLite DatabaseManager in music_streamer.db."""

import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from music_streamer.db import DatabaseManager


class TestDatabaseManager(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_music_streamer.db"
        self.db = DatabaseManager(self.db_path)

    def tearDown(self):
        self.db.close()
        self.temp_dir.cleanup()

    def test_schema_creation_and_wal_mode(self):
        """Verify tables are created and WAL mode is enabled."""
        with self.db.get_connection() as conn:
            # Check WAL mode
            cur = conn.cursor()
            mode = cur.execute("PRAGMA journal_mode;").fetchone()[0]
            self.assertEqual(mode.lower(), "wal")

            # Check tables
            tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()]
            self.assertIn("settings", tables)
            self.assertIn("playback_tracks", tables)
            self.assertIn("otp_sessions", tables)

    def test_settings_crud(self):
        """Verify key-value settings get, set, delete, and default behaviors."""
        # Default fallback
        self.assertEqual(self.db.get_setting("non_existent", default="foo"), "foo")

        # Set and get
        self.db.set_setting("volume", "85")
        self.assertEqual(self.db.get_setting("volume"), "85")
        self.assertEqual(self.db.get_int_setting("volume"), 85)

        # Update
        self.db.set_setting("volume", "90")
        self.assertEqual(self.db.get_int_setting("volume"), 90)

        # Boolean helper
        self.db.set_setting("otp_enabled", "1")
        self.assertTrue(self.db.get_bool_setting("otp_enabled"))
        self.db.set_setting("otp_enabled", "0")
        self.assertFalse(self.db.get_bool_setting("otp_enabled"))

        # Multiple settings
        self.db.set_setting("state", "playing")
        self.db.set_setting("loop", "yes")
        all_settings = self.db.get_all_settings()
        self.assertEqual(all_settings["volume"], "90")
        self.assertEqual(all_settings["state"], "playing")
        self.assertEqual(all_settings["loop"], "yes")

    def test_playback_tracks_lifecycle(self):
        """Verify adding, updating status, querying, and deleting tracks."""
        # Add tracks
        t1 = self.db.add_track(url="https://youtube.com/watch?v=1", title="Track 1", thumbnail="https://img/1.jpg")
        t2 = self.db.add_track(url="https://youtube.com/watch?v=2", title="Track 2", thumbnail="https://img/2.jpg")
        t3 = self.db.add_track(url="https://youtube.com/watch?v=3", title="Track 3", thumbnail="https://img/3.jpg")

        self.assertIsNotNone(t1["id"])
        self.assertEqual(t1["status"], "queued")
        self.assertEqual(t1["title"], "Track 1")

        # Get all tracks
        tracks = self.db.get_tracks()
        self.assertEqual(len(tracks), 3)

        # Transition track 1 to playing
        self.db.update_track_status(t1["id"], "playing")
        t1_updated = self.db.get_track_by_id(t1["id"])
        self.assertEqual(t1_updated["status"], "playing")

        # Transition track 1 to played, track 2 to playing
        self.db.update_track_status(t1["id"], "played")
        self.db.update_track_status(t2["id"], "playing")

        played = self.db.get_tracks(status="played")
        playing = self.db.get_tracks(status="playing")
        queued = self.db.get_tracks(status="queued")

        self.assertEqual(len(played), 1)
        self.assertEqual(played[0]["id"], t1["id"])
        self.assertEqual(len(playing), 1)
        self.assertEqual(playing[0]["id"], t2["id"])
        self.assertEqual(len(queued), 1)
        self.assertEqual(queued[0]["id"], t3["id"])

        # Remove track 3
        removed = self.db.remove_track_by_id(t3["id"])
        self.assertTrue(removed)
        self.assertEqual(len(self.db.get_tracks()), 2)

        # Reset history
        self.db.reset_track_history()
        all_queued = self.db.get_tracks()
        for t in all_queued:
            self.assertEqual(t["status"], "queued")

        # Clear all
        self.db.clear_all_tracks()
        self.assertEqual(len(self.db.get_tracks()), 0)

    def test_reorder_tracks(self):
        """Verify changing the sort order of tracks."""
        t1 = self.db.add_track(url="https://youtube.com/watch?v=1", title="Track 1")
        t2 = self.db.add_track(url="https://youtube.com/watch?v=2", title="Track 2")
        t3 = self.db.add_track(url="https://youtube.com/watch?v=3", title="Track 3")

        # Reorder to [t3, t1, t2]
        self.db.reorder_tracks([t3["id"], t1["id"], t2["id"]])
        ordered = self.db.get_tracks()
        self.assertEqual([t["id"] for t in ordered], [t3["id"], t1["id"], t2["id"]])

    def test_otp_sessions(self):
        """Verify session creation with role, lookup, role validation, and expiration pruning."""
        token1 = self.db.create_session(token="tok1", client_ip="192.168.1.10", role="admin", duration_seconds=3600)
        token2 = self.db.create_session(token="tok2", client_ip="192.168.1.20", role="subscriber", duration_seconds=-10)  # Expired
        token3 = self.db.create_session(token="tok3", client_ip="192.168.1.30", role="subscriber", duration_seconds=3600)

        self.assertTrue(self.db.validate_session("tok1"))
        self.assertFalse(self.db.validate_session("tok2"))
        self.assertTrue(self.db.validate_session("tok3"))
        self.assertFalse(self.db.validate_session("invalid_tok"))

        session1 = self.db.get_session("tok1")
        self.assertIsNotNone(session1)
        self.assertEqual(session1["client_ip"], "192.168.1.10")
        self.assertEqual(session1["role"], "admin")
        self.assertEqual(self.db.get_session_role("tok1"), "admin")
        self.assertEqual(self.db.get_session_role("tok3"), "subscriber")

        # Prune expired
        self.db.prune_expired_sessions()
        all_sessions = self.db.get_all_active_sessions()
        self.assertIn("tok1", all_sessions)
        self.assertNotIn("tok2", all_sessions)
        self.assertIn("tok3", all_sessions)

    def test_fuzzy_search_and_normalization(self):
        """Verify search_local_tracks matches queries regardless of apostrophes and punctuation."""
        from music_streamer.db import calculate_match_similarity, normalize_search_tokens

        # Normalization tests
        s, tokens = normalize_search_tokens("Kaleb J - It's Only Me (Official MV)")
        self.assertIn("its", tokens)
        self.assertIn("kaleb", tokens)
        self.assertIn("only", tokens)
        self.assertIn("me", tokens)

        # Similarity score tests
        score_exact = calculate_match_similarity("It's only me", "Kaleb J - It's Only Me (Official MV)")
        score_no_apostrophe = calculate_match_similarity("Its only me", "Kaleb J - It's Only Me (Official MV)")
        self.assertGreaterEqual(score_exact, 0.90)
        self.assertGreaterEqual(score_no_apostrophe, 0.90)

        # Create playlist with track containing apostrophe
        self.db.create_playlist("Top Hits")
        self.db.add_track_to_playlist("Top Hits", url="https://youtube.com/watch?v=kaleb1", title="Kaleb J - It's Only Me (Official Music Video)")

        # Search with "Its only me" (no apostrophe)
        matches1 = self.db.search_local_tracks("Its only me")
        self.assertEqual(len(matches1), 1)
        self.assertEqual(matches1[0]["title"], "Kaleb J - It's Only Me (Official Music Video)")
        self.assertTrue(matches1[0]["is_exact_match"])

        # Search with "It's only me" (with apostrophe)
        matches2 = self.db.search_local_tracks("It's only me")
        self.assertEqual(len(matches2), 1)
        self.assertEqual(matches2[0]["title"], "Kaleb J - It's Only Me (Official Music Video)")

        # Search with word swap / partial: "kaleb only me"
        matches3 = self.db.search_local_tracks("kaleb only me")
        self.assertEqual(len(matches3), 1)
        self.assertEqual(matches3[0]["title"], "Kaleb J - It's Only Me (Official Music Video)")

        # Playlist fuzzy lookup: get_playlist("tophits")
        pl_fuzzy = self.db.get_playlist("tophits")
        self.assertIsNotNone(pl_fuzzy)
        self.assertEqual(pl_fuzzy["name"], "Top Hits")


if __name__ == "__main__":
    unittest.main()
