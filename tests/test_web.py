"""
Integration and Unit tests for Web Control Panel, HTTP Handlers, REST API, Static Assets, and WebSocket.
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
        otp = self.security.get_current_otp()
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

    def test_get_status_json(self):
        """Verify GET /status returns structured server metrics."""
        conn = self._get_connection()
        conn.request("GET", "/status")
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.assertIn("application/json", resp.getheader("Content-Type", ""))

        data = json.loads(resp.read().decode("utf-8"))
        self.assertEqual(data["server"], "music-streamer")
        self.assertIn("state", data)
        self.assertIn("security", data)
        self.assertIn("playback", data)
        self.assertIn("stream_url", data)
        conn.close()

    def test_api_auth_lifecycle(self):
        """Verify /api/auth/status and /api/auth/verify endpoints."""
        conn = self._get_connection()

        # 1. Initial auth status (not authed)
        conn.request("GET", "/api/auth/status")
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        data = json.loads(resp.read().decode("utf-8"))
        self.assertTrue(data["security_enabled"])
        self.assertFalse(data["authenticated"])

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

        # 3. Valid OTP verification
        otp = self.security.get_current_otp()
        conn.request(
            "POST",
            "/api/auth/verify",
            body=json.dumps({"otp": otp}),
            headers={"Content-Type": "application/json"},
        )
        resp_good = conn.getresponse()
        self.assertEqual(resp_good.status, 200)
        data_good = json.loads(resp_good.read().decode("utf-8"))
        self.assertTrue(data_good["authenticated"])
        self.assertIsNotNone(data_good["token"])
        session_token = data_good["token"]

        # 4. Status with token in header
        conn.request("GET", "/api/auth/status", headers={"Authorization": f"Bearer {session_token}"})
        resp_auth = conn.getresponse()
        self.assertEqual(resp_auth.status, 200)
        data_auth = json.loads(resp_auth.read().decode("utf-8"))
        self.assertTrue(data_auth["authenticated"])

        conn.close()

    def test_stream_mp3_authentication(self):
        """Verify /stream.mp3 enforces OTP authorization."""
        conn = self._get_connection()

        # Unauthorized request
        conn.request("GET", "/stream.mp3")
        resp_unauth = conn.getresponse()
        self.assertEqual(resp_unauth.status, 401)
        self.assertIn("Bearer", resp_unauth.getheader("WWW-Authenticate", ""))
        resp_unauth.read()

        # Authorized request via query param
        otp = self.security.get_current_otp()
        _, token = self.security.verify_otp(otp, client_ip="127.0.0.1")

        # Head request with token cookie
        conn.request("HEAD", "/stream.mp3", headers={"Cookie": f"music_session={token}"})
        resp_auth = conn.getresponse()
        self.assertEqual(resp_auth.status, 200)
        self.assertEqual(resp_auth.getheader("Content-Type"), "audio/mpeg")

        conn.close()

    def test_protected_api_actions(self):
        """Verify REST API control endpoints with session authentication."""
        otp = self.security.get_current_otp()
        _, token = self.security.verify_otp(otp, client_ip="127.0.0.1")
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

        conn.request("POST", "/api/loop", body=json.dumps({"loop": "repeat"}), headers=auth_header)
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.assertEqual(json.loads(resp.read().decode("utf-8"))["loop"], "repeat")

        conn.request("POST", "/api/loop", body=json.dumps({"loop": "off"}), headers=auth_header)
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.assertEqual(json.loads(resp.read().decode("utf-8"))["loop"], "off")

        # POST /api/mode
        conn.request("POST", "/api/mode", body=json.dumps({"mode": "speaker"}), headers=auth_header)
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.assertEqual(json.loads(resp.read().decode("utf-8"))["mode"], "speaker")

        # POST /api/playback/add (Initial)
        conn.request(
            "POST",
            "/api/playback/add",
            body=json.dumps({"url": "https://youtube.com/watch?v=abc", "title": "Web Song"}),
            headers=auth_header,
        )
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        data_first = json.loads(resp.read().decode("utf-8"))
        self.assertFalse(data_first.get("already_exists", True))

        # POST /api/playback/add (Duplicate)
        conn.request(
            "POST",
            "/api/playback/add",
            body=json.dumps({"url": "https://youtube.com/watch?v=abc", "title": "Web Song"}),
            headers=auth_header,
        )
        resp_dup = conn.getresponse()
        self.assertEqual(resp_dup.status, 200)
        data_dup = json.loads(resp_dup.read().decode("utf-8"))
        self.assertTrue(data_dup.get("already_exists", False))
        self.assertEqual(data_dup.get("status"), "already_exists")

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

        # POST /api/skip
        conn.request("POST", "/api/skip", body=json.dumps({}), headers=auth_header)
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.assertEqual(json.loads(resp.read().decode("utf-8"))["action"], "skip")

        # POST /api/prev
        conn.request("POST", "/api/prev", body=json.dumps({}), headers=auth_header)
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.assertEqual(json.loads(resp.read().decode("utf-8"))["action"], "prev")

        # POST /api/stop
        conn.request("POST", "/api/stop", body=json.dumps({}), headers=auth_header)
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        resp.read()

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

        # Read handshake response
        handshake_resp = s.recv(1024).decode("utf-8")
        self.assertIn("101 Switching Protocols", handshake_resp)
        self.assertIn("Sec-WebSocket-Accept", handshake_resp)

        # Read initial server text frame
        rfile = s.makefile("rb")
        opcode, payload = read_ws_frame(rfile)
        self.assertEqual(opcode, 0x1)  # Text frame
        status_data = json.loads(payload.decode("utf-8"))
        self.assertEqual(status_data["server"], "music-streamer")

        # Close websocket cleanly
        s.close()

    def test_web_volume_synchronization(self):
        """Verify web control panel volume controls synchronize with server state and WebSocket broadcast."""
        otp = self.security.get_current_otp()
        _, token = self.security.verify_otp(otp, client_ip="127.0.0.1")
        auth_header = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        conn = self._get_connection()

        # 1. Update volume via REST API to 42%
        conn.request("POST", "/api/volume", body=json.dumps({"volume": 42}), headers=auth_header)
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        data = json.loads(resp.read().decode("utf-8"))
        self.assertEqual(data["volume"], 42)

        # 2. Verify GET /status returns updated volume
        conn.request("GET", "/status")
        resp_status = conn.getresponse()
        self.assertEqual(resp_status.status, 200)
        status_data = json.loads(resp_status.read().decode("utf-8"))
        self.assertEqual(status_data["volume"], 42)

        # 3. Verify WebSocket volume command & broadcast
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
        s.recv(1024)  # Handshake response

        rfile = s.makefile("rb")
        read_ws_frame(rfile)  # Initial state frame

        # Send WebSocket volume update to 78% (client frames are masked)
        send_ws_text(s, json.dumps({"action": "volume", "volume": 78}), masked=True)
        time.sleep(0.1)

        # Receive broadcast frame
        opcode, payload = read_ws_frame(rfile)
        self.assertEqual(opcode, 0x1)
        ws_status = json.loads(payload.decode("utf-8"))
        self.assertEqual(ws_status["volume"], 78)

        s.close()
        conn.close()

    def test_playlist_rest_api_lifecycle(self):
        """Verify REST API lifecycle for multiple playlists."""
        otp = self.security.get_current_otp()
        _, token = self.security.verify_otp(otp, client_ip="127.0.0.1")
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

        # 3. GET /api/playlists
        conn.request("GET", "/api/playlists")
        resp_list = conn.getresponse()
        self.assertEqual(resp_list.status, 200)
        data_list = json.loads(resp_list.read().decode("utf-8"))
        self.assertEqual(len(data_list["playlists"]), 2)

        # 4. GET /api/playlist?name=Chill%20Lounge
        conn.request("GET", "/api/playlist?name=Chill%20Lounge")
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

        # 6. Play playlist with new name
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

    @patch("music_streamer.search.search_music")
    def test_api_search_unified(self, mock_web_search):
        """Verify GET and POST /api/search return both local and web matches."""
        from music_streamer.search import SearchResult, SearchResults

        mock_web_search.return_value = SearchResults(
            query="Chill",
            provider="youtube",
            count=1,
            results=[SearchResult(id="y1", title="Chill Beat Online", url="https://youtube.com/watch?v=y1")],
        )

        otp = self.security.get_current_otp()
        _, token = self.security.verify_otp(otp, client_ip="127.0.0.1")
        auth_header = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        conn = self._get_connection()

        # 1. GET /api/search?q=Chill
        conn.request("GET", "/api/search?q=Chill&count=3&web=1")
        resp_get = conn.getresponse()
        self.assertEqual(resp_get.status, 200)
        data_get = json.loads(resp_get.read().decode("utf-8"))
        self.assertIn("local_results", data_get)
        self.assertIn("web_results", data_get)
        self.assertEqual(len(data_get["web_results"]), 1)

        # 2. POST /api/search
        conn.request("POST", "/api/search", body=json.dumps({"q": "Chill", "count": 3, "web": True}), headers=auth_header)
        resp_post = conn.getresponse()
        self.assertEqual(resp_post.status, 200)
        data_post = json.loads(resp_post.read().decode("utf-8"))
        self.assertIn("local_results", data_post)
        self.assertIn("web_results", data_post)

        conn.close()


if __name__ == "__main__":
    unittest.main()
