"""
HTTP Server, WebSocket Realtime Hub, REST API Handlers, and Unix Domain Socket Listener.
Supports dual-role authentication: Admin (full control & playlists) and Subscriber (streaming & track viewing only).
"""

import base64
import hashlib
import http.server
import json
import os
import queue
import select
import socket
import socketserver
import sys
import threading
import time
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlparse

from music_streamer.config import INDEX_HTML_PATH, SOCKET_PATH, WEB_DIR, WEB_OUT_DIR, WS_GUID
from music_streamer.db import DatabaseManager, db
from music_streamer.engine import AudioEngine, Broadcaster
from music_streamer.playback import PlaybackManager, get_thumbnail_for_url, playback_mgr
from music_streamer.playlist import PlaylistManager, playlist_mgr
from music_streamer.security import OTPManager, security


def calc_ws_accept(key: str) -> str:
    """Calculates the Sec-WebSocket-Accept hash for RFC 6455 handshake."""
    return base64.b64encode(hashlib.sha1((key.strip() + WS_GUID).encode("utf-8")).digest()).decode("utf-8")


def send_ws_text(target, text: str, masked: bool = False):
    """Encodes and sends a text frame per RFC 6455."""
    payload = text.encode("utf-8")
    length = len(payload)
    header = bytearray([0x81])  # FIN + Opcode 1 (Text)
    mask_bit = 0x80 if masked else 0x00

    if length < 126:
        header.append(length | mask_bit)
    elif length <= 65535:
        header.append(126 | mask_bit)
        header.extend(length.to_bytes(2, byteorder="big"))
    else:
        header.append(127 | mask_bit)
        header.extend(length.to_bytes(8, byteorder="big"))

    if masked:
        mask_key = os.urandom(4)
        header.extend(mask_key)
        masked_payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
        data_to_send = bytes(header) + masked_payload
    else:
        data_to_send = bytes(header) + payload

    if hasattr(target, "sendall"):
        target.sendall(data_to_send)
    elif hasattr(target, "write"):
        target.write(data_to_send)
        if hasattr(target, "flush"):
            target.flush()


def send_ws_binary(target, data: bytes, masked: bool = False):
    """Encodes and sends a binary frame (Opcode 0x2) per RFC 6455 for ultra-low latency PCM streaming."""
    if not isinstance(data, (bytes, bytearray)):
        data = bytes(data)
    length = len(data)
    header = bytearray([0x82])  # FIN + Opcode 2 (Binary)
    mask_bit = 0x80 if masked else 0x00

    if length < 126:
        header.append(length | mask_bit)
    elif length <= 65535:
        header.append(126 | mask_bit)
        header.extend(length.to_bytes(2, byteorder="big"))
    else:
        header.append(127 | mask_bit)
        header.extend(length.to_bytes(8, byteorder="big"))

    if masked:
        mask_key = os.urandom(4)
        header.extend(mask_key)
        masked_payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(data))
        data_to_send = bytes(header) + masked_payload
    else:
        data_to_send = bytes(header) + data

    if hasattr(target, "sendall"):
        target.sendall(data_to_send)
    elif hasattr(target, "write"):
        target.write(data_to_send)
        if hasattr(target, "flush"):
            target.flush()


def read_ws_frame(rfile):
    """Reads and unmasks an incoming WebSocket frame from client per RFC 6455."""
    b1 = rfile.read(1)
    if not b1:
        return None, None
    opcode = b1[0] & 0x0F
    b2 = rfile.read(1)
    if not b2:
        return None, None
    masked = (b2[0] & 0x80) != 0
    length = b2[0] & 0x7F

    if length == 126:
        data2 = rfile.read(2)
        if len(data2) < 2:
            return None, None
        length = int.from_bytes(data2, byteorder="big")
    elif length == 127:
        data8 = rfile.read(8)
        if len(data8) < 8:
            return None, None
        length = int.from_bytes(data8, byteorder="big")

    mask_key = rfile.read(4) if masked else None
    if masked and (not mask_key or len(mask_key) < 4):
        return None, None

    payload = rfile.read(length)
    if len(payload) < length:
        return None, None

    if masked and mask_key:
        payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))

    return opcode, payload


