"""
Central configuration, paths, audio constants, and system environment defaults.
"""

import os
from pathlib import Path

# Paths
ROOT_DIR = Path(__file__).resolve().parent.parent
RUNTIME_DIR = ROOT_DIR / "runtime"
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = RUNTIME_DIR / "music_streamer.db"
SOCKET_PATH = str(RUNTIME_DIR / "control.sock")
WEB_DIR = ROOT_DIR / "web"
INDEX_HTML_PATH = WEB_DIR / "index.html"

PID_FILE = RUNTIME_DIR / "stream_server.pid"
PLAYER_PID_FILE = RUNTIME_DIR / "player.pid"
PLAYER_LOG_FILE = RUNTIME_DIR / "player.log"
SERVER_LOG_FILE = RUNTIME_DIR / "stream_server.log"
TUNNEL_PID_FILE = RUNTIME_DIR / "tunnel.pid"
TUNNEL_LOG_FILE = RUNTIME_DIR / "tunnel.log"

# Audio Constants (CD Quality 44.1 kHz, 16-bit stereo)
SAMPLE_RATE = 44100
CHANNELS = 2
BYTES_PER_SAMPLE = 2  # 16-bit signed integer (s16le)
BYTES_PER_FRAME = CHANNELS * BYTES_PER_SAMPLE  # 4 bytes
CHUNK_FRAMES = 2205  # 50ms chunks (44100 * 0.05)
CHUNK_BYTES = CHUNK_FRAMES * BYTES_PER_FRAME  # 8820 bytes
CHUNK_DURATION = CHUNK_FRAMES / SAMPLE_RATE  # 0.05 seconds
SILENCE_CHUNK = b"\x00" * CHUNK_BYTES

# Network & Server Constants
DEFAULT_PORT = 8000
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
SESSION_DURATION_SECONDS = 86400 * 7  # 7 days

# Binary / Environment Overrides
DEFAULT_ALSA_DEVICE = os.environ.get("ALSA_DEVICE", "default")
NODE_BIN = os.environ.get("NODE_BIN", str(Path.home() / ".nvm/versions/node/v24.19.0/bin/node"))
YTDL_BIN = os.environ.get("YTDL", "/usr/bin/yt-dlp")
