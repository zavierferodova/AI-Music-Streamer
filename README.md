# music-streamer

Modern, fully-synchronized Python audio streaming & playback suite for Ubuntu.
Stream audio from YouTube, SoundCloud, Bandcamp, or direct URLs to your local ALSA server speaker and 24/7 continuous HTTP MP3 live broadcast in exact synchronization, backed by an SQLite database state store (`WAL` mode), REST API, and realtime WebSocket control panel.

## Architecture & Key Features

- **100% Python Modular Suite**: Fully synchronized core package (`music_streamer`) with SQLite state store, audio engine, multi-client broadcaster, and CLI tools.
- **SQLite Database Persistence**: Robust transactional state store (`music_streamer.db` in `WAL` mode) for playback tracks, fair shuffle cycle state, settings, and OTP sessions.
- **24/7 Always-On Live Stream**: HTTP clients stay connected indefinitely to `http://<SERVER_IP>:8000/stream.mp3` even when music is stopped, paused, or transitioning between songs (continuous comfort silence broadcast).
- **Exact Server-Client Synchronization**: Audio output to the server speaker (via ALSA) and the HTTP MP3 stream broadcast to remote clients are fed simultaneously from the exact same decoded PCM stream.
- **Realtime Web Panel & Player**: Built-in responsive HTML5 web control panel and live audio player with WebSocket real-time synchronization across devices (`http://<SERVER_IP>:8000/`).
- **OTP Security**: One-Time Password passcode authentication with session tokens for private streams.
- **Test-Driven Design**: Comprehensive test suite covering SQLite persistence, search providers, playback lifecycle, OTP security, audio engine buffers, and synchronous IPC.

---

## Requirements & Linux System Libraries

This project requires Python 3.10+ and standard Linux audio/media libraries:

### Required Linux Packages & Libraries
- **`ffmpeg`**: Audio decoding from media streams and continuous MP3 live broadcast encoding.
- **`alsa-utils`**: Hardware ALSA sound control (`aplay` for speaker playback and `amixer` for volume/mute control).
- **`libasound2` & `libasound2-plugins`**: Core Linux ALSA sound architecture runtime libraries and device plugins.
- **`yt-dlp`**: Fast audio extractor supporting YouTube, SoundCloud, Bandcamp, and direct media URLs.
- **`nodejs` / `node`**: JavaScript runtime engine utilized by `yt-dlp` to solve extraction challenges.
- **`python3-venv` & `python3-pip`**: Python virtual environment and package installer.

### Optional Tools
- **`cloudflared`**: For instant zero-config public HTTPS tunneling (`./stream.py --public` / `./stream.py public`).
- **`mpv`**: Lightweight CLI audio player for testing stream playback.

### 1. Install Linux System Dependencies

**Ubuntu / Debian:**
```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip ffmpeg alsa-utils libasound2 libasound2-plugins yt-dlp nodejs mpv curl
```

**Arch Linux:**
```bash
sudo pacman -S python python-pip ffmpeg alsa-utils alsa-lib yt-dlp nodejs mpv curl
```

### 2. Python Virtual Environment Setup

```bash
# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

---

## Python CLI Tools

| Tool | Purpose |
| --- | --- |
| `./stream.py` | Manage continuous broadcast server: `start`, `stop`, `status`, `--mode speaker\|silent`, `--daemon` |
| `web/` | Next.js 15 & Tailwind CSS realtime Web Control Panel and live stream player (`/` & `/ws`) |
| `./play.py` | Start playback: `<URL> [VOL 0-100] [LOOP yes\|no]` — plays in sync on speaker & stream |
| `./play_search.py` | Search by query and immediately play first result |
| `./search.py` | Search YouTube/SoundCloud/Bandcamp, return IDs/titles/URLs (`--json`, `--first`) |
| `./playback.py` | Ephemeral Playback tracklist: `add/add-url/list/clear/shuffle/remove/next/prev/play` |
| `./prev.py` | Play previous track from playback history / loop wrap |
| `./playlist.py` | Persistent Named Playlists: `create/list/show/add/remove/delete/play/queue` |
| `./pause.py` | Pause playback (mutes ALSA speaker and streams silence to clients) |
| `./resume.py` | Resume playback (unmutes ALSA and resumes audio stream) |
| `./volume.py` | Show / set / mute / unmute volume (`0-100`, `+N`, `-N`, `mute`, `unmute`) |
| `./loop.py` | Live toggle loop: `[yes\|no\|toggle\|status]` |
| `./otp.py` | One-Time Password (OTP) security manager: `show`, `new`, `on`, `off`, `sessions` |
| `./status.py` | Show full status: player state, stream server, volume, queue, next track (`--json`) |
| `./stop.py` | Stop playback (switches stream to silence mode; use `--all` to shut down server) |

---

## Quick Start

### 1. Start Continuous Broadcast Stream
```bash
# Start stream server in background (default: silent mode, HTTP stream only)
./stream.py --daemon --port 8000

# Or start in speaker sync mode (unmutes local machine speaker as well)
./stream.py --daemon --mode speaker --port 8000
```

### 2. Connect Web Player & Listen Live (Laptop / Phone / Any Browser)
Open in any browser:
- Web Control Panel & Audio Player: `http://<SERVER_IP>:8000/`
- Direct MP3 Audio Stream: `http://<SERVER_IP>:8000/stream.mp3`

### 3. Control Music Playback
```bash
# Search and play
./play_search.py "Denny Caknan Wirang" 80

# Or play direct URL
./play.py "https://www.youtube.com/watch?v=78Y0SxVVxP4" 80 yes

# Add songs to playback list
./playback.py add "Alan Walker On My Way"
./playback.py list
./playback.py next

# Pause / Resume / Volume
./pause.py
./resume.py
./volume.py 75
./volume.py +10

# Stop music (stream client stays connected and receives silence)
./stop.py

# Stop everything including stream server daemon
./stop.py --all
```

---

## Running Tests

Run the full automated test suite using `pytest`:

```bash
.venv/bin/pytest tests/ -v
```