def build_server_status(
    database: Optional[DatabaseManager] = None,
    engine: Optional[AudioEngine] = None,
    broadcaster: Optional[Broadcaster] = None,
    host_header: str = "localhost:8000",
    role: str = "admin",
) -> dict:
    """
    Builds a complete, unified dictionary of the current playback, stream, and track history state.
    If role == 'subscriber', playlists are omitted (empty list) for privacy.
    """
    db_inst = database or db
    mgr = PlaybackManager(db_inst)
    playback_state = mgr.get_state()

    state = engine.state if engine else db_inst.get_setting("state", "stopped")
    mode = engine.mode if engine else db_inst.get_setting("mode", "silent")
    loop = engine.loop if engine else db_inst.get_setting("loop", "yes")
    cur_url = engine.current_url if engine else db_inst.get_setting("current_url", "")
    cur_title = engine.current_title if engine else db_inst.get_setting("current_title", "")
    cur_thumb = (
        (engine.current_thumbnail if engine else db_inst.get_setting("current_thumbnail", ""))
        or get_thumbnail_for_url(cur_url)
    )
    client_cnt = broadcaster.client_count() if broadcaster else 0

    elapsed = 0
    if engine and engine.track_start_time and state in ["playing", "paused"]:
        if state == "playing":
            elapsed = max(0, int(time.time() - engine.track_start_time))
        elif state == "paused" and getattr(engine, "paused_time", None):
            elapsed = max(0, int(engine.paused_time - engine.track_start_time))
        else:
            elapsed = max(0, int(getattr(engine, "elapsed_offset", 0)))

    duration = getattr(engine, "current_duration", 0) if engine else db_inst.get_int_setting("current_duration", 0)
    vol = engine.volume if engine else db_inst.get_int_setting("volume", 80)

    # Subscribers CANNOT view playlists
    playlists = db_inst.get_playlists() if role == "admin" else []

    return {
        "server": "music-streamer",
        "state": state,
        "mode": mode,
        "volume": vol,
        "role": role,
        "security": {
            "enabled": db_inst.get_bool_setting("otp_enabled", default=True),
        },
        "now_playing": {
            "url": cur_url or None,
            "title": cur_title or None,
            "thumbnail": cur_thumb or None,
            "elapsed_seconds": elapsed,
            "duration_seconds": duration,
        },
        "loop": loop,
        "last_error": getattr(engine, "last_error", None) if engine else None,
        "is_buffering": bool(engine and engine.state == "playing" and getattr(engine, "is_buffering", False)),
        "playback": playback_state,
        "queue": {
            "count": playback_state["queued_count"],
            "mode": playback_state["mode"],
            "tracks": playback_state["queued_tracks"],
        },
        "playlists": playlists,
        "next": playback_state["next"],
        "clients_connected": client_cnt,
        "stream_url": f"http://{host_header}/stream.mp3",
    }


class WebSocketHub:
    """Manages active WebSocket connections and broadcasts role-tailored real-time updates and sub-100ms binary audio stream."""

    def __init__(self, server):
        self.server = server
        self.clients = {}  # wfile -> {"host_header": host_header, "role": role, "audio_subscribed": bool}
        self.lock = threading.Lock()
        self.running = True
        self._ticker_thread = threading.Thread(target=self._ticker_loop, daemon=True)
        self._ticker_thread.start()

    def register(self, wfile, host_header="localhost:8000", role="admin"):
        with self.lock:
            self.clients[wfile] = {"host_header": host_header, "role": role, "audio_subscribed": False}
        print(f"[WebSocketHub] Client connected (Role: {role}, Active WS listeners: {len(self.clients)})")
        try:
            status_json = json.dumps(
                build_server_status(self.server.db, self.server.engine, self.server.broadcaster, host_header, role=role),
                ensure_ascii=False,
            )
            send_ws_text(wfile, status_json)
        except Exception:
            self.unregister(wfile)

    def unregister(self, wfile):
        with self.lock:
            self.clients.pop(wfile, None)
        print(f"[WebSocketHub] Client disconnected (Remaining WS listeners: {len(self.clients)})")

    def update_role(self, wfile, role: str):
        with self.lock:
            if wfile in self.clients:
                self.clients[wfile]["role"] = role

    def get_role(self, wfile) -> str:
        with self.lock:
            info = self.clients.get(wfile)
            return info["role"] if info else "subscriber"

    def set_audio_subscription(self, wfile, subscribed: bool):
        with self.lock:
            if wfile in self.clients:
                self.clients[wfile]["audio_subscribed"] = subscribed
                print(f"[WebSocketHub] Audio stream {'subscribed' if subscribed else 'unsubscribed'} for WS client")

    def broadcast_audio_chunk(self, raw_pcm: bytes):
        """Broadcasts 50ms raw PCM audio chunk as RFC 6455 binary frame to subscribed WebSocket clients."""
        if not raw_pcm:
            return
        dead = []
        with self.lock:
            for wfile, info in list(self.clients.items()):
                if info.get("audio_subscribed"):
                    # Check OTP security permissions if enabled
                    if self.server.security.is_enabled():
                        role = info.get("role")
                        if role not in ["admin", "subscriber"]:
                            continue
                    try:
                        send_ws_binary(wfile, raw_pcm)
                    except Exception:
                        dead.append(wfile)
            for d in dead:
                self.clients.pop(d, None)

    def broadcast(self):
        """Pushes the latest status to every connected WebSocket client tailored by role."""
        dead = []
        with self.lock:
            for wfile, info in list(self.clients.items()):
                try:
                    status_json = json.dumps(
                        build_server_status(
                            self.server.db,
                            self.server.engine,
                            self.server.broadcaster,
                            info["host_header"],
                            role=info.get("role", "admin"),
                        ),
                        ensure_ascii=False,
                    )
                    send_ws_text(wfile, status_json)
                except Exception:
                    dead.append(wfile)
            for d in dead:
                self.clients.pop(d, None)

    def _ticker_loop(self):
        """Periodic 0.5s broadcast to keep elapsed playback time smoothly updating."""
        while self.running:
            try:
                time.sleep(0.5)
                if self.clients:
                    self.broadcast()
            except Exception:
                pass


