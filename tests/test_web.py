"""
Integration and Unit tests for Web Control Panel, HTTP Handlers, REST API, Static Assets, WebSocket, and Dual-Role OTP Security.
"""

import http.client
import json
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlencode

from music_streamer.config import WS_GUID
from music_streamer.db import DatabaseManager
from music_streamer.engine import AudioEngine, Broadcaster
from music_streamer.playback import PlaybackManager
from music_streamer.security import OTPManager
from music_streamer.server import (
    StreamRequestHandler,
    ThreadedStreamServer,
    calc_ws_accept,
    read_ws_frame,
    send_ws_text,
)


class TestWebServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.db_path = Path(cls.temp_dir.name) / "test_music_streamer.db"
        cls.db = DatabaseManager(cls.db_path)
        cls.broadcaster = Broadcaster()
        cls.engine = AudioEngine(cls.db, cls.broadcaster)
        cls.security = OTPManager(cls.db)
        cls.playback_mgr = PlaybackManager(cls.db)

        # Bind to ephemeral port
        cls.server = ThreadedStreamServer(
            ("127.0.0.1", 0),
            StreamRequestHandler,
            cls.engine,
            cls.broadcaster,
            cls.db,
        )
        cls.port = cls.server.server_address[1]
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.engine.running = False
        cls.db.close()
        cls.temp_dir.cleanup()

    def setUp(self):
        self.playback_mgr.clear_all()

    def _get_connection(self) -> http.client.HTTPConnection:
        return http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)

    def test_get_root_html(self):
        """Verify GET / serves the Web Control Panel HTML."""
        conn = self._get_connection()
        conn.request("GET", "/")
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.assertIn("text/html", resp.getheader("Content-Type", ""))
        body = resp.read().decode("utf-8")
        self.assertIn("<title>Music Streamer", body)
        self.assertIn("Music Streamer", body)
        conn.close()

    def test_get_root_with_otp_sets_cookie(self):
        """Verify GET /?otp=... verifies OTP and sets session cookie."""
        otp = self.security.get_admin_otp()
        conn = self._get_connection()
        conn.request("GET", f"/?otp={otp}")
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        cookie = resp.getheader("Set-Cookie", "")
        self.assertIn("music_session=", cookie)
        conn.close()

    def test_get_static_assets(self):
        """Verify serving CSS and JS static assets with correct MIME types."""
        conn = self._get_connection()

        web_out = Path(__file__).resolve().parent.parent / "web" / "out"
        css_files = list(web_out.rglob("*.css")) if web_out.exists() else []
        js_files = list(web_out.rglob("*.js")) if web_out.exists() else []

        if css_files:
            css_rel = "/" + css_files[0].relative_to(web_out).as_posix()
            conn.request("GET", css_rel)
            resp_css = conn.getresponse()
            self.assertEqual(resp_css.status, 200)
            self.assertIn("text/css", resp_css.getheader("Content-Type", ""))
            self.assertTrue(len(resp_css.read()) > 0)

        if js_files:
            js_rel = "/" + js_files[0].relative_to(web_out).as_posix()
            conn.request("GET", js_rel)
            resp_js = conn.getresponse()
            self.assertEqual(resp_js.status, 200)
            self.assertIn("application/javascript", resp_js.getheader("Content-Type", ""))
            self.assertTrue(len(resp_js.read()) > 0)

        conn.close()

    def test_static_not_found_and_path_traversal(self):
        """Verify 404 for missing files and path traversal attempts."""
        conn = self._get_connection()

        conn.request("GET", "/nonexistent_file.txt")
        resp = conn.getresponse()
        self.assertEqual(resp.status, 404)
        resp.read()

        conn.request("GET", "/../music_streamer/db.py")
        resp_traversal = conn.getresponse()
        self.assertEqual(resp_traversal.status, 404)
        resp_traversal.read()

        conn.close()

    def test_get_status_json_admin_vs_subscriber(self):
        """Verify GET /status includes playlists for admin but hides playlists for subscriber."""
        # Create a playlist in DB first
        self.db.create_playlist("Secret Playlist")

        admin_otp = self.security.get_admin_otp()
        _, admin_token, _ = self.security.verify_otp(admin_otp, client_ip="127.0.0.1")

        sub_otp = self.security.get_subscriber_otp()
        _, sub_token, _ = self.security.verify_otp(sub_otp, client_ip="127.0.0.1")

        conn = self._get_connection()

        # 1. Admin status: playlists present
        conn.request("GET", "/status", headers={"Authorization": f"Bearer {admin_token}"})
        resp_admin = conn.getresponse()
        self.assertEqual(resp_admin.status, 200)
        data_admin = json.loads(resp_admin.read().decode("utf-8"))
        self.assertEqual(data_admin["role"], "admin")
        self.assertTrue(len(data_admin["playlists"]) > 0)

        # 2. Subscriber status: playlists empty / hidden
        conn.request("GET", "/status", headers={"Authorization": f"Bearer {sub_token}"})
        resp_sub = conn.getresponse()
        self.assertEqual(resp_sub.status, 200)
        data_sub = json.loads(resp_sub.read().decode("utf-8"))
        self.assertEqual(data_sub["role"], "subscriber")
        self.assertEqual(data_sub["playlists"], [])

        conn.close()

    def test_api_auth_lifecycle_dual_otp(self):
        """Verify /api/auth/verify and /api/auth/status for Admin and Subscriber OTPs."""
        conn = self._get_connection()

        # 1. Initial auth status (unauthenticated)
        conn.request("GET", "/api/auth/status")
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        data = json.loads(resp.read().decode("utf-8"))
        self.assertTrue(data["security_enabled"])
        self.assertFalse(data["authenticated"])
        self.assertIsNone(data["role"])

        # 2. Invalid OTP verification
        conn.request(
            "POST",
            "/api/auth/verify",
            body=json.dumps({"otp": "000000"}),
            headers={"Content-Type": "application/json"},
        )
        resp_bad = conn.getresponse()
        self.assertEqual(resp_bad.status, 403)
        data_bad = json.loads(resp_bad.read().decode("utf-8"))
        self.assertFalse(data_bad["authenticated"])

        # 3. Admin OTP verification -> role: "admin"
        admin_otp = self.security.get_admin_otp()
        conn.request(
            "POST",
            "/api/auth/verify",
            body=json.dumps({"otp": admin_otp}),
            headers={"Content-Type": "application/json"},
        )
        resp_admin = conn.getresponse()
        self.assertEqual(resp_admin.status, 200)
        data_admin = json.loads(resp_admin.read().decode("utf-8"))
        self.assertTrue(data_admin["authenticated"])
        self.assertEqual(data_admin["role"], "admin")
        admin_token = data_admin["token"]

        # 4. Subscriber OTP verification -> role: "subscriber"
        sub_otp = self.security.get_subscriber_otp()
        conn.request(
            "POST",
            "/api/auth/verify",
            body=json.dumps({"otp": sub_otp}),
            headers={"Content-Type": "application/json"},
        )
        resp_sub = conn.getresponse()
        self.assertEqual(resp_sub.status, 200)
        data_sub = json.loads(resp_sub.read().decode("utf-8"))
        self.assertTrue(data_sub["authenticated"])
        self.assertEqual(data_sub["role"], "subscriber")
        sub_token = data_sub["token"]

        # 5. Check auth status with Admin token
        conn.request("GET", "/api/auth/status", headers={"Authorization": f"Bearer {admin_token}"})
        resp_chk_admin = conn.getresponse()
        self.assertEqual(resp_chk_admin.status, 200)
        data_chk_admin = json.loads(resp_chk_admin.read().decode("utf-8"))
        self.assertTrue(data_chk_admin["authenticated"])
        self.assertEqual(data_chk_admin["role"], "admin")

        # 6. Check auth status with Subscriber token
        conn.request("GET", "/api/auth/status", headers={"Authorization": f"Bearer {sub_token}"})
        resp_chk_sub = conn.getresponse()
        self.assertEqual(resp_chk_sub.status, 200)
        data_chk_sub = json.loads(resp_chk_sub.read().decode("utf-8"))
        self.assertTrue(data_chk_sub["authenticated"])
        self.assertEqual(data_chk_sub["role"], "subscriber")

        conn.close()

    def test_subscriber_permissions_and_restrictions(self):
        """Verify subscriber can stream audio but is strictly forbidden from controlling playback or viewing playlists."""
        sub_otp = self.security.get_subscriber_otp()
        _, sub_token, _ = self.security.verify_otp(sub_otp, client_ip="127.0.0.1")
        sub_header = {"Authorization": f"Bearer {sub_token}", "Content-Type": "application/json"}

        conn = self._get_connection()

        # 1. Subscriber CAN stream audio (/stream.mp3)
        conn.request("HEAD", "/stream.mp3", headers={"Authorization": f"Bearer {sub_token}"})
        resp_stream = conn.getresponse()
        self.assertEqual(resp_stream.status, 200)
        self.assertEqual(resp_stream.getheader("Content-Type"), "audio/mpeg")

        # 2. Subscriber CANNOT access /api/playlists
        conn.request("GET", "/api/playlists", headers=sub_header)
        resp_pls = conn.getresponse()
        self.assertEqual(resp_pls.status, 403)
        resp_pls.read()

        # 3. Subscriber CANNOT access /api/playlist
        conn.request("GET", "/api/playlist?name=Default", headers=sub_header)
        resp_pl = conn.getresponse()
        self.assertEqual(resp_pl.status, 403)
        resp_pl.read()

        # 4. Subscriber CANNOT control playback (POST /api/pause, /api/play, etc.)
        conn.request("POST", "/api/pause", body=json.dumps({}), headers=sub_header)
        resp_pause = conn.getresponse()
        self.assertEqual(resp_pause.status, 403)
        resp_pause.read()

        conn.request("POST", "/api/play", body=json.dumps({"url": "https://youtube.com/watch?v=123"}), headers=sub_header)
        resp_play = conn.getresponse()
        self.assertEqual(resp_play.status, 403)
        resp_play.read()

        conn.request("POST", "/api/volume", body=json.dumps({"volume": 50}), headers=sub_header)
        resp_vol = conn.getresponse()
        self.assertEqual(resp_vol.status, 403)
        resp_vol.read()

        conn.close()

    def test_admin_protected_api_actions(self):
        """Verify REST API playback control endpoints with Admin session authentication."""
        admin_otp = self.security.get_admin_otp()
        _, token, _ = self.security.verify_otp(admin_otp, client_ip="127.0.0.1")
        auth_header = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        conn = self._get_connection()

        # POST /api/pause
        conn.request("POST", "/api/pause", body=json.dumps({}), headers=auth_header)
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.assertEqual(json.loads(resp.read().decode("utf-8"))["status"], "ok")

        # POST /api/resume
        conn.request("POST", "/api/resume", body=json.dumps({}), headers=auth_header)
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.assertEqual(json.loads(resp.read().decode("utf-8"))["status"], "ok")

        # POST /api/volume
        conn.request("POST", "/api/volume", body=json.dumps({"volume": 65}), headers=auth_header)
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.assertEqual(json.loads(resp.read().decode("utf-8"))["volume"], 65)

        # POST /api/loop
        conn.request("POST", "/api/loop", body=json.dumps({"loop": "repeat-one"}), headers=auth_header)
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.assertEqual(json.loads(resp.read().decode("utf-8"))["loop"], "repeat-one")

        # POST /api/mode
        conn.request("POST", "/api/mode", body=json.dumps({"mode": "speaker"}), headers=auth_header)
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.assertEqual(json.loads(resp.read().decode("utf-8"))["mode"], "speaker")

        # POST /api/playback/add (add 2 tracks)
        conn.request(
            "POST",
            "/api/playback/add",
            body=json.dumps({"url": "https://youtube.com/watch?v=abc1", "title": "Song 1"}),
            headers=auth_header,
        )
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        resp.read()

        conn.request(
            "POST",
            "/api/playback/add",
            body=json.dumps({"url": "https://youtube.com/watch?v=abc2", "title": "Song 2"}),
            headers=auth_header,
        )
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        resp.read()

        # POST /api/playback/move (move Song 2 from index 1 to 0)
        conn.request(
            "POST",
            "/api/playback/move",
            body=json.dumps({"from_index": 1, "to_index": 0}),
            headers=auth_header,
        )
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.assertTrue(json.loads(resp.read().decode("utf-8"))["moved"])

        # POST /api/playback/reorder
        conn.request(
            "POST",
            "/api/playback/reorder",
            body=json.dumps({"indices": [1, 0]}),
            headers=auth_header,
        )
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.assertTrue(json.loads(resp.read().decode("utf-8"))["reordered"])

        # POST /api/playback/shuffle
        conn.request("POST", "/api/playback/shuffle", body=json.dumps({}), headers=auth_header)
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.assertEqual(json.loads(resp.read().decode("utf-8"))["mode"], "shuffled")

        # POST /api/playback/clear
        conn.request("POST", "/api/playback/clear", body=json.dumps({}), headers=auth_header)
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        resp.read()

        conn.close()

    def test_playlist_rest_api_lifecycle(self):
        """Verify REST API lifecycle for playlists with Admin authentication."""
        admin_otp = self.security.get_admin_otp()
        _, token, _ = self.security.verify_otp(admin_otp, client_ip="127.0.0.1")
        auth_header = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        conn = self._get_connection()

        # 1. Create two playlists
        conn.request("POST", "/api/playlist/create", body=json.dumps({"name": "Chill Lounge"}), headers=auth_header)
        resp1 = conn.getresponse()
        self.assertEqual(resp1.status, 200)
        self.assertEqual(json.loads(resp1.read().decode("utf-8"))["playlist"]["name"], "Chill Lounge")

        conn.request("POST", "/api/playlist/create", body=json.dumps({"name": "Workout Mix"}), headers=auth_header)
        resp2 = conn.getresponse()
        self.assertEqual(resp2.status, 200)
        resp2.read()

        # 2. Add track to "Chill Lounge"
        conn.request(
            "POST",
            "/api/playlist/add",
            body=json.dumps({"playlist": "Chill Lounge", "url": "https://youtube.com/watch?v=chill1", "title": "Chill Song 1"}),
            headers=auth_header,
        )
        resp_add = conn.getresponse()
        self.assertEqual(resp_add.status, 200)
        resp_add.read()

        # 3. GET /api/playlists (Admin)
        conn.request("GET", "/api/playlists", headers=auth_header)
        resp_list = conn.getresponse()
        self.assertEqual(resp_list.status, 200)
        data_list = json.loads(resp_list.read().decode("utf-8"))
        self.assertTrue(len(data_list["playlists"]) >= 2)

        # 4. GET /api/playlist?name=Chill%20Lounge (Admin)
        conn.request("GET", "/api/playlist?name=Chill%20Lounge", headers=auth_header)
        resp_single = conn.getresponse()
        self.assertEqual(resp_single.status, 200)
        data_single = json.loads(resp_single.read().decode("utf-8"))
        self.assertEqual(data_single["playlist"]["name"], "Chill Lounge")
        self.assertEqual(data_single["playlist"]["track_count"], 1)

        # 5. Rename playlist
        conn.request(
            "POST",
            "/api/playlist/rename",
            body=json.dumps({"playlist": "Chill Lounge", "new_name": "Ultra Chill"}),
            headers=auth_header,
        )
        resp_rename = conn.getresponse()
        self.assertEqual(resp_rename.status, 200)
        self.assertEqual(json.loads(resp_rename.read().decode("utf-8"))["playlist"]["name"], "Ultra Chill")

        # 6. Play playlist
        conn.request("POST", "/api/playlist/play", body=json.dumps({"playlist": "Ultra Chill"}), headers=auth_header)
        resp_play = conn.getresponse()
        self.assertEqual(resp_play.status, 200)
        self.assertTrue(json.loads(resp_play.read().decode("utf-8"))["success"])

        # 7. Delete playlist
        conn.request("POST", "/api/playlist/delete", body=json.dumps({"name": "Workout Mix"}), headers=auth_header)
        resp_del = conn.getresponse()
        self.assertEqual(resp_del.status, 200)
        self.assertTrue(json.loads(resp_del.read().decode("utf-8"))["deleted"])

        conn.close()

    def test_websocket_handshake_and_message_flow(self):
        """Verify /ws WebSocket protocol handshake, initial state frame, and ping."""
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.connect(("127.0.0.1", self.port))

        sec_key = "x3JJHMbDL1EzLkh9GBhXDw=="
        req = (
            f"GET /ws HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{self.port}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {sec_key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n"
        )
        s.sendall(req.encode("utf-8"))
        rfile = s.makefile("rb", buffering=0)
        while True:
            line = rfile.readline().decode("utf-8")
            if not line or line == "\r\n":
                break

        # Read initial server text frame
        opcode, payload = read_ws_frame(rfile)
        self.assertEqual(opcode, 0x1)  # Text frame
        status_data = json.loads(payload.decode("utf-8"))
        self.assertEqual(status_data["server"], "music-streamer")

        # Close websocket cleanly
        s.close()

    def test_websocket_audio_streaming_subscription(self):
        """Verify WebSocket client can subscribe to audio and receive binary audio chunks."""
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.connect(("127.0.0.1", self.port))

        sec_key = "dGhlIHNhbXBsZSBub25jZQ=="
        sub_otp = self.security.get_subscriber_otp()
        req = (
            f"GET /ws?otp={sub_otp} HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{self.port}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {sec_key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n"
        )
        s.sendall(req.encode("utf-8"))
        rfile = s.makefile("rb", buffering=0)
        while True:
            line = rfile.readline().decode("utf-8")
            if not line or line == "\r\n":
                break

        # Read initial status frame
        opcode, _ = read_ws_frame(rfile)
        self.assertEqual(opcode, 0x1)

        # Send masked subscribe_audio command from client
        send_ws_text(s, json.dumps({"action": "subscribe_audio"}), masked=True)
        # Wait until server has registered audio subscription
        for _ in range(20):
            if self.server.ws_hub.listener_count() > 0:
                break
            time.sleep(0.05)

        # Broadcast test binary chunk
        test_pcm = b"\x00\x05\x00\x05" * 100
        self.server.ws_hub.broadcast_audio_chunk(test_pcm)

        # Read until binary frame (skipping any interim ticker status frames)
        received_binary = False
        for _ in range(10):
            opcode, payload = read_ws_frame(rfile)
            if opcode == 0x2:
                received_binary = True
                self.assertEqual(payload, test_pcm)
                break
        self.assertTrue(received_binary)

        s.close()

    def test_api_seek_and_progress_duration(self):
        """Verify POST /api/seek and duration_seconds in status response."""
        admin_otp = self.security.get_admin_otp()
        conn = self._get_connection()

        # Check status contains duration_seconds and elapsed_seconds
        conn.request("GET", f"/api/status?otp={admin_otp}")
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        data = json.loads(resp.read().decode("utf-8"))
        self.assertIn("now_playing", data)
        self.assertIn("duration_seconds", data["now_playing"])
        self.assertIn("elapsed_seconds", data["now_playing"])

        # Test POST /api/seek with admin OTP
        with patch.object(self.engine, "post_command") as mock_cmd:
            conn.request(
                "POST",
                f"/api/seek?otp={admin_otp}",
                body=json.dumps({"seconds": 120}),
                headers={"Content-Type": "application/json"},
            )
            resp_seek = conn.getresponse()
            self.assertEqual(resp_seek.status, 200)
            mock_cmd.assert_called_with({"action": "seek", "seconds": 120.0})

        # Test POST /api/seek with relative delta
        with patch.object(self.engine, "post_command") as mock_cmd:
            conn.request(
                "POST",
                f"/api/seek?otp={admin_otp}",
                body=json.dumps({"delta": -15}),
                headers={"Content-Type": "application/json"},
            )
            resp_seek = conn.getresponse()
            self.assertEqual(resp_seek.status, 200)
            mock_cmd.assert_called_with({"action": "seek_relative", "delta": -15.0})

        # Test subscriber cannot seek (Forbidden 403)
        sub_otp = self.security.get_subscriber_otp()
        conn.request(
            "POST",
            f"/api/seek?otp={sub_otp}",
            body=json.dumps({"seconds": 60}),
            headers={"Content-Type": "application/json"},
        )
        resp_sub = conn.getresponse()
        self.assertEqual(resp_sub.status, 403)

        conn.close()

    def test_admin_playback_add_custom_order(self):
        """Verify REST API /api/playback/add supports order, after, before, and position."""
        admin_otp = self.security.get_admin_otp()
        _, token, _ = self.security.verify_otp(admin_otp, client_ip="127.0.0.1")
        auth_header = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        conn = self._get_connection()

        # Add initial track
        conn.request(
            "POST",
            "/api/playback/add",
            body=json.dumps({"url": "https://youtube.com/watch?v=init1", "title": "Initial 1"}),
            headers=auth_header,
        )
        resp1 = conn.getresponse()
        self.assertEqual(resp1.status, 200)
        data1 = json.loads(resp1.read().decode("utf-8"))
        self.assertEqual(data1["track"]["position"], 1)

        # Add next track with order='next'
        conn.request(
            "POST",
            "/api/playback/add",
            body=json.dumps({"url": "https://youtube.com/watch?v=init2", "title": "Top Track", "order": "next"}),
            headers=auth_header,
        )
        resp2 = conn.getresponse()
        self.assertEqual(resp2.status, 200)
        data2 = json.loads(resp2.read().decode("utf-8"))
        self.assertEqual(data2["track"]["position"], 1)

        # Add track after Initial 1
        conn.request(
            "POST",
            "/api/playback/add",
            body=json.dumps({"url": "https://youtube.com/watch?v=init3", "title": "After Initial", "after": "Initial 1"}),
            headers=auth_header,
        )
        resp3 = conn.getresponse()
        self.assertEqual(resp3.status, 200)
        data3 = json.loads(resp3.read().decode("utf-8"))
        conn.close()

    def test_admin_playback_add_bulk(self):
        """Verify REST API /api/playback/add_bulk adds multiple tracks in bulk."""
        admin_otp = self.security.get_admin_otp()
        _, token, _ = self.security.verify_otp(admin_otp, client_ip="127.0.0.1")
        auth_header = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        conn = self._get_connection()

        # Add initial track
        conn.request(
            "POST",
            "/api/playback/add",
            body=json.dumps({"url": "https://youtube.com/watch?v=base1", "title": "Base Track"}),
            headers=auth_header,
        )
        resp1 = conn.getresponse()
        self.assertEqual(resp1.status, 200)
        resp1.read()

        # Bulk add 3 tracks
        bulk_payload = {
            "tracks": [
                {"url": "https://youtube.com/watch?v=blk1", "title": "Bulk 1"},
                {"url": "https://youtube.com/watch?v=blk2", "title": "Bulk 2"},
                "https://youtube.com/watch?v=blk3",
            ],
            "order": "next",
        }
        conn.request(
            "POST",
            "/api/playback/add_bulk",
            body=json.dumps(bulk_payload),
            headers=auth_header,
        )
        resp2 = conn.getresponse()
        self.assertEqual(resp2.status, 200)
        data = json.loads(resp2.read().decode("utf-8"))
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["added_count"], 3)
        conn.close()

    def test_admin_playback_reorder_and_move_bulk(self):
        """Verify REST API /api/playback/reorder_bulk and move_bulk."""
        admin_otp = self.security.get_admin_otp()
        _, token, _ = self.security.verify_otp(admin_otp, client_ip="127.0.0.1")
        auth_header = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        conn = self._get_connection()

        # Add 4 tracks
        for i in range(1, 5):
            conn.request(
                "POST",
                "/api/playback/add",
                body=json.dumps({"url": f"https://youtube.com/watch?v=rb_{i}", "title": f"Song {i}"}),
                headers=auth_header,
            )
            resp = conn.getresponse()
            self.assertEqual(resp.status, 200)
            resp.read()

        # Reorder bulk with sequence
        conn.request(
            "POST",
            "/api/playback/reorder_bulk",
            body=json.dumps({"sequence": ["Song 4", "Song 2", "Song 1", "Song 3"]}),
            headers=auth_header,
        )
        resp_reorder = conn.getresponse()
        self.assertEqual(resp_reorder.status, 200)
        data_reorder = json.loads(resp_reorder.read().decode("utf-8"))
        self.assertEqual(data_reorder["status"], "ok")
        self.assertEqual(data_reorder["reordered_count"], 4)

        # Move bulk (Song 1 and Song 3 to position 1)
        conn.request(
            "POST",
            "/api/playback/move_bulk",
            body=json.dumps({"items": ["Song 1", "Song 3"], "position": 1}),
            headers=auth_header,
        )
        resp_move = conn.getresponse()
        self.assertEqual(resp_move.status, 200)
        data_move = json.loads(resp_move.read().decode("utf-8"))
        self.assertEqual(data_move["status"], "ok")
        self.assertEqual(data_move["moved_count"], 2)

        conn.close()


if __name__ == "__main__":
    unittest.main()
