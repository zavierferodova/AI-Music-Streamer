---
name: music-streamer
description: Search, play, queue, pause, resume, volume, loop, and broadcast control for local ALSA and continuous HTTP live music streaming via ~/music-streamer Python suite and SQLite database
license: MIT
compatibility: opencode, antigravity
metadata:
  audience: human+ai
  domain: audio
  runtime: python3
---

## What I do

Control local music playback and 24/7 continuous HTTP MP3 live audio streaming on this Ubuntu server via the `~/music-streamer/` Python suite backed by an SQLite database.
All audio is decoded from YouTube (or SoundCloud/Bandcamp) via `yt-dlp` → `ffmpeg` and concurrently fed in exact synchronization to:
1. **Server Speaker (ALSA)** on device `default` (when in `speaker` mode)
2. **Continuous HTTP Live Stream** broadcasted at `http://<SERVER_IP>:8000/stream.mp3`

### Key Features
- **24/7 Always-On Live Stream**: HTTP clients stay connected continuously. When music is stopped, paused, or transitioning between songs, the server broadcasts real-time comfort silence at 128 kbps (44.1 kHz stereo).
- **Exact Server-Client Synchronization**: Audio heard on the server speaker and audio broadcast to connected clients are fed simultaneously from the same PCM buffer.
- **SQLite Database Persistence**: Robust transactional state store (`runtime/music_streamer.db` in `WAL` mode) for tracks, fair shuffle cycle state, volume, loop, and security settings.
- **Multi-Client Broadcast**: Multiple listeners/devices can connect simultaneously with minimal latency.
- **Full CLI & Web Controls**: Play, search, queue, pause, resume, shuffle, skip, loop, and adjust volume seamlessly.

---

## Python CLI Tools Overview

| Script | Purpose |
|---|---|
| `~/music-streamer/stream.py` | Manage continuous broadcast server: `start`, `stop`, `status`, `--mode speaker\|silent`, `--daemon` |
| `~/music-streamer/web/index.html` | Realtime Web Control Panel & audio player (`/` & `/ws` WebSocket sync) |
| `~/music-streamer/play.py` | Play a direct URL: `<URL> [VOL 0-100] [LOOP yes\|no]` — synchronized on speaker & HTTP stream |
| `~/music-streamer/play_search.py` | Search by query and play first result: `<query> [VOL] [LOOP]` — USE ONLY AFTER CONFIRMATION |
| `~/music-streamer/search.py` | Search provider: `youtube` (default), `soundcloud`, `bandcamp`, `spotify` |
| `~/music-streamer/playback.py` | Persistent Playback tracklist: `add/add-url/list/clear/shuffle/remove/next/play` |
| `~/music-streamer/pause.py` | Pause: mutes ALSA speaker and streams silence to clients |
| `~/music-streamer/resume.py` | Resume: unmutes ALSA speaker and resumes audio stream in sync |
| `~/music-streamer/volume.py` | Get/set/mute/unmute volume (synced with Master: `+N`/`-N`, `mute`, `unmute`, absolute `0-100`) |
| `~/music-streamer/loop.py` | Live toggle loop: `[yes\|no\|toggle\|status]` — takes effect after current track |
| `~/music-streamer/otp.py` | One-Time Password (OTP) security manager: `show`, `new`, `on`, `off`, `sessions` |
| `~/music-streamer/status.py` | Show player state, now playing, volume, loop, queue, next track, stream server info (`--json`) |
| `~/music-streamer/stop.py` | Stop playback (stream switches to silence; use `--all` to stop the daemon server) |

---

## When to use me

Use this skill whenever the user asks to:
- play / search / queue / shuffle music
- stream music to remote devices (laptop, phone, browser)
- pause / resume / stop / next / interrupt playback
- adjust volume (including mute/unmute, +N/-N) or loop setting
- check what is playing, queue status, or streaming listeners

Trigger phrases: "play music", "stream music", "search music", "queue", "shuffle", "next", "interrupt", "pause", "resume", "volume", "loop", "stop music", "what's playing", "stream status".

---

## How to use — AI Agent Workflow

### 1. Start Stream Server (if not running)
```bash
# Start background broadcast daemon (mode: speaker + HTTP stream in sync)
~/music-streamer/stream.py --daemon --mode speaker --port 8000

# Or silent mode (HTTP stream broadcast only, server speaker silent)
~/music-streamer/stream.py --daemon --mode silent --port 8000
```

### 2. Search
```bash
# JSON format for AI agents (UTF-8 safe, structured)
~/music-streamer/search.py --json "Denny Caknan Wirang" 3
# Output:
# {"query":"...","provider":"youtube","count":3,"results":[{"id":"...","title":"...","url":"..."}]}

# Shortcuts (pipeable)
~/music-streamer/search.py --first "Denny Caknan Wirang"  # -> URL
~/music-streamer/search.py --id 1 "Denny Caknan"          # -> ID
~/music-streamer/search.py --url 2 "Denny Caknan"         # -> URL
```

### 3. Confirm (MANDATORY for vague / user search queries)
When a user asks to play a search query, search via `search.py --json` and present the options using `ask_question` (or question modal) before starting playback.