class StreamRequestHandler(http.server.BaseHTTPRequestHandler):
    """Handles HTTP requests: /ws, /stream.mp3, /status, /, and API endpoints."""

    def do_HEAD(self):
        self.do_GET(head_only=True)

    def do_GET(self, head_only=False):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/ws":
            key = self.headers.get("Sec-WebSocket-Key")
            if not key:
                self.send_error(400, "Bad WebSocket Request")
                return

            accept_val = calc_ws_accept(key)
            self.send_response(101, "Switching Protocols")
            self.send_header("Upgrade", "websocket")
            self.send_header("Connection", "Upgrade")
            self.send_header("Sec-WebSocket-Accept", accept_val)
            self.end_headers()
            self.wfile.flush()

            host_header = self.headers.get("Host", "localhost:8000")
            caller_role = self.server.security.get_request_role(self) or ("admin" if not self.server.security.is_enabled() else "subscriber")
            self.server.ws_hub.register(self.wfile, host_header, role=caller_role)

            try:
                while True:
                    opcode, payload = read_ws_frame(self.rfile)
                    if opcode is None or opcode == 0x8:  # Close frame
                        break
                    elif opcode == 0x9:  # Ping -> Pong
                        pong = bytearray([0x8A, 0x00])
                        self.wfile.write(pong)
                        self.wfile.flush()
                    elif opcode == 0x1:  # Text frame
                        try:
                            msg = json.loads(payload.decode("utf-8"))
                            self._handle_ws_command(msg)
                        except Exception as e:
                            print(f"[WebSocket] Error handling command: {e}", file=sys.stderr)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
            finally:
                self.server.ws_hub.unregister(self.wfile)
            return

        elif path in ["/status", "/api/status"]:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache, no-store")
            self.end_headers()

            if not head_only:
                host_header = self.headers.get("Host", "localhost:8000")
                sec: OTPManager = self.server.security
                caller_role = sec.get_request_role(self) or ("admin" if not sec.is_enabled() else "subscriber")
                data = build_server_status(
                    self.server.db, self.server.engine, self.server.broadcaster, host_header, role=caller_role
                )
                self.wfile.write(json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8"))
            return

        elif path == "/api/auth/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache, no-store")
            self.end_headers()

            if not head_only:
                sec: OTPManager = self.server.security
                caller_role = sec.get_request_role(self)
                authed = caller_role is not None if sec.is_enabled() else True
                self.wfile.write(
                    json.dumps({
                        "status": "ok",
                        "security_enabled": sec.is_enabled(),
                        "authenticated": authed,
                        "role": caller_role if authed else None,
                    }).encode("utf-8")
                )
            return

        elif path == "/api/playlists":
            sec: OTPManager = self.server.security
            if sec.is_enabled() and not sec.is_request_authenticated(self, required_role="admin"):
                self.send_response(403)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"status": "error", "error": "Forbidden: Playlists are only available to administrators."}\n')
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache, no-store")
            self.end_headers()
            if not head_only:
                pls = self.server.playlist_mgr.get_playlists()
                self.wfile.write(json.dumps({"status": "ok", "playlists": pls}).encode("utf-8"))
            return

        elif path == "/api/playlist":
            sec: OTPManager = self.server.security
            if sec.is_enabled() and not sec.is_request_authenticated(self, required_role="admin"):
                self.send_response(403)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"status": "error", "error": "Forbidden: Playlists are only available to administrators."}\n')
                return

            qs = parse_qs(parsed.query)
            target = qs.get("name", [""])[0] or qs.get("id", [""])[0] or qs.get("playlist", [""])[0]
            pl = self.server.playlist_mgr.get_playlist(target) if target else None
            if pl:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-cache, no-store")
                self.end_headers()
                if not head_only:
                    self.wfile.write(json.dumps({"status": "ok", "playlist": pl}).encode("utf-8"))
            else:
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                if not head_only:
                    self.wfile.write(b'{"status": "error", "message": "Playlist not found"}\n')
            return

        elif path == "/api/search":
            sec: OTPManager = self.server.security
            caller_role = sec.get_request_role(self) or ("admin" if not sec.is_enabled() else "subscriber")
            qs = parse_qs(parsed.query)
            q = qs.get("q", [""])[0] or qs.get("query", [""])[0]
            count = int(qs.get("count", ["5"])[0])
            include_web = qs.get("web", ["1"])[0] not in ["0", "false", "no"]
            from music_streamer.search import search_unified
            res = search_unified(q, count=count, include_web=include_web, database=self.server.db)
            if caller_role == "subscriber" and sec.is_enabled():
                if "local_matches" in res:
                    res["local_matches"] = [m for m in res["local_matches"] if m.get("source_type") != "playlist"]
                    res["local_count"] = len(res["local_matches"])
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache, no-store")
            self.end_headers()
            if not head_only:
                self.wfile.write(json.dumps({"status": "ok", **res}).encode("utf-8"))
            return

        elif path == "/" or path == "/index.html":
            qs = parse_qs(parsed.query)
            query_otp = qs.get("otp", [None])[0]
            cookie_header = None
            if query_otp:
                sec: OTPManager = self.server.security
                ok, token, role = sec.verify_otp(query_otp, self.client_address[0])
                if ok:
                    cookie_header = f"music_session={token}; Path=/; SameSite=Lax; Max-Age=604800"

            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            if cookie_header:
                self.send_header("Set-Cookie", cookie_header)
            self.end_headers()

            if not head_only:
                engine: AudioEngine = self.server.engine
                cur_title = engine.current_title or "Idle (Ready to play)"
                cur_url = engine.current_url or ""
                cur_thumb = engine.current_thumbnail or get_thumbnail_for_url(cur_url)
                host = self.headers.get("Host", "localhost:8000")
                stream_url_full = f"http://{host}/stream.mp3"

                template_content = ""
                if INDEX_HTML_PATH.exists():
                    template_content = INDEX_HTML_PATH.read_text(encoding="utf-8")
                else:
                    template_content = "<h1>Music Streamer</h1><p>web/index.html not found.</p>"

                rendered_html = (
                    template_content.replace("{{TRACK_TITLE}}", cur_title)
                    .replace("{{TRACK_URL}}", cur_url or "#")
                    .replace("{{TRACK_URL_DISPLAY}}", cur_url or "No active stream URL")
                    .replace("{{TRACK_THUMBNAIL}}", cur_thumb or "")
                    .replace("{{STREAM_URL_FULL}}", stream_url_full)
                )
                self.wfile.write(rendered_html.encode("utf-8"))
            return

        elif (
            ((WEB_OUT_DIR / path.lstrip("/")).is_file() and (WEB_OUT_DIR / path.lstrip("/")).resolve().is_relative_to(WEB_OUT_DIR))
            or ((WEB_DIR / path.lstrip("/")).is_file() and (WEB_DIR / path.lstrip("/")).resolve().is_relative_to(WEB_DIR))
        ):
            relative_path = path.lstrip("/")
            if (WEB_OUT_DIR / relative_path).is_file() and (WEB_OUT_DIR / relative_path).resolve().is_relative_to(WEB_OUT_DIR):
                static_file = (WEB_OUT_DIR / relative_path).resolve()
            else:
                static_file = (WEB_DIR / relative_path).resolve()

            mime_map = {
                ".css": "text/css; charset=utf-8",
                ".js": "application/javascript; charset=utf-8",
                ".json": "application/json; charset=utf-8",
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".svg": "image/svg+xml",
                ".ico": "image/x-icon",
                ".woff2": "font/woff2",
                ".html": "text/html; charset=utf-8",
                ".txt": "text/plain; charset=utf-8",
            }
            content_type = mime_map.get(static_file.suffix.lower(), "application/octet-stream")
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-cache, must-revalidate")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            if not head_only:
                self.wfile.write(static_file.read_bytes())
            return

        elif path.startswith("/stream.mp3"):
            sec: OTPManager = self.server.security
            if sec.is_enabled() and not sec.is_request_authenticated(self, required_role="subscriber"):
                self.send_response(401)
                self.send_header("Content-Type", "application/json")
                self.send_header("WWW-Authenticate", "Bearer realm='MusicStreamer'")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(
                    b'{"error": "Unauthorized. Protected stream requires valid OTP passcode or token."}\n'
                )
                return

            qs = parse_qs(parsed.query)
            query_url = qs.get("url", [None])[0]
            if query_url:
                # Play command on stream url requires admin privilege
                if not sec.is_enabled() or sec.is_request_authenticated(self, required_role="admin"):
                    self.server.engine.post_command({"action": "play", "url": query_url})

            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.send_header("Connection", "close")
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("icy-name", "Music Streamer Live Broadcast")
            self.send_header("icy-genre", "Live Stream")
            self.send_header("icy-br", "128")
            self.end_headers()
            self.wfile.flush()

            if head_only:
                return

            client_ip = self.client_address[0]
            client_queue = self.server.broadcaster.subscribe()
            print(
                f"[{time.strftime('%H:%M:%S')}] Client connected: {client_ip} (Listeners: {self.server.broadcaster.client_count()})",
                flush=True,
            )
            self.server.ws_hub.broadcast()

            try:
                while True:
                    try:
                        chunk = client_queue.get(timeout=5.0)
                        self.wfile.write(chunk)
                        self.wfile.flush()
                    except queue.Empty:
                        continue
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
            except Exception as e:
                print(f"[StreamHandler] Client {client_ip} stream disconnected: {e}", file=sys.stderr)
            finally:
                self.server.broadcaster.unsubscribe(client_queue)
                print(
                    f"[{time.strftime('%H:%M:%S')}] Client disconnected: {client_ip} (Remaining listeners: {self.server.broadcaster.client_count()})",
                    flush=True,
                )
                self.server.ws_hub.broadcast()
            return

        else:
            self.send_error(404, "Not found. Use /ws, /stream.mp3, or /status")

    def _handle_ws_command(self, payload: dict):
        action = payload.get("action")
        sec: OTPManager = self.server.security

        if action == "auth":
            token = payload.get("token") or payload.get("otp")
            if token:
                ok, _, role = sec.verify_otp(str(token), self.client_address[0])
                if ok:
                    self.server.ws_hub.update_role(self.wfile, role)
                    self.server.ws_hub.broadcast()
            return

        if action in ["subscribe_audio", "audio_subscribe"]:
            # Audio streaming is permitted for authenticated subscribers and admins
            if sec.is_enabled():
                client_role = self.server.ws_hub.get_role(self.wfile)
                if client_role not in ["admin", "subscriber"]:
                    return
            self.server.ws_hub.set_audio_subscription(self.wfile, True)
            return

        if action in ["unsubscribe_audio", "audio_unsubscribe"]:
            self.server.ws_hub.set_audio_subscription(self.wfile, False)
            return

        # Playback control & playlist actions via WebSocket require admin role
        client_role = self.server.ws_hub.get_role(self.wfile)
        if sec.is_enabled() and client_role != "admin":
            print(f"[WebSocket] Rejected action '{action}' from non-admin client", file=sys.stderr)
            return

        engine: AudioEngine = self.server.engine
        mgr: PlaybackManager = self.server.playback_mgr

        if action == "play":
            engine.post_command({"action": "play", "url": payload.get("url"), "title": payload.get("title")})
        elif action == "pause":
            engine.post_command({"action": "pause"})
        elif action == "resume":
            engine.post_command({"action": "resume"})
        elif action == "stop":
            engine.post_command({"action": "stop"})
        elif action in ["seek", "progress"]:
            engine.post_command({"action": "seek", "seconds": payload.get("seconds", payload.get("position", 0))})
        elif action in ["seek_relative", "seek_step", "progress_toggle"]:
            engine.post_command({"action": "seek_relative", "delta": payload.get("delta", payload.get("seconds", 10))})
        elif action in ["skip", "next"]:
            engine.post_command({"action": "skip"})
        elif action in ["prev", "previous", "playback_prev"]:
            engine.post_command({"action": "prev"})
        elif action in ["interrupt", "playback_play", "queue_play"]:
            url = payload.get("url")
            title = payload.get("title")
            idx = payload.get("index")
            track_id = payload.get("id")

            target_track = None
            if track_id is not None:
                target_track = mgr.play_track_by_id(track_id)
            elif idx is not None:
                target_track = mgr.play_track_by_index(int(idx))

            if target_track:
                url = target_track["url"]
                title = target_track["title"]
                thumb = target_track.get("thumbnail")
            else:
                thumb = get_thumbnail_for_url(url) if url else ""
                if url:
                    t = mgr.add_track(url, title=title or "", thumbnail=thumb, auto_fetch=True)
                    url = t["url"]
                    title = t["title"]
                    thumb = t.get("thumbnail")

            if url:
                engine.post_command({"action": "interrupt", "url": url, "title": title or url, "thumbnail": thumb})
        elif action in ["playback_remove", "queue_remove"]:
            idx = payload.get("index")
            track_id = payload.get("id")
            mgr.remove_track(track_id if track_id is not None else idx)
        elif action in ["playback_add", "queue_add"]:
            url = payload.get("url")
            title = payload.get("title") or ""
            if url:
                mgr.add_track(url, title=title, auto_fetch=True)
        elif action in ["playback_shuffle", "queue_shuffle"]:
            mgr.shuffle_unplayed_tracks()
        elif action in ["playback_mode", "queue_mode"]:
            mode = payload.get("mode", "toggle")
            mgr.set_mode(mode)
        elif action in ["playback_clear", "queue_clear"]:
            mgr.clear_all()
        elif action == "playback_reset_history":
            mgr.reset_history()
        elif action == "playlist_create":
            name = payload.get("name")
            if name:
                self.server.playlist_mgr.create_playlist(name)
        elif action == "playlist_rename":
            target = payload.get("playlist") or payload.get("name") or payload.get("id")
            new_name = payload.get("new_name")
            if target and new_name:
                self.server.playlist_mgr.rename_playlist(target, new_name)
        elif action == "playlist_delete":
            target = payload.get("name") or payload.get("id") or payload.get("playlist")
            if target:
                self.server.playlist_mgr.delete_playlist(target)
        elif action == "playlist_add":
            target = payload.get("playlist") or payload.get("name") or payload.get("id")
            url = payload.get("url")
            title = payload.get("title", "")
            if target and url:
                self.server.playlist_mgr.add_track(target, url=url, title=title)
        elif action == "playlist_remove":
            target = payload.get("playlist") or payload.get("name") or payload.get("id")
            idx = payload.get("index") if payload.get("index") is not None else payload.get("id")
            if target and idx is not None:
                self.server.playlist_mgr.remove_track(target, idx)
        elif action == "playlist_play":
            target = payload.get("playlist") or payload.get("name") or payload.get("id")
            if target:
                res = self.server.playlist_mgr.play_playlist(target, shuffle=bool(payload.get("shuffle", False)))
                if res.get("success"):
                    engine.post_command({"action": "play"})
        elif action == "playlist_queue":
            target = payload.get("playlist") or payload.get("name") or payload.get("id")
            if target:
                self.server.playlist_mgr.queue_playlist(target, shuffle=bool(payload.get("shuffle", False)))
        elif action == "mode":
            mode = payload.get("mode")
            if mode:
                engine.set_mode(mode)
        elif action == "loop":
            loop_val = payload.get("loop", "toggle")
            engine.post_command({"action": "set_loop", "loop": loop_val})
        elif action in ["dismiss_error", "clear_error"]:
            engine.last_error = None
        elif action in ["volume", "set_volume"]:
            vol = payload.get("volume")
            if vol is not None:
                try:
                    vol_int = max(0, min(100, int(vol)))
                    engine.volume = vol_int
                    engine.db.set_setting("volume", str(vol_int))
                    engine.post_command({"action": "set_volume", "volume": vol_int})
                except Exception:
                    pass

        time.sleep(0.05)
        self.server.ws_hub.broadcast()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            payload = json.loads(body) if body else {}
        except Exception:
            payload = {}

        sec: OTPManager = self.server.security

        # 1. Auth Endpoints
        if path == "/api/auth/verify":
            otp_input = str(payload.get("otp", "")).strip()
            token_input = str(payload.get("token", "")).strip()
            client_ip = self.client_address[0]

            ok = False
            session_token = ""
            role = ""
            if token_input:
                token_role = sec.get_token_role(token_input)
                if token_role:
                    ok = True
                    session_token = token_input
                    role = token_role
            elif otp_input:
                ok, session_token, role = sec.verify_otp(otp_input, client_ip)

            if ok:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Set-Cookie", f"music_session={session_token}; Path=/; SameSite=Lax; Max-Age=604800")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(
                    json.dumps({"status": "ok", "authenticated": True, "token": session_token, "role": role}).encode("utf-8")
                )
            else:
                self.send_response(403)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(
                    json.dumps({"status": "error", "authenticated": False, "message": "Invalid OTP Passcode"}).encode(
                        "utf-8"
                    )
                )
            return

        elif path == "/api/auth/status":
            caller_role = sec.get_request_role(self)
            authed = caller_role is not None if sec.is_enabled() else True
            self._send_json({
                "status": "ok",
                "security_enabled": sec.is_enabled(),
                "authenticated": authed,
                "role": caller_role if authed else None,
            })
            return

        # 2. Search Endpoint (accessible by both admin and subscriber, but subscriber cannot see playlist tracks)
        if path == "/api/search":
            caller_role = sec.get_request_role(self) or ("admin" if not sec.is_enabled() else "subscriber")
            query = payload.get("query") or payload.get("q") or ""
            count = int(payload.get("count", 5))
            include_web = payload.get("web", True)
            from music_streamer.search import search_unified
            res = search_unified(query, count=count, include_web=include_web, database=self.server.db)
            if caller_role == "subscriber" and sec.is_enabled():
                if "local_matches" in res:
                    res["local_matches"] = [m for m in res["local_matches"] if m.get("source_type") != "playlist"]
                    res["local_count"] = len(res["local_matches"])
            self._send_json({"status": "ok", **res})
            return

        # 3. Protected Control & Playlist Endpoints (Admin role required)
        if sec.is_enabled() and not sec.is_request_authenticated(self, required_role="admin"):
            self.send_response(403)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"error": "Forbidden. Admin privileges required to control server, playback, and playlists."}\n')
            return

        engine: AudioEngine = self.server.engine
        mgr: PlaybackManager = self.server.playback_mgr

        if path == "/api/play":
            engine.post_command({"action": "play", "url": payload.get("url"), "title": payload.get("title")})
            self._send_json({"status": "ok", "action": "play"})

        elif path == "/api/pause":
            engine.post_command({"action": "pause"})
            self._send_json({"status": "ok", "action": "pause"})

        elif path == "/api/resume":
            engine.post_command({"action": "resume"})
            self._send_json({"status": "ok", "action": "resume"})

        elif path == "/api/stop":
            engine.post_command({"action": "stop"})
            self._send_json({"status": "ok", "action": "stop"})

        elif path in ["/api/seek", "/api/progress"]:
            pos = payload.get("seconds", payload.get("position"))
            delta = payload.get("delta")
            if delta is not None:
                engine.post_command({"action": "seek_relative", "delta": float(delta)})
                self._send_json({"status": "ok", "action": "seek_relative", "delta": float(delta)})
            elif pos is not None:
                engine.post_command({"action": "seek", "seconds": float(pos)})
                self._send_json({"status": "ok", "action": "seek", "seconds": float(pos)})
            else:
                self._send_json({"status": "error", "error": "Missing seconds or delta parameter"})

        elif path in ["/api/skip", "/api/next"]:
            engine.post_command({"action": "skip"})
            self._send_json({"status": "ok", "action": "skip"})

        elif path in ["/api/prev", "/api/previous", "/api/playback/prev"]:
            engine.post_command({"action": "prev"})
            self._send_json({"status": "ok", "action": "prev"})

        elif path in ["/api/interrupt", "/api/playback/play", "/api/queue/play"]:
            engine.post_command(
                {
                    "action": "interrupt",
                    "url": payload.get("url"),
                    "title": payload.get("title"),
                    "index": payload.get("index"),
                    "id": payload.get("id"),
                }
            )
            self._send_json({"status": "ok", "action": "interrupt"})

        elif path in ["/api/playback/remove", "/api/queue/remove"]:
            idx = payload.get("index")
            track_id = payload.get("id")
            mgr.remove_track(track_id if track_id is not None else idx)
            self._send_json({"status": "ok", "action": "remove"})

        elif path in ["/api/playback/shuffle", "/api/queue/shuffle"]:
            target_mode = mgr.shuffle_unplayed_tracks()
            self._send_json({"status": "ok", "mode": target_mode})

        elif path in ["/api/playback/mode", "/api/queue/mode"]:
            mode = payload.get("mode", "toggle")
            target_mode = mgr.set_mode(mode)
            self._send_json({"status": "ok", "mode": target_mode})

        elif path in ["/api/playback/add", "/api/queue/add"]:
            url = payload.get("url")
            title = payload.get("title") or url
            t = None
            if url:
                t = mgr.add_track(url, title)
            self.server.ws_hub.broadcast()
            if t and t.get("already_exists"):
                self._send_json({
                    "status": "already_exists",
                    "already_exists": True,
                    "message": f"Track already exists in playback tracklist: {t.get('title', url)}",
                    "track": t,
                })
            else:
                self._send_json({"status": "ok", "already_exists": False, "track": t})

        elif path in ["/api/playback/clear", "/api/queue/clear"]:
            mgr.clear_all()
            self._send_json({"status": "ok"})

        elif path == "/api/playback/reset_history":
            mgr.reset_history()
            self._send_json({"status": "ok"})

        elif path == "/api/playlist/create":
            name = payload.get("name") or "New Playlist"
            pl = self.server.playlist_mgr.create_playlist(name)
            self.server.ws_hub.broadcast()
            self._send_json({"status": "ok", "playlist": pl})

        elif path == "/api/playlist/rename":
            target = payload.get("playlist") or payload.get("name") or payload.get("id")
            new_name = payload.get("new_name")
            if not target or not new_name:
                self._send_json({"status": "error", "error": "Missing target playlist or new_name"})
            else:
                res = self.server.playlist_mgr.rename_playlist(target, new_name)
                self.server.ws_hub.broadcast()
                self._send_json({"status": "ok" if res.get("success") else "error", **res})

        elif path == "/api/playlist/delete":
            target = payload.get("name") or payload.get("id") or payload.get("playlist")
            ok = self.server.playlist_mgr.delete_playlist(target) if target else False
            self.server.ws_hub.broadcast()
            self._send_json({"status": "ok" if ok else "error", "deleted": ok})

        elif path == "/api/playlist/add":
            target = payload.get("playlist") or payload.get("name") or payload.get("id")
            url = payload.get("url")
            title = payload.get("title", "")
            t = self.server.playlist_mgr.add_track(target, url=url, title=title)
            self.server.ws_hub.broadcast()
            if t and t.get("already_exists"):
                self._send_json({
                    "status": "already_exists",
                    "already_exists": True,
                    "message": f"Track already exists in playlist: {t.get('title', url)}",
                    "track": t,
                })
            else:
                self._send_json({"status": "ok", "already_exists": False, "track": t})

        elif path == "/api/playlist/remove":
            target = payload.get("playlist") or payload.get("name") or payload.get("id")
            idx = payload.get("index") if payload.get("index") is not None else payload.get("id")
            ok = self.server.playlist_mgr.remove_track(target, idx)
            self.server.ws_hub.broadcast()
            self._send_json({"status": "ok" if ok else "error", "removed": ok})

        elif path == "/api/playlist/play":
            target = payload.get("playlist") or payload.get("name") or payload.get("id")
            res = self.server.playlist_mgr.play_playlist(target, shuffle=bool(payload.get("shuffle", False)))
            if res.get("success"):
                engine.post_command({"action": "play"})
            self.server.ws_hub.broadcast()
            self._send_json(res)

        elif path == "/api/playlist/queue":
            target = payload.get("playlist") or payload.get("name") or payload.get("id")
            res = self.server.playlist_mgr.queue_playlist(target, shuffle=bool(payload.get("shuffle", False)))
            self.server.ws_hub.broadcast()
            self._send_json(res)

        elif path == "/api/mode":
            mode = payload.get("mode")
            if mode:
                engine.set_mode(mode)
            self._send_json({"status": "ok", "mode": engine.mode})

        elif path == "/api/loop":
            loop_val = payload.get("loop", "toggle")
            if loop_val == "toggle":
                cur_loop = (engine.loop or engine.db.get_setting("loop", "repeat")).lower()
                if cur_loop in ["repeat", "yes", "all"]:
                    engine.loop = "repeat-one"
                elif cur_loop in ["repeat-one", "repeat_one", "one", "single"]:
                    engine.loop = "off"
                else:
                    engine.loop = "repeat"
            elif str(loop_val).lower() in ["repeat-one", "repeat_one", "one", "single"]:
                engine.loop = "repeat-one"
            elif str(loop_val).lower() in ["repeat", "all", "yes", "1", "true", "on"]:
                engine.loop = "repeat"
            else:
                engine.loop = "off"
            engine.db.set_setting("loop", engine.loop)
            engine.post_command({"action": "set_loop", "loop": engine.loop})
            self._send_json({"status": "ok", "loop": engine.loop})

        elif path == "/api/volume":
            vol = payload.get("volume")
            if vol is not None:
                try:
                    vol_int = max(0, min(100, int(vol)))
                    engine.volume = vol_int
                    engine.db.set_setting("volume", str(vol_int))
                    engine.post_command({"action": "set_volume", "volume": vol_int})
                except Exception:
                    pass
            self._send_json({"status": "ok", "volume": engine.volume})

        elif path in ["/api/dismiss_error", "/api/error/dismiss"]:
            engine.last_error = None
            self._send_json({"status": "ok"})

        else:
            self.send_error(404, "Unknown API endpoint")
            return

        time.sleep(0.05)
        self.server.ws_hub.broadcast()

    def _send_json(self, data: dict):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def log_message(self, format, *args):
        pass


class ThreadedStreamServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(
        self,
        server_address,
        RequestHandlerClass,
        engine: AudioEngine,
        broadcaster: Broadcaster,
        database: Optional[DatabaseManager] = None,
    ):
        self.engine = engine
        self.broadcaster = broadcaster
        self.db = database or engine.db
        self.security = OTPManager(self.db)
        self.playback_mgr = PlaybackManager(self.db)
        self.playlist_mgr = PlaylistManager(self.db, self.playback_mgr)
        self.start_time = time.time()
        self.ws_hub = WebSocketHub(self)
        self.engine.on_state_change = lambda: self.ws_hub.broadcast()
        self.engine.on_audio_chunk = self.ws_hub.broadcast_audio_chunk
        super().__init__(server_address, RequestHandlerClass)


def run_unix_socket_listener(engine: AudioEngine, socket_path: str = SOCKET_PATH):
    """Listens on local unix domain socket for instant synchronous IPC from CLI tools."""
    if os.path.exists(socket_path):
        try:
            os.unlink(socket_path)
        except Exception:
            pass

    server_sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        server_sock.bind(socket_path)
        server_sock.listen(10)
        while engine.running:
            try:
                r, _, _ = select.select([server_sock], [], [], 1.0)
                if not r:
                    continue
                conn, _ = server_sock.accept()
                with conn:
                    data = conn.recv(4096).decode("utf-8")
                    if data:
                        try:
                            cmd = json.loads(data)
                            engine.post_command(cmd)
                            conn.sendall(b'{"status":"ok"}\n')
                        except Exception as e:
                            conn.sendall(f'{{"error":"{e}"}}\n'.encode("utf-8"))
            except Exception:
                pass
    finally:
        try:
            os.unlink(socket_path)
        except Exception:
            pass
