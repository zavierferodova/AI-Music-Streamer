"""Unit tests for AudioEngine & Broadcaster in music_streamer.engine."""

import queue
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from music_streamer.config import CHUNK_BYTES, SAMPLE_RATE, SILENCE_CHUNK
from music_streamer.db import DatabaseManager
from music_streamer.engine import AudioEngine, Broadcaster, get_thumbnail_for_url


class TestEngine(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_music_streamer.db"
        self.db = DatabaseManager(self.db_path)
        self.broadcaster = Broadcaster(max_buffer_bytes=1024)

    def tearDown(self):
        self.db.close()
        self.temp_dir.cleanup()

    def test_broadcaster_subscribe_and_fanout(self):
        """Verify broadcaster distributes data to all subscribed client queues."""
        q1 = self.broadcaster.subscribe()
        q2 = self.broadcaster.subscribe()
        self.assertEqual(self.broadcaster.client_count(), 2)

        data = b"test_audio_mp3_chunk"
        self.broadcaster.broadcast(data)

        self.assertEqual(q1.get_nowait(), data)
        self.assertEqual(q2.get_nowait(), data)

        self.broadcaster.unsubscribe(q1)
        self.assertEqual(self.broadcaster.client_count(), 1)

        data2 = b"chunk_2"
        self.broadcaster.broadcast(data2)
        self.assertEqual(q2.get_nowait(), data2)
        self.assertTrue(q1.empty())

    def test_broadcaster_recent_buffer(self):
        """Verify new subscribers receive recently buffered stream data."""
        self.broadcaster.broadcast(b"initial_header")
        q = self.broadcaster.subscribe()
        self.assertEqual(q.get_nowait(), b"initial_header")

    def test_get_thumbnail_for_url(self):
        """Verify YouTube thumbnail URL extraction."""
        url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        thumb = get_thumbnail_for_url(url)
        self.assertEqual(thumb, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg")

        url_short = "https://youtu.be/dQw4w9WgXcQ"
        self.assertEqual(get_thumbnail_for_url(url_short), "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg")

        self.assertEqual(get_thumbnail_for_url(""), "")

    def test_audio_constants(self):
        """Verify CD quality PCM audio chunk sizes."""
        self.assertEqual(SAMPLE_RATE, 44100)
        self.assertEqual(CHUNK_BYTES, 8820)
        self.assertEqual(len(SILENCE_CHUNK), 8820)
        self.assertEqual(set(SILENCE_CHUNK), {0})

    def test_audio_engine_initialization(self):
        """Verify AudioEngine loads settings from DB and handles commands."""
        engine = AudioEngine(self.db, self.broadcaster, mode="silent")
        self.assertEqual(engine.state, "stopped")
        self.assertEqual(engine.mode, "silent")

        # Test command queueing
        engine.post_command({"action": "set_mode", "mode": "speaker"})
        engine._process_commands()
        self.assertEqual(engine.mode, "speaker")
        self.assertEqual(self.db.get_setting("mode"), "speaker")

        engine.post_command({"action": "set_volume", "volume": 65})
        engine._process_commands()
        self.assertEqual(engine.volume, 65)
        self.assertEqual(self.db.get_int_setting("volume"), 65)

        engine.post_command({"action": "set_loop", "loop": "no"})
        engine._process_commands()
        self.assertEqual(engine.loop, "no")
        self.assertEqual(self.db.get_setting("loop"), "no")


if __name__ == "__main__":
    unittest.main()