**Correct Flow:**
```bash
# 1. Search
~/music-streamer/search.py --json "Wirang" 5
# 2. Ask user via question tool with selectable options
# 3. Play the selected confirmed URL
~/music-streamer/play.py "https://www.youtube.com/watch?v=78Y0SxVVxP4" 80 yes
```

### 4. Play Direct URL
```bash
# Direct URL provided by user (no search confirmation needed)
~/music-streamer/play.py "https://www.youtube.com/watch?v=78Y0SxVVxP4" 80 yes

# If volume is omitted, it defaults to the system Master volume
~/music-streamer/play.py "https://www.youtube.com/watch?v=78Y0SxVVxP4"
```

### 5. Control While Playing (Live, no restart needed)
```bash
# Status
~/music-streamer/status.py                  # Human-readable
~/music-streamer/status.py --json           # JSON format for AI

# Volume control
~/music-streamer/volume.py                  # Show volume
~/music-streamer/volume.py 75               # Set absolute volume (0-100)
~/music-streamer/volume.py +10              # Increase volume by 10%
~/music-streamer/volume.py -10              # Decrease volume by 10%
~/music-streamer/volume.py mute             # Mute ALSA speaker
~/music-streamer/volume.py unmute           # Unmute ALSA speaker

# Loop control
~/music-streamer/loop.py                    # Show loop status
~/music-streamer/loop.py yes                # Enable repeat (loops track when queue is empty)
~/music-streamer/loop.py no                 # Disable repeat (one-shot, stops after track)
~/music-streamer/loop.py toggle             # Flip loop setting

# Playback list management
~/music-streamer/playback.py list [--json]     # Show full tracklist (Played, Playing, Upcoming)
~/music-streamer/playback.py add "Alan Walker" # Search & append first result to playback list
~/music-streamer/playback.py add-url "URL" "Title" # Append specific confirmed URL
~/music-streamer/playback.py shuffle           # Randomize unplayed tracks (preserves played history)
~/music-streamer/playback.py remove 2          # Remove 2nd track from list
~/music-streamer/playback.py reset-history     # Reset played tracks to unplayed for fresh replay
~/music-streamer/playback.py clear             # Clear entire playback list
~/music-streamer/playback.py next              # Skip current track, play next in list
~/music-streamer/playback.py play 1            # Jump directly to track #1

# Playback state
~/music-streamer/pause.py                   # Pause playback (streams silence to clients)
~/music-streamer/resume.py                  # Resume playback
~/music-streamer/stop.py                    # Stop music (clients stay connected receiving silence)
~/music-streamer/stop.py --all              # Stop music AND shut down stream server daemon
```

### 6. Client Listening
Listeners on other devices (laptops, phones, browsers) can tune in:
- **Web Control Panel & Player**: Open `http://<SERVER_IP>:8000/` in any browser (realtime WebSocket sync)
- **Direct Media Stream**: Open `http://<SERVER_IP>:8000/stream.mp3` in VLC / mpv / browser audio

---

## Environment Overrides

| Var | Default | Purpose |
|---|---|---|
| `ALSA_DEVICE` | `default` | ALSA audio sink device |
| `NODE_BIN` | `~/.nvm/versions/node/v24.19.0/bin/node` | Node.js binary for yt-dlp JS challenges |
| `PROVIDER` | `youtube` | Default search provider |

---

## File Structure

```
~/music-streamer/
  music_streamer/   # Core Python package
    db.py           # SQLite database persistence layer (WAL mode)
    config.py       # Constants, paths, audio parameters
    security.py     # OTP authentication & session token manager
    playback.py     # Persistent playback list & fair shuffle cycle engine
    search.py       # Universal music search (YouTube, SoundCloud, Bandcamp, Spotify)
    engine.py       # AudioEngine (PCM decoder + ALSA sync + silence stream) & Broadcaster
    ipc.py          # Synchronous Unix domain socket & REST API IPC client
    server.py       # Threaded HTTP Server, WebSocket Hub (RFC 6455), REST API
    cli.py          # Unified CLI subcommands & handlers
  stream.py         # Daemon management (start/stop/status/speaker/silent)
  play.py           # Start playback (synced speaker + broadcast)
  play_search.py    # Search & play first result
  search.py         # Universal music search (text/json/url/id)
  playback.py       # Persistent playback list management
  pause.py          # Pause playback (mutes ALSA + streams silence)
  resume.py         # Resume playback
  volume.py         # Master volume control
  loop.py           # Live loop toggle (yes|no|toggle|status)
  otp.py            # One-Time Password (OTP) security manager
  status.py         # Full status inspector
  stop.py           # Stop playback (keeps stream alive in silence mode; --all kills daemon)
  tests/            # Automated test suite
  web/index.html    # Realtime Web Control Panel UI (HTML + CSS + JS)
  runtime/
    music_streamer.db # SQLite database file (WAL mode)
    control.sock      # UNIX domain socket IPC
    stream_server.log # Stream server daemon logs
    player.log        # Decoder logs
```
