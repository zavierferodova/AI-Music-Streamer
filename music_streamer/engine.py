"""
Core Audio Engine (PCM decoding, ALSA sync, silence stream) and Multi-Client Broadcaster.
"""

import os
import queue
import re
import signal
import subprocess
import sys
import threading
import time
from typing import Callable, Dict, Optional, Set

from music_streamer.config import (
    BYTES_PER_FRAME,
    CHUNK_BYTES,
    CHUNK_DURATION,
    DEFAULT_ALSA_DEVICE,
    NODE_BIN,
    PLAYER_LOG_FILE,
    SAMPLE_RATE,
    CHANNELS,
    SILENCE_CHUNK,
)
from music_streamer.db import DatabaseManager, db
from music_streamer.playback import PlaybackManager, get_thumbnail_for_url, playback_mgr


class Broadcaster:
    """Thread-safe fan-out broadcaster for distributing MP3 stream to multiple HTTP clients."""

    def __init__(self, max_buffer_bytes: int = 8192):
        self.subscribers: Set[queue.Queue] = set()
        self.lock = threading.Lock()
        self.recent_buffer = bytearray()
        self.max_buffer_bytes = max_buffer_bytes

    def subscribe(self) -> queue.Queue:
        q = queue.Queue(maxsize=120)
        with self.lock:
            if self.recent_buffer:
                try:
                    q.put_nowait(bytes(self.recent_buffer))
                except queue.Full:
                    pass
            self.subscribers.add(q)
        return q

    def unsubscribe(self, q: queue.Queue):
        with self.lock:
            self.subscribers.discard(q)

    def broadcast(self, data: bytes):
        if not data:
            return
        with self.lock:
            self.recent_buffer.extend(data)
            if len(self.recent_buffer) > self.max_buffer_bytes:
                self.recent_buffer = self.recent_buffer[-self.max_buffer_bytes :]

            dead_subs = []
            for q in self.subscribers:
                try:
                    q.put_nowait(data)
                except queue.Full:
                    try:
                        q.get_nowait()
                        q.put_nowait(data)
                    except Exception:
                        dead_subs.append(q)

            for q in dead_subs:
                self.subscribers.discard(q)

    def client_count(self) -> int:
        with self.lock:
            return len(self.subscribers)


