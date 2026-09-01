"""Unit tests for Persistent Playback List & Fair Shuffle Cycle Engine in music_streamer.playback."""

import tempfile
import unittest
from pathlib import Path

from music_streamer.db import DatabaseManager
from music_streamer.playback import PlaybackManager


class TestPlaybackManager(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_music_streamer.db"
        self.db = DatabaseManager(self.db_path)
        self.playback = PlaybackManager(self.db)

    def tearDown(self):
        self.db.close()
        self.temp_dir.cleanup()

    def test_add_and_list_tracks(self):
        """Verify adding tracks and retrieving state."""
        t1 = self.playback.add_track("https://youtube.com/watch?v=1", "Song 1")
        t2 = self.playback.add_track("https://youtube.com/watch?v=2", "Song 2")

        state = self.playback.get_state()
        self.assertEqual(state["total_count"], 2)
        self.assertEqual(state["queued_count"], 2)
        self.assertEqual(state["played_count"], 0)
        self.assertEqual(state["playing_count"], 0)
        self.assertEqual(state["next"]["title"], "Song 1")

    def test_mark_playing_url(self):
        """Verify playing a track updates state and previously playing track becomes played."""
        t1 = self.playback.add_track("https://youtube.com/watch?v=1", "Song 1")
        t2 = self.playback.add_track("https://youtube.com/watch?v=2", "Song 2")

        self.playback.mark_playing_url(t1["url"], t1["title"])
        state = self.playback.get_state()
        self.assertEqual(state["playing_count"], 1)
        self.assertEqual(state["now_playing"]["url"], t1["url"])
        self.assertEqual(state["queued_count"], 1)

        # Switch to track 2
        self.playback.mark_playing_url(t2["url"], t2["title"])
        state = self.playback.get_state()
        self.assertEqual(state["played_count"], 1)
        self.assertEqual(state["playing_count"], 1)
        self.assertEqual(state["now_playing"]["url"], t2["url"])

        # Direct play of unlisted URL inserts it as playing
        self.playback.mark_playing_url("https://youtube.com/watch?v=3", "Song 3")
        state = self.playback.get_state()
        self.assertEqual(state["total_count"], 3)
        self.assertEqual(state["now_playing"]["url"], "https://youtube.com/watch?v=3")

    def test_get_next_track_progression(self):
        """Verify sequential progression through track list."""
        self.playback.add_track("https://youtube.com/watch?v=1", "Song 1")
        self.playback.add_track("https://youtube.com/watch?v=2", "Song 2")

        # First next track
        track, is_new_cycle = self.playback.get_next_track_for_playback(loop=False)
        self.assertIsNotNone(track)
        self.assertEqual(track["title"], "Song 1")
        self.assertFalse(is_new_cycle)

        # Second next track
        track, is_new_cycle = self.playback.get_next_track_for_playback(loop=False)
        self.assertIsNotNone(track)
        self.assertEqual(track["title"], "Song 2")
        self.assertFalse(is_new_cycle)

        # End of list with loop=False
        track, is_new_cycle = self.playback.get_next_track_for_playback(loop=False)
        self.assertIsNone(track)
        self.assertFalse(is_new_cycle)

    def test_loop_cycle_restart(self):
        """Verify that when loop=True, all tracks reset and replay when end of list is reached."""
        self.playback.add_track("https://youtube.com/watch?v=1", "Song 1")
        self.playback.add_track("https://youtube.com/watch?v=2", "Song 2")

        self.playback.get_next_track_for_playback(loop=True)  # Song 1
        self.playback.get_next_track_for_playback(loop=True)  # Song 2

        # Cycle restart
        track, is_new_cycle = self.playback.get_next_track_for_playback(loop=True)
        self.assertIsNotNone(track)
        self.assertEqual(track["title"], "Song 1")
        self.assertTrue(is_new_cycle)

    def test_fair_shuffling_and_loop_cycle(self):
        """Verify fair shuffling preserves played history and avoids repeated tracks on cycle loop."""
        for i in range(1, 6):
            self.playback.add_track(f"https://youtube.com/watch?v={i}", f"Song {i}")

        # Play first 2 tracks
        self.playback.get_next_track_for_playback()  # Song 1
        self.playback.get_next_track_for_playback()  # Song 2

        # Shuffle unplayed
        mode = self.playback.shuffle_unplayed_tracks()
        self.assertEqual(mode, "shuffled")

        state = self.playback.get_state()
        played = [t["title"] for t in state["played_tracks"]]
        # Played history remains unchanged
        self.assertEqual(played, ["Song 1"])
        self.assertEqual(state["now_playing"]["title"], "Song 2")

        # Finish remaining tracks in cycle
        prev_track_url = state["now_playing"]["url"]
        while True:
            nxt, is_new = self.playback.get_next_track_for_playback(loop=True)
            if is_new:
                # New cycle started! Check that the new first track is NOT the previous last track
                self.assertNotEqual(nxt["url"], prev_track_url)
                break
            prev_track_url = nxt["url"]

    def test_play_by_index_and_id(self):
        """Verify jumping directly to track by index or ID."""
        t1 = self.playback.add_track("https://youtube.com/watch?v=1", "Song 1")
        t2 = self.playback.add_track("https://youtube.com/watch?v=2", "Song 2")
        t3 = self.playback.add_track("https://youtube.com/watch?v=3", "Song 3")

        # Jump to index 2 (Song 3)
        played = self.playback.play_track_by_index(2)
        self.assertEqual(played["title"], "Song 3")
        self.assertEqual(self.playback.get_state()["now_playing"]["title"], "Song 3")

        # Jump by ID (Song 2)
        played2 = self.playback.play_track_by_id(t2["id"])
        self.assertEqual(played2["title"], "Song 2")
        self.assertEqual(self.playback.get_state()["now_playing"]["title"], "Song 2")

    def test_replay_shifting_order_and_played_status(self):
        """Verify that replaying a track marks currently playing song as played and shifts the replayed track to playing."""
        t1 = self.playback.add_track("https://youtube.com/watch?v=1", "Song 1")
        t2 = self.playback.add_track("https://youtube.com/watch?v=2", "Song 2")
        t3 = self.playback.add_track("https://youtube.com/watch?v=3", "Song 3")
        t4 = self.playback.add_track("https://youtube.com/watch?v=4", "Song 4")

        # 1. Play Song 1
        self.playback.play_track_by_id(t1["id"])
        state = self.playback.get_state()
        self.assertEqual(state["now_playing"]["title"], "Song 1")
        self.assertEqual(state["played_count"], 0)
        self.assertEqual(state["queued_count"], 3)

        # 2. Advance to Song 2 (Song 1 becomes played, Song 2 is playing)
        self.playback.play_track_by_id(t2["id"])
        state = self.playback.get_state()
        self.assertEqual(state["now_playing"]["title"], "Song 2")
        self.assertEqual(state["played_count"], 1)
        self.assertEqual(state["played_tracks"][0]["title"], "Song 1")
        self.assertEqual(state["queued_count"], 2)

        # 3. Advance to Song 3 (Song 1 and Song 2 are played, Song 3 is playing)
        self.playback.play_track_by_id(t3["id"])
        state = self.playback.get_state()
        self.assertEqual(state["now_playing"]["title"], "Song 3")
        self.assertEqual(state["played_count"], 2)
        self.assertEqual([t["title"] for t in state["played_tracks"]], ["Song 1", "Song 2"])
        self.assertEqual([t["title"] for t in state["queued_tracks"]], ["Song 4"])

        # 4. Now click REPLAY on Song 1 (which was in played history at index 0)
        # Expected:
        # - Song 3 (which was playing) becomes 'played'.
        # - Played tracks: [Song 2, Song 3].
        # - Now Playing: Song 1 (shifted to active playing position).
        # - Queued tracks: [Song 4].
        replayed = self.playback.play_track_by_id(t1["id"])
        self.assertEqual(replayed["title"], "Song 1")
        state = self.playback.get_state()
        self.assertEqual(state["now_playing"]["title"], "Song 1")
        self.assertEqual(state["played_count"], 2)
        self.assertEqual([t["title"] for t in state["played_tracks"]], ["Song 2", "Song 3"])
        self.assertEqual([t["title"] for t in state["queued_tracks"]], ["Song 4"])
        self.assertEqual([t["title"] for t in state["tracks"]], ["Song 2", "Song 3", "Song 1", "Song 4"])

    def test_remove_track(self):
        """Verify removing tracks by index or ID."""
        t1 = self.playback.add_track("https://youtube.com/watch?v=1", "Song 1")
        t2 = self.playback.add_track("https://youtube.com/watch?v=2", "Song 2")

        # Remove index 0
        self.assertTrue(self.playback.remove_track(0))
        state = self.playback.get_state()
        self.assertEqual(state["total_count"], 1)
        self.assertEqual(state["tracks"][0]["title"], "Song 2")

        # Remove by ID
        self.assertTrue(self.playback.remove_track(t2["id"]))
        self.assertEqual(self.playback.get_state()["total_count"], 0)

    def test_move_track(self):
        """Verify moving a track from one position to another in playback list."""
        t1 = self.playback.add_track("https://youtube.com/watch?v=1", "Song 1")
        t2 = self.playback.add_track("https://youtube.com/watch?v=2", "Song 2")
        t3 = self.playback.add_track("https://youtube.com/watch?v=3", "Song 3")
        t4 = self.playback.add_track("https://youtube.com/watch?v=4", "Song 4")

        # Move Song 4 (index 3) to position 0
        self.assertTrue(self.playback.move_track(3, 0))
        state = self.playback.get_state()
        titles = [t["title"] for t in state["tracks"]]
        self.assertEqual(titles, ["Song 4", "Song 1", "Song 2", "Song 3"])

        # Move Song 1 (index 1) to position 3 (end)
        self.assertTrue(self.playback.move_track(1, 3))
        state = self.playback.get_state()
        titles = [t["title"] for t in state["tracks"]]
        self.assertEqual(titles, ["Song 4", "Song 2", "Song 3", "Song 1"])

        # Move same index (no-op)
        self.assertTrue(self.playback.move_track(2, 2))

        # Invalid index returns False
        self.assertFalse(self.playback.move_track(10, 0))
        self.assertFalse(self.playback.move_track(0, -1))

    def test_move_track_locked_when_played(self):
        """Verify that played tracks cannot be moved and queued moves cannot precede played tracks."""
        t1 = self.playback.add_track("https://youtube.com/watch?v=1", "Song 1")
        t2 = self.playback.add_track("https://youtube.com/watch?v=2", "Song 2")
        t3 = self.playback.add_track("https://youtube.com/watch?v=3", "Song 3")

        # Mark Song 1 as played
        self.playback.db.update_track_status(t1["id"], "played")

        # Attempt to move played track Song 1 -> returns False
        self.assertFalse(self.playback.move_track(0, 1))
        self.assertFalse(self.playback.move_track(0, 2))

        # Move Song 3 (index 2) to index 0 -> clamped to index 1 (after played Song 1)
        self.assertTrue(self.playback.move_track(2, 0))
        state = self.playback.get_state()
        titles = [t["title"] for t in state["tracks"]]
        self.assertEqual(titles, ["Song 1", "Song 3", "Song 2"])
        self.assertEqual(state["tracks"][0]["status"], "played")

    def test_reorder_queued_tracks_slice(self):
        """Verify reordering only the queued tracks slice while leaving played tracks intact."""
        t1 = self.playback.add_track("https://youtube.com/watch?v=1", "Song 1")
        t2 = self.playback.add_track("https://youtube.com/watch?v=2", "Song 2")
        t3 = self.playback.add_track("https://youtube.com/watch?v=3", "Song 3")

        # Mark Song 1 as played
        self.playback.db.update_track_status(t1["id"], "played")

        # Reorder queued slice [t3, t2]
        self.assertTrue(self.playback.reorder_tracks([t3["id"], t2["id"]]))
        state = self.playback.get_state()
        titles = [t["title"] for t in state["tracks"]]
        self.assertEqual(titles, ["Song 1", "Song 3", "Song 2"])

    def test_reorder_tracks_by_ids(self):
        """Verify reordering tracks with a full list of track IDs."""
        t1 = self.playback.add_track("https://youtube.com/watch?v=1", "Song 1")
        t2 = self.playback.add_track("https://youtube.com/watch?v=2", "Song 2")
        t3 = self.playback.add_track("https://youtube.com/watch?v=3", "Song 3")

        # Reorder to [t3, t1, t2]
        self.assertTrue(self.playback.reorder_tracks([t3["id"], t1["id"], t2["id"]]))
        state = self.playback.get_state()
        titles = [t["title"] for t in state["tracks"]]
        self.assertEqual(titles, ["Song 3", "Song 1", "Song 2"])

        # Invalid IDs or mismatched count returns False
        self.assertFalse(self.playback.reorder_tracks([t3["id"], t1["id"]]))
        self.assertFalse(self.playback.reorder_tracks([t3["id"], t1["id"], "invalid_id"]))

    def test_reorder_by_indices(self):
        """Verify reordering tracks using 0-based index list permutation."""
        t1 = self.playback.add_track("https://youtube.com/watch?v=1", "Song 1")
        t2 = self.playback.add_track("https://youtube.com/watch?v=2", "Song 2")
        t3 = self.playback.add_track("https://youtube.com/watch?v=3", "Song 3")

        # [2, 0, 1] -> Song 3, Song 1, Song 2
        self.assertTrue(self.playback.reorder_by_indices([2, 0, 1]))
        state = self.playback.get_state()
        titles = [t["title"] for t in state["tracks"]]
        self.assertEqual(titles, ["Song 3", "Song 1", "Song 2"])

        # Invalid indices
        self.assertFalse(self.playback.reorder_by_indices([0, 0, 1]))
        self.assertFalse(self.playback.reorder_by_indices([0, 1]))

    def test_reset_history_and_clear_all(self):
        """Verify reset_history resets played tracks and clear_all empties list."""
        self.playback.add_track("https://youtube.com/watch?v=1", "Song 1")
        self.playback.get_next_track_for_playback()  # mark playing
        self.playback.mark_current_finished()        # mark played

        self.assertEqual(self.playback.get_state()["played_count"], 1)
        self.playback.reset_history()
        self.assertEqual(self.playback.get_state()["queued_count"], 1)

        self.playback.clear_all()
        self.assertEqual(self.playback.get_state()["total_count"], 0)

    def test_add_track_auto_fetches_title(self):
        """Verify add_track extracts real media title if only URL is passed."""
        from unittest.mock import patch

        with patch("music_streamer.search.fetch_track_metadata") as mock_fetch:
            mock_fetch.return_value = {
                "title": "Denny Caknan - Wirang",
                "thumbnail": "https://i.ytimg.com/vi/78Y0SxVVxP4/hqdefault.jpg",
                "url": "https://www.youtube.com/watch?v=78Y0SxVVxP4",
            }
            t = self.playback.add_track("https://www.youtube.com/watch?v=78Y0SxVVxP4")
            self.assertEqual(t["title"], "Denny Caknan - Wirang")
            self.assertEqual(t["thumbnail"], "https://i.ytimg.com/vi/78Y0SxVVxP4/hqdefault.jpg")
    def test_get_previous_track_progression(self):
        """Verify moving backwards through track history."""
        self.playback.add_track("https://youtube.com/watch?v=1", "Song 1")
        self.playback.add_track("https://youtube.com/watch?v=2", "Song 2")
        self.playback.add_track("https://youtube.com/watch?v=3", "Song 3")

        # Progress to Song 1, then Song 2, then Song 3
        self.playback.get_next_track_for_playback(loop=False)  # Song 1
        self.playback.get_next_track_for_playback(loop=False)  # Song 2
        t3, _ = self.playback.get_next_track_for_playback(loop=False)  # Song 3
        self.assertEqual(t3["title"], "Song 3")

        state = self.playback.get_state()
        self.assertEqual(state["played_count"], 2)  # Song 1, Song 2
        self.assertEqual(state["now_playing"]["title"], "Song 3")

        # Step back to Song 2
        t2, is_cycle = self.playback.get_previous_track_for_playback(loop=False)
        self.assertIsNotNone(t2)
        self.assertEqual(t2["title"], "Song 2")
        self.assertFalse(is_cycle)
        self.assertEqual(self.playback.get_state()["now_playing"]["title"], "Song 2")

        # Step back to Song 1
        t1, is_cycle = self.playback.get_previous_track_for_playback(loop=False)
        self.assertIsNotNone(t1)
        self.assertEqual(t1["title"], "Song 1")
        self.assertFalse(is_cycle)
        self.assertEqual(self.playback.get_state()["now_playing"]["title"], "Song 1")

    def test_previous_track_loop_cycle(self):
        """Verify previous track wraps to end of list when at start and loop=True."""
        self.playback.add_track("https://youtube.com/watch?v=1", "Song 1")
        self.playback.add_track("https://youtube.com/watch?v=2", "Song 2")
        self.playback.add_track("https://youtube.com/watch?v=3", "Song 3")

        # Play first track (Song 1)
        t1, _ = self.playback.get_next_track_for_playback(loop=True)
        self.assertEqual(t1["title"], "Song 1")

        # Previous with loop=True wraps around to last track (Song 3)
        t_last, is_cycle = self.playback.get_previous_track_for_playback(loop=True)
        self.assertIsNotNone(t_last)
        self.assertEqual(t_last["title"], "Song 3")
        self.assertTrue(is_cycle)

    def test_add_duplicate_track_flag(self):
        """Verify adding track with existing URL returns already_exists=True without duplicate entries."""
        t1 = self.playback.add_track("https://youtube.com/watch?v=dup123", "Song Dup")
        self.assertFalse(t1.get("already_exists", False))
        self.assertEqual(self.playback.get_state()["total_count"], 1)

        t2 = self.playback.add_track("https://youtube.com/watch?v=dup123", "Song Dup")
        self.assertTrue(t2.get("already_exists", False))
        self.assertEqual(self.playback.get_state()["total_count"], 1)

    def test_all_played_restart_on_play_command(self):
        """Verify that when all tracks have finished playing and user plays, playback resets and starts from track 1."""
        self.playback.add_track("https://youtube.com/watch?v=1", "Song 1")
        self.playback.add_track("https://youtube.com/watch?v=2", "Song 2")
        self.playback.add_track("https://youtube.com/watch?v=3", "Song 3")

        # Play all 3 tracks to completion
        self.playback.get_next_track_for_playback(loop=False)  # Song 1 playing
        self.playback.get_next_track_for_playback(loop=False)  # Song 2 playing
        self.playback.get_next_track_for_playback(loop=False)  # Song 3 playing
        self.playback.mark_current_finished()                  # Song 3 played

        state = self.playback.get_state()
        self.assertEqual(state["played_count"], 3)
        self.assertEqual(state["queued_count"], 0)
        self.assertEqual(state["playing_count"], 0)

        # User clicks Play: allow_restart=True resets track history and plays from Song 1
        restarted_track, is_new = self.playback.get_next_track_for_playback(loop=False, allow_restart=True)
        self.assertIsNotNone(restarted_track)
        self.assertEqual(restarted_track["title"], "Song 1")
        self.assertTrue(is_new)

        new_state = self.playback.get_state()
        self.assertEqual(new_state["playing_count"], 1)
        self.assertEqual(new_state["now_playing"]["title"], "Song 1")
        self.assertEqual(new_state["queued_count"], 2)


if __name__ == "__main__":
    unittest.main()
