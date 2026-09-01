"""Unit tests for IPC, WebSocket, and HTTP Server helpers in music_streamer.ipc and music_streamer.server."""

import io
import json
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path

from music_streamer.db import DatabaseManager
from music_streamer.engine import AudioEngine, Broadcaster
from music_streamer.ipc import send_ipc_command
from music_streamer.server import (
    WebSocketHub,
    build_server_status,
    calc_ws_accept,
    read_ws_frame,
    run_unix_socket_listener,
    send_ws_text,
)


class TestIPCAndServer(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_music_streamer.db"
        self.sock_path = Path(self.temp_dir.name) / "control.sock"
        self.db = DatabaseManager(self.db_path)
        self.broadcaster = Broadcaster()
        self.engine = AudioEngine(self.db, self.broadcaster)

    def tearDown(self):
        self.engine.running = False
        self.db.close()
        self.temp_dir.cleanup()

    def test_websocket_accept_hash(self):
        """Verify RFC 6455 Sec-WebSocket-Accept computation."""
        # Known test vector from RFC 6455
        test_key = "dGhlIHNhbXBsZSBub25jZQ=="
        expected_accept = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        self.assertEqual(calc_ws_accept(test_key), expected_accept)

    def test_websocket_frame_encode_decode(self):
        """Verify WebSocket text frame encoding and decoding."""
        test_payload = json.dumps({"action": "status", "test": True})
        buf = io.BytesIO()
        send_ws_text(buf, test_payload)
        buf.seek(0)

        # Decode unmasked server frame
        b1 = buf.read(1)
        self.assertEqual(b1[0] & 0x0F, 0x1)  # Opcode 1 (Text)
        b2 = buf.read(1)
        length = b2[0] & 0x7F
        content = buf.read(length).decode("utf-8")
        self.assertEqual(content, test_payload)

    def test_unix_socket_ipc_synchronous(self):
        """Verify synchronous Unix domain socket command dispatch and response."""
        # Start socket listener thread
        listener_thread = threading.Thread(
            target=run_unix_socket_listener,
            args=(self.engine, str(self.sock_path)),
            daemon=True,
        )
        listener_thread.start()
        time.sleep(0.1)

        # Send command
        response = send_ipc_command({"action": "set_volume", "volume": 70}, socket_path=str(self.sock_path))
        self.assertTrue(response.get("success"))
        self.assertEqual(response.get("data", {}).get("status"), "ok")

        # Process command on engine
        self.engine._process_commands()
        self.assertEqual(self.engine.volume, 70)

    def test_build_server_status(self):
        """Verify unified server status dictionary structure."""
        status = build_server_status(self.db, self.engine, self.broadcaster, host_header="localhost:8000")
        self.assertEqual(status["server"], "music-streamer")
        self.assertEqual(status["state"], "stopped")
        self.assertIn("security", status)
        self.assertIn("playback", status)
        self.assertIn("now_playing", status)
        self.assertEqual(status["stream_url"], "http://localhost:8000/stream.mp3")

    def test_websocket_binary_frame_encode_decode(self):
        """Verify WebSocket binary frame encoding (Opcode 0x2) for PCM chunks."""
        from music_streamer.server import send_ws_binary
        test_pcm = b"\x01\x02\x03\x04" * 100
        buf = io.BytesIO()
        send_ws_binary(buf, test_pcm)
        buf.seek(0)

        # Decode unmasked server binary frame
        b1 = buf.read(1)
        self.assertEqual(b1[0] & 0x0F, 0x2)  # Opcode 2 (Binary)
        b2 = buf.read(1)
        length = b2[0] & 0x7F
        if length == 126:
            data2 = buf.read(2)
            length = int.from_bytes(data2, byteorder="big")
        content = buf.read(length)
        self.assertEqual(content, test_pcm)

    def test_websocket_hub_audio_broadcast(self):
        """Verify WebSocketHub broadcasts binary PCM audio chunks only to subscribed clients."""
        from music_streamer.server import WebSocketHub
        from unittest.mock import MagicMock
        hub = WebSocketHub.__new__(WebSocketHub)
        mock_sec = MagicMock()
        mock_sec.is_enabled.return_value = False
        hub.server = type("MockServer", (), {"security": mock_sec})()
        hub.clients = {}
        hub.lock = threading.Lock()
        hub.running = False

        buf1 = io.BytesIO()
        buf2 = io.BytesIO()
        hub.clients[buf1] = {"host_header": "localhost:8000", "role": "admin", "audio_subscribed": True}
        hub.clients[buf2] = {"host_header": "localhost:8000", "role": "admin", "audio_subscribed": False}

        test_chunk = b"\x10\x20\x30\x40" * 50
        hub.broadcast_audio_chunk(test_chunk)

        # Subscribed client received binary frame
        buf1.seek(0)
        b1 = buf1.read(1)
        self.assertEqual(b1[0] & 0x0F, 0x2)

        # Unsubscribed client received nothing
        buf2.seek(0)
        self.assertEqual(buf2.read(), b"")


if __name__ == "__main__":
    unittest.main()