class AudioEngine:
    """
    Central audio playback and encoding engine.
    - Continuous MP3 encoder for the live HTTP stream.
    - Raw PCM decoding from audio sources (yt-dlp -> ffmpeg).
    - Tightly synchronizes ALSA speaker output and HTTP broadcast.
    - 24/7 Comfort silence stream generator when idle, paused, or transitioning.
    """

    def __init__(
        self,
        database: Optional[DatabaseManager] = None,
        broadcaster: Optional[Broadcaster] = None,
        mode: str = "silent",
    ):
        self.db = database or db
        self.broadcaster = broadcaster or Broadcaster()
        self.playback_mgr = PlaybackManager(self.db)

        self.mode = mode or self.db.get_setting("mode", "silent")
        self.state = "stopped"
        self.current_url = ""
        self.current_title = ""
        self.current_thumbnail = ""
        self.original_url = ""
        self.original_title = ""
        self.original_thumbnail = ""
        self.volume = self.db.get_int_setting("volume", default=80)
        self.loop = self.db.get_setting("loop", default="yes")
        self.track_start_time: Optional[float] = None
        self.last_error: Optional[dict] = None
        self.is_buffering: bool = False
        self.chunks_played: int = 0

        self.lock = threading.Lock()
        self.running = True

        # Process references
        self.encoder_proc: Optional[subprocess.Popen] = None
        self.decoder_proc: Optional[subprocess.Popen] = None
        self.alsa_proc: Optional[subprocess.Popen] = None

        # Control flags & queues
        self.action_event = threading.Event()
        self.command_queue = queue.Queue()

        # State change callback for WebSocket hub
        self.on_state_change: Optional[Callable[[], None]] = None

        # Background threads
        self.encoder_thread = threading.Thread(target=self._run_encoder_pipeline, daemon=True)
        self.audio_loop_thread = threading.Thread(target=self._run_master_audio_loop, daemon=True)

        self._sync_runtime_state()

    def notify_state_change(self):
        if self.on_state_change:
            try:
                self.on_state_change()
            except Exception:
                pass

    def _sync_runtime_state(self):
        """Persists current runtime state to SQLite."""
        try:
            self.db.set_setting("state", self.state)
            self.db.set_setting("volume", str(self.volume))
            self.db.set_setting("loop", self.loop)
            self.db.set_setting("mode", self.mode)
            self.db.set_setting("current_url", self.current_url)
            self.db.set_setting("current_title", self.current_title)
            self.db.set_setting("current_thumbnail", self.current_thumbnail)
        except Exception as e:
            print(f"[AudioEngine] Error syncing DB state: {e}", file=sys.stderr)

        self.notify_state_change()

    def start(self):
        self.encoder_thread.start()
        self.audio_loop_thread.start()

    def set_mode(self, mode: str):
        with self.lock:
            self.mode = mode
            if mode == "silent":
                self._close_alsa_sink()
            self._sync_runtime_state()
            print(f"[AudioEngine] Mode set to: {mode}")

    def post_command(self, cmd: dict):
        self.command_queue.put(cmd)
        self.action_event.set()

    def _fetch_title_async(self, url: str):
        """Asynchronously fetch title and thumbnail without blocking playback start."""

        def worker():
            try:
                from music_streamer.search import fetch_track_metadata

                meta = fetch_track_metadata(url)
                title = meta.get("title") or url
                thumb = meta.get("thumbnail") or get_thumbnail_for_url(url)
                with self.lock:
                    if self.current_url == url:
                        self.current_title = title
                        self.current_thumbnail = thumb
                        self._sync_runtime_state()
                        # Update playing track in DB
                        tracks = self.db.get_tracks(status="playing")
                        for t in tracks:
                            if t.get("url") == url:
                                self.db.update_track_info(t["id"], title=title, thumbnail=thumb)
                if self.on_state_change:
                    self.on_state_change()
            except Exception:
                pass

        threading.Thread(target=worker, daemon=True).start()

    def _run_encoder_pipeline(self):
        """Persistent ffmpeg process encoding PCM s16le -> MP3 broadcast chunks."""
        while self.running:
            ffmpeg_cmd = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-fflags",
                "nobuffer",
                "-flags",
                "low_delay",
                "-f",
                "s16le",
                "-ar",
                str(SAMPLE_RATE),
                "-ac",
                str(CHANNELS),
                "-i",
                "pipe:0",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "128k",
                "-flush_packets",
                "1",
                "-muxdelay",
                "0",
                "-f",
                "mp3",
                "pipe:1",
            ]
            try:
                self.encoder_proc = subprocess.Popen(
                    ffmpeg_cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    bufsize=0,
                )

                while self.running and self.encoder_proc.poll() is None:
                    chunk = self.encoder_proc.stdout.read(4096)
                    if not chunk:
                        break
                    self.broadcaster.broadcast(chunk)

            except Exception as e:
                print(f"[AudioEngine] Encoder error: {e}", file=sys.stderr)
            finally:
                if self.encoder_proc:
                    try:
                        self.encoder_proc.terminate()
                    except Exception:
                        pass
                    self.encoder_proc = None
            if self.running:
                time.sleep(0.2)

    def _open_alsa_sink(self) -> Optional[subprocess.Popen]:
        """Open ALSA output process for server speaker playback."""
        if self.alsa_proc and self.alsa_proc.poll() is None:
            return self.alsa_proc
        try:
            device = os.environ.get("ALSA_DEVICE", DEFAULT_ALSA_DEVICE)
            cmd = ["aplay", "-D", device, "-f", "cd", "-t", "raw", "-q"]
            self.alsa_proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                bufsize=0,
            )
            return self.alsa_proc
        except Exception as e:
            print(f"[AudioEngine] Error opening ALSA sink: {e}", file=sys.stderr)
            return None

    def _close_alsa_sink(self):
        """Close ALSA output process."""
        if self.alsa_proc:
            try:
                if self.alsa_proc.stdin:
                    self.alsa_proc.stdin.close()
                self.alsa_proc.terminate()
                self.alsa_proc.wait(timeout=0.5)
            except Exception:
                pass
            self.alsa_proc = None

    def _feed_alsa(self, raw_pcm: bytes):
        """Feed raw PCM audio chunk to ALSA aplay sink."""
        if not self.alsa_proc or self.alsa_proc.poll() is not None:
            self._open_alsa_sink()
        if self.alsa_proc and self.alsa_proc.stdin:
            try:
                self.alsa_proc.stdin.write(raw_pcm)
            except Exception:
                self._close_alsa_sink()

    def _set_alsa_volume(self, vol: int):
        """Set ALSA master volume via amixer."""
        try:
            subprocess.run(
                ["amixer", "-q", "set", "Master", f"{vol}%", "unmute"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        except Exception:
            pass

    def _start_decoder(self, url: str) -> subprocess.Popen:
        """Start decoding pipeline: yt-dlp piped into ffmpeg outputting raw PCM."""
        log_path = str(PLAYER_LOG_FILE)
        shell_cmd = (
            f"yt-dlp -q --no-warnings --no-update --js-runtimes 'node:{NODE_BIN}' "
            f"--remote-components ejs:github --extractor-args 'youtube:player_client=mweb' "
            f"-f '18/bestaudio/best' --no-playlist -o - '{url}' 2>>'{log_path}' "
            f"| ffmpeg -hide_banner -loglevel error -fflags +genpts -i pipe:0 -vn -f s16le -ar {SAMPLE_RATE} -ac {CHANNELS} pipe:1 2>>'{log_path}'"
        )
        self.track_start_time = time.time()
        self.is_buffering = True
        self.chunks_played = 0
        proc = subprocess.Popen(
            ["bash", "-c", shell_cmd],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            bufsize=CHUNK_BYTES * 4,
            preexec_fn=os.setsid,
        )
        return proc

    def _stop_decoder(self):
        self.is_buffering = False
        if self.decoder_proc:
            try:
                pgid = os.getpgid(self.decoder_proc.pid)
                os.killpg(pgid, signal.SIGTERM)
                self.decoder_proc.terminate()
                self.decoder_proc.wait(timeout=1.0)
            except Exception:
                try:
                    pgid = os.getpgid(self.decoder_proc.pid)
                    os.killpg(pgid, signal.SIGKILL)
                except Exception:
                    pass
            self.decoder_proc = None

    def _pause_decoder(self):
        self.is_buffering = False
        if self.decoder_proc:
            try:
                pgid = os.getpgid(self.decoder_proc.pid)
                os.killpg(pgid, signal.SIGSTOP)
            except Exception:
                pass

    def _resume_decoder(self):
        if self.decoder_proc:
            try:
                pgid = os.getpgid(self.decoder_proc.pid)
                os.killpg(pgid, signal.SIGCONT)
            except Exception:
                pass

    def _process_commands(self):
        """Process all queued IPC commands immediately."""
        while not self.command_queue.empty():
            try:
                cmd = self.command_queue.get_nowait()
            except queue.Empty:
                break

            action = cmd.get("action")
            if action in ["play", "interrupt", "playback_play", "queue_play", "skip", "next", "prev", "previous", "playback_prev"]:
                self.last_error = None

            if action == "play":
                url = cmd.get("url")
                title = cmd.get("title", "")
                vol = cmd.get("volume")
                loop = cmd.get("loop")
                if vol is not None:
                    self.volume = int(vol)
                if loop is not None:
                    self.loop = loop

                if url:
                    self.original_url = url
                    self.original_title = title or url
                    self.original_thumbnail = get_thumbnail_for_url(url)
                    self.current_url = self.original_url
                    self.current_title = self.original_title
                    self.current_thumbnail = self.original_thumbnail
                    self.playback_mgr.mark_playing_url(url, self.original_title, self.original_thumbnail)
                    if not title:
                        self._fetch_title_async(url)
                else:
                    nxt, _ = self.playback_mgr.get_next_track_for_playback(loop=self.loop in ["yes", "1", "true", "on"])
                    if nxt:
                        self.current_url = nxt["url"]
                        self.current_title = nxt["title"]
                        self.current_thumbnail = nxt.get("thumbnail") or get_thumbnail_for_url(nxt["url"])
                    elif self.original_url:
                        self.current_url = self.original_url
                        self.current_title = self.original_title
                        self.current_thumbnail = self.original_thumbnail
                        self.playback_mgr.mark_playing_url(self.original_url, self.original_title, self.original_thumbnail)

                if self.current_url:
                    self._stop_decoder()
                    self.state = "playing"
                    self._sync_runtime_state()
                    print(f"[AudioEngine] Playing: {self.current_title} ({self.current_url})")
                    self.decoder_proc = self._start_decoder(self.current_url)

            elif action == "pause":
                self.is_buffering = False
                if self.state == "playing":
                    self.state = "paused"
                    self._pause_decoder()
                    self._close_alsa_sink()
                    self._sync_runtime_state()
                    print("[AudioEngine] Paused")

            elif action == "resume":
                self.is_buffering = False
                if self.state == "paused":
                    self.state = "playing"
                    self._resume_decoder()
                    self._sync_runtime_state()
                    print("[AudioEngine] Resumed")

            elif action == "stop":
                self.state = "stopped"
                self.is_buffering = False
                self._stop_decoder()
                self._close_alsa_sink()
                self.playback_mgr.mark_current_finished()
                self.current_url = ""
                self.current_title = ""
                self.current_thumbnail = ""
                self.track_start_time = None
                self._sync_runtime_state()
                print("[AudioEngine] Stopped")

            elif action in ["skip", "next"]:
                self._stop_decoder()
                loop_val = self.db.get_setting("loop", default=self.loop)
                nxt, _ = self.playback_mgr.get_next_track_for_playback(loop=loop_val in ["yes", "1", "true", "on"])
                if nxt:
                    self.current_url = nxt["url"]
                    self.current_title = nxt["title"]
                    self.current_thumbnail = nxt.get("thumbnail") or get_thumbnail_for_url(nxt["url"])
                    self.state = "playing"
                    self._sync_runtime_state()
                    print(f"[AudioEngine] Skipped to: {self.current_title}")
                    self.decoder_proc = self._start_decoder(self.current_url)
                else:
                    self.state = "stopped"
                    self._close_alsa_sink()
                    self.current_url = ""
                    self.current_title = ""
                    self.current_thumbnail = ""
                    self.track_start_time = None
                    self._sync_runtime_state()
                    print("[AudioEngine] End of playback list")

            elif action in ["prev", "previous", "playback_prev"]:
                self._stop_decoder()
                loop_val = self.db.get_setting("loop", default=self.loop)
                prv, _ = self.playback_mgr.get_previous_track_for_playback(loop=loop_val in ["yes", "1", "true", "on"])
                if prv:
                    self.current_url = prv["url"]
                    self.current_title = prv["title"]
                    self.current_thumbnail = prv.get("thumbnail") or get_thumbnail_for_url(prv["url"])
                    self.state = "playing"
                    self._sync_runtime_state()
                    print(f"[AudioEngine] Went back to previous track: {self.current_title}")
                    self.decoder_proc = self._start_decoder(self.current_url)
                else:
                    self.state = "stopped"
                    self._close_alsa_sink()
                    self.current_url = ""
                    self.current_title = ""
                    self.current_thumbnail = ""
                    self.track_start_time = None
                    self._sync_runtime_state()
                    print("[AudioEngine] No previous track available")

            elif action in ["interrupt", "playback_play", "queue_play"]:
                url = cmd.get("url")
                title = cmd.get("title")
                idx = cmd.get("index")
                track_id = cmd.get("id")

                target_track = None
                if track_id is not None:
                    target_track = self.playback_mgr.play_track_by_id(track_id)
                elif idx is not None:
                    target_track = self.playback_mgr.play_track_by_index(int(idx))

                if target_track:
                    url = target_track["url"]
                    title = target_track["title"]
                    thumb = target_track.get("thumbnail")
                else:
                    thumb = get_thumbnail_for_url(url) if url else ""
                    if url:
                        self.playback_mgr.mark_playing_url(url, title or url, thumb)

                if url:
                    self._stop_decoder()
                    self.current_url = url
                    self.current_title = title or url
                    self.current_thumbnail = thumb or get_thumbnail_for_url(url)
                    self.state = "playing"
                    self._sync_runtime_state()
                    print(f"[AudioEngine] Interrupted — Playing: {self.current_title}")
                    self.decoder_proc = self._start_decoder(self.current_url)

            elif action == "set_mode":
                mode = cmd.get("mode", "silent")
                self.set_mode(mode)

            elif action == "set_loop":
                loop_val = cmd.get("loop", "toggle")
                if loop_val == "toggle":
                    cur = (self.loop or self.db.get_setting("loop", "repeat")).lower()
                    if cur in ["repeat", "yes", "all"]:
                        self.loop = "repeat-one"
                    elif cur in ["repeat-one", "repeat_one", "one", "single"]:
                        self.loop = "off"
                    else:
                        self.loop = "repeat"
                elif str(loop_val).lower() in ["repeat-one", "repeat_one", "one", "single"]:
                    self.loop = "repeat-one"
                elif str(loop_val).lower() in ["repeat", "all", "yes", "1", "true", "on"]:
                    self.loop = "repeat"
                else:
                    self.loop = "off"
                self.db.set_setting("loop", self.loop)
                print(f"[AudioEngine] Loop set to: {self.loop}")
                self._sync_runtime_state()

            elif action == "set_volume":
                vol = cmd.get("volume", 80)
                try:
                    self.volume = max(0, min(100, int(vol)))
                    self._set_alsa_volume(self.volume)
                    print(f"[AudioEngine] Volume set to: {self.volume}%")
                    self._sync_runtime_state()
                except Exception:
                    pass

            elif action in ["dismiss_error", "clear_error"]:
                self.last_error = None
                self._sync_runtime_state()

    def _run_master_audio_loop(self):
        """
        Master real-time tick loop (20 iterations/sec @ 50ms intervals).
        Guarantees exact ALSA-Stream synchronization and continuous comfort silence broadcast.
        """
        next_tick = time.monotonic()

        while self.running:
            # 1. Process pending IPC commands
            self._process_commands()

            # 2. Handle active playing state
            if self.state == "playing" and self.decoder_proc:
                raw_pcm = self.decoder_proc.stdout.read(CHUNK_BYTES)

                if raw_pcm:
                    self.is_buffering = False
                    self.chunks_played += 1
                    if len(raw_pcm) == CHUNK_BYTES:
                        # Feed broadcast encoder (stream.mp3)
                        if self.encoder_proc and self.encoder_proc.stdin:
                            try:
                                self.encoder_proc.stdin.write(raw_pcm)
                            except Exception:
                                pass

                        # Feed local ALSA sink if in speaker mode
                        if self.mode == "speaker":
                            self._feed_alsa(raw_pcm)

                        # Precise monotonic clock drift correction
                        next_tick += CHUNK_DURATION
                        now = time.monotonic()
                        delay = next_tick - now
                        if delay > 0:
                            time.sleep(delay)
                        elif delay < -0.2:
                            next_tick = now
                        continue
                else:
                    # Decoder reached EOF / finished track or failed
                    is_error = False
                    duration = time.time() - (self.track_start_time or time.time())
                    if self.chunks_played < 5 or duration < 2.5:
                        is_error = True

                    failed_title = self.current_title
                    failed_url = self.current_url

                    if is_error and failed_url:
                        err_msg = f"Unable to play '{failed_title or failed_url}'. Audio stream could not be loaded."
                        if PLAYER_LOG_FILE.exists():
                            try:
                                log_lines = PLAYER_LOG_FILE.read_text(encoding="utf-8", errors="ignore").splitlines()[-10:]
                                for line in reversed(log_lines):
                                    c = line.strip()
                                    if any(k in c.lower() for k in ["error:", "http error", "unavailable", "private video", "blocked", "sign in"]):
                                        err_msg = f"Playback Error: {c}"
                                        break
                            except Exception:
                                pass

                        self.last_error = {
                            "message": err_msg,
                            "title": failed_title or failed_url,
                            "url": failed_url,
                            "timestamp": time.time(),
                        }
                        print(f"[AudioEngine] Playback failed: {err_msg}", file=sys.stderr)
                    else:
                        print(f"[AudioEngine] Track finished: {self.current_title}")

                    self.is_buffering = False
                    self._stop_decoder()

                    loop_val = str(self.db.get_setting("loop", default=self.loop)).lower()
                    if loop_val in ["repeat-one", "repeat_one", "one", "single"] and self.current_url:
                        print(f"[AudioEngine] Repeat-One active — Replaying: {self.current_title}")
                        self._sync_runtime_state()
                        self.decoder_proc = self._start_decoder(self.current_url)
                        continue

                    self.playback_mgr.mark_current_finished()
                    is_loop_all = loop_val in ["repeat", "all", "yes", "1", "true", "on"]
                    nxt, is_new_cycle = self.playback_mgr.get_next_track_for_playback(loop=is_loop_all)
                    if nxt:
                        self.current_url = nxt["url"]
                        self.current_title = nxt["title"]
                        self.current_thumbnail = nxt.get("thumbnail") or get_thumbnail_for_url(nxt["url"])
                        self._sync_runtime_state()
                        cycle_str = " (New Shuffled Cycle)" if is_new_cycle else ""
                        print(f"[AudioEngine] Auto-playing next track{cycle_str}: {self.current_title}")
                        self.decoder_proc = self._start_decoder(self.current_url)
                        continue
                    else:
                        self.state = "stopped"
                        self._close_alsa_sink()
                        self.current_url = ""
                        self.current_title = ""
                        self.current_thumbnail = ""
                        self.track_start_time = None
                        self._sync_runtime_state()
                        print("[AudioEngine] Playback complete — returning to idle silence stream")

            # 3. Idle / Stopped / Paused: Continuous Real-Time Silence Stream
            if self.encoder_proc and self.encoder_proc.stdin:
                try:
                    self.encoder_proc.stdin.write(SILENCE_CHUNK)
                except Exception:
                    pass

            next_tick += CHUNK_DURATION
            now = time.monotonic()
            delay = next_tick - now
            if delay > 0:
                time.sleep(delay)
            elif delay < -0.2:
                next_tick = now
