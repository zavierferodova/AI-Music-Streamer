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
All audio is decoded from YouTube (or SoundCloud/Bandcamp) via `yt-dlp` → `ffmpeg` and concurrently fed to:
1. **Real-Time WebSocket Web Audio Stream (Sub-100ms Sync)** broadcasted via `/ws` directly to browser `AudioContext`
2. **Continuous HTTP MP3 Stream** broadcasted at `http://<SERVER_IP>:8000/stream.mp3` (for VLC, mpv, and legacy players)
3. **Server Speaker (ALSA)** on device `default` (when explicitly switched to `speaker` mode)

### Key Features
- **True Sub-100ms Real-Time Sync**: Direct raw PCM (44.1 kHz, 16-bit stereo) streamed over WebSocket (`/ws`) directly into browser `AudioContext` scheduled time, achieving < 50–100ms lockstep delay matching the server speaker without HTML5 `<audio>` 2–3s buffer delay.
- **Default Silent Broadcast Mode**: By default, the server runs in `silent` mode (HTTP stream broadcast only, keeping server hardware speaker silent).
- **24/7 Always-On Live Stream**: HTTP clients stay connected continuously. When music is stopped, paused, or transitioning between songs, the server broadcasts real-time comfort silence at 128 kbps (44.1 kHz stereo).
- **Zero-Downtime Dynamic Mode Switching**: Switch between `silent` (default) and `speaker` mode on the fly via Web UI or CLI (`./stream.py speaker` / `./stream.py silent`) without restarting the server or interrupting listeners.
- **Exact Server-Client Synchronization**: When in `speaker` mode, audio heard on the server speaker, Web Audio WebSocket clients, and MP3 stream clients are fed simultaneously from the same PCM buffer.
- **SQLite Database Persistence & Deduplication**: Robust transactional state store (`runtime/music_streamer.db` in `WAL` mode) for tracks, fair shuffle cycle state, volume, loop, named playlists, and security settings with strict track deduplication.
- **Real-Time Web Panel & Loading UX**: Glassmorphic UI with top progress bar, skeleton placeholders, audio buffering indicators, playback error diagnostics with Retry/Skip actions, and WebSocket live updates.
- **Multi-Client Broadcast**: Multiple listeners/devices can connect simultaneously with minimal latency.
- **Full CLI & Web Controls**: Play, search, queue, pause, resume, shuffle, skip, loop, and adjust volume seamlessly.

---

## Python CLI Tools Overview

| Script | Purpose |
|---|---|
| `~/music-streamer/stream.py` | Manage continuous broadcast server: `start`, `stop`, `status`, `speaker`, `silent`, `--mode silent\|speaker` (default: `silent`), `--daemon` |
| `~/music-streamer/web/` | Realtime Web Control Panel & audio player (`/` & `/ws` WebSocket sync) with loading states & error alerts |
| `~/music-streamer/play.py` | Play a direct URL: `<URL> [VOL 0-100] [LOOP yes\|no]` — plays on HTTP stream (and speaker if in speaker mode) |
| `~/music-streamer/play_search.py` | Search by query and play first result: `<query> [VOL] [LOOP]` — USE ONLY AFTER CONFIRMATION |
| `~/music-streamer/search.py` | Search provider: `youtube` (default), `soundcloud`, `bandcamp`, `spotify` |
| `~/music-streamer/playback.py` | Ephemeral Playback tracklist: `add/add-url/list/clear/shuffle/remove/next/prev/play` (deduplicated) |
| `~/music-streamer/prev.py` | Play previous track from playback history / loop wrap |
| `~/music-streamer/playlist.py` | Persistent Named Playlists: `create/list/show/add/remove/delete/play/queue` (deduplicated, persistent) |
| `~/music-streamer/pause.py` | Pause: pauses playback and streams comfort silence to clients |
| `~/music-streamer/resume.py` | Resume: resumes audio stream decoding in sync |
| `~/music-streamer/volume.py` | Get/set/mute/unmute volume (synced with Master: `+N`/`-N`, `mute`, `unmute`, absolute `0-100`) |
| `~/music-streamer/loop.py` | Live toggle loop: `[repeat|repeat-one|off|toggle|status]` (`repeat`=all tracks in order/shuffle, `repeat-one`=single track) |
| `~/music-streamer/otp.py` | Two-Tier OTP security manager (Admin: full control & playlists; Subscriber: stream & track view only): `show`, `new [admin|subscriber]`, `on`, `off`, `sessions` |
| `~/music-streamer/status.py` | Show player state, now playing, volume, loop, queue, next track, stream server info (`--json`) |
| `~/music-streamer/stop.py` | Stop playback (stream switches to silence; use `--all` to stop the daemon server) |

---

## When to use me

Use this skill whenever the user asks to:
- play / search / queue / shuffle music
- stream music to remote devices (laptop, phone, browser)
- switch modes between speaker and silent (without restarting server)
- pause / resume / stop / next / prev / previous / interrupt playback
- manage playlists (create, list, show, add, remove, delete, play, queue)
- adjust volume (including mute/unmute, +N/-N) or loop setting
- check what is playing, queue status, or streaming listeners

Trigger phrases: "play music", "stream music", "search music", "queue", "shuffle", "next", "interrupt", "pause", "resume", "volume", "loop", "mode", "speaker", "silent", "stop music", "what's playing", "stream status".

---

## How to use — AI Agent Workflow

### 1. Start Stream Server (if not running)
```bash
# Start background broadcast daemon (default: silent mode, HTTP stream only)
~/music-streamer/stream.py --daemon --port 8000

# Or start with instant worldwide public HTTPS tunnel
~/music-streamer/stream.py --daemon --public --port 8000

# Or explicitly start in speaker sync mode (unmutes local machine speaker as well)
~/music-streamer/stream.py --daemon --mode speaker --port 8000
```

### 2. Switch Audio Mode & Public Streaming On-The-Fly
```bash
# Start/show public worldwide HTTPS tunnel URLs for active server
~/music-streamer/stream.py public

# Switch to silent mode (default: mutes local speaker, continuous HTTP stream stays alive)
~/music-streamer/stream.py silent

# Switch to speaker mode (unmutes local speaker, synced with live stream)
~/music-streamer/stream.py speaker
```

### 3. Search & Local-First Discovery Protocol
Before playing any music query requested by the user, **ALWAYS search first via `search.py --json`**:
```bash
# JSON format for AI agents (returns both local_matches and web_results in one call)
~/music-streamer/search.py --json "Wirang" 5
```
**Example JSON Output:**
```json
{
  "query": "Wirang",
  "local_count": 1,
  "local_matches": [
    {
      "url": "https://www.youtube.com/watch?v=78Y0SxVVxP4",
      "title": "Denny Caknan - Wirang (Official Music Video)",
      "playlist_name": "Top Pop Hits",
      "source_label": "Playlist: Top Pop Hits"
    }
  ],
  "web_count": 5,
  "web_results": [
    {
      "id": "fBnqChaU-ck",
      "title": "GuyonWaton - Wirang (Official Music Video)",
      "url": "https://www.youtube.com/watch?v=fBnqChaU-ck"
    },
    {
      "id": "78Y0SxVVxP4",
      "title": "Denny Caknan - Wirang (Official Music Video)",
      "url": "https://www.youtube.com/watch?v=78Y0SxVVxP4"
    }
  ]
}
```

### 4. Mandatory Confirmation Protocol (Local vs. Web)

When the user asks to play a song/artist:
1. **Execute Search**: Run `~/music-streamer/search.py --json "<query>" 5`.
2. **If Local Matches Exist (`local_count > 0`)**:
   Use `ask_question` to ask the user whether to play from their local library or search from the web.
   **Options format:**
   - `"(Recommended) Play from Local Library: <Title> (<source_label>)"`
   - `"Choose a version from YouTube / Online Search"`
3. **If User selects Web or No Local Match Exists (`local_count == 0`)**:
   Use `ask_question` to present the top online results (e.g. `"<Title 1>"`, `"<Title 2>"`) so the user can choose the exact version they want.
4. **Execute Playback**:
   Once the user picks an option, play the confirmed URL:
   ```bash
   ~/music-streamer/play.py "<URL>" 80 yes
   ```

### 5. Play Direct URL
If the user provides an explicit direct URL (e.g., `https://www.youtube.com/watch?v=...`), search confirmation is not required:
```bash
~/music-streamer/play.py "https://www.youtube.com/watch?v=78Y0SxVVxP4" 80 yes
```

### 6. Control While Playing (Live, no restart needed)
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
~/music-streamer/loop.py repeat             # Loop entire tracklist in order/shuffle
~/music-streamer/loop.py repeat-one         # Repeat single current track continuously
~/music-streamer/loop.py off                # Disable repeat (stops after playing once)
~/music-streamer/loop.py toggle             # Flip loop setting

# Playback list management (Strictly deduplicated)
~/music-streamer/playback.py list [--json]     # Show full tracklist (Played, Playing, Upcoming)
~/music-streamer/playback.py add "Alan Walker" # Search & append first result (deduplicated)
~/music-streamer/playback.py add-url "URL" "Title" # Append specific confirmed URL
~/music-streamer/playback.py shuffle           # Randomize unplayed tracks (preserves played history)
~/music-streamer/playback.py remove 2          # Remove 2nd track from list
~/music-streamer/playback.py reset-history     # Reset played tracks to unplayed for fresh replay
~/music-streamer/playback.py clear             # Clear entire playback list
~/music-streamer/playback.py next              # Skip current track, play next in list
~/music-streamer/playback.py play 1            # Jump directly to track #1

# Persistent Named Playlists (Permanent collections stored in SQLite)
~/music-streamer/playlist.py create "Favorites"       # Create a new playlist
~/music-streamer/playlist.py rename "Favorites" "Top Favs" # Rename a playlist
~/music-streamer/playlist.py list [--json]            # List all playlists with track counts
~/music-streamer/playlist.py show "Favorites" [--json]# View tracks inside playlist
~/music-streamer/playlist.py add "Favorites" "<URL>"  # Add track (deduplicated, auto metadata)
~/music-streamer/playlist.py remove "Favorites" 1     # Remove track #1 from playlist
~/music-streamer/playlist.py play "Favorites"         # Load and play in sequential order
~/music-streamer/playlist.py play "Favorites" --shuffle # Load and play in fair shuffle mode
~/music-streamer/playlist.py queue "Favorites"        # Append playlist tracks to current queue
~/music-streamer/playlist.py delete "Favorites"       # Delete playlist

# Playback state
~/music-streamer/pause.py                   # Pause playback (streams silence to clients)
~/music-streamer/resume.py                  # Resume playback
~/music-streamer/stop.py                    # Stop music (clients stay connected receiving silence)
~/music-streamer/stop.py --all              # Stop music AND shut down stream server daemon
```

### 7. Client Listening
Listeners on other devices (laptops, phones, browsers) can tune in:
- **Web Control Panel & Player**: Open `http://<SERVER_IP>:8000/` in any browser (realtime WebSocket sync, loading skeletons, buffering badges, playback error handling)
- **Direct Media Stream**: Open `http://<SERVER_IP>:8000/stream.mp3` in VLC / mpv / browser audio

---

## Environment Overrides

| Var | Default | Purpose |
|---|---|---|
| `ALSA_DEVICE` | `default` | ALSA audio sink device |
| `NODE_BIN` | `~/.nvm/versions/node/v24.19.0/bin/node` | Node.js binary for yt-dlp JS challenges |
| `PROVIDER` | `youtube` | Default search provider |

---

## Key Project Structure

```
~/music-streamer/
  music_streamer/       # Core Python package (audio engine, SQLite DB, server & CLI)
  stream.py             # Server daemon manager (start/stop/status/speaker/silent/public)
  play.py               # Play direct audio stream / URL
  play_search.py        # Search and play first result
  search.py             # Multi-provider music search (YouTube, SoundCloud, Bandcamp)
  playback.py           # Playback tracklist manager (queue, shuffle, skip, history)
  playlist.py           # Persistent named playlists manager
  pause.py / resume.py  # Playback pause / resume controls
  volume.py             # Master volume & mute controls
  loop.py               # Live repeat mode toggle
  status.py             # Full system & player status inspector
  stop.py               # Stop playback or shut down daemon
  otp.py                # OTP passcode security manager
  web/                  # Web Control Panel (built & served from web/out/)
  runtime/              # SQLite database (music_streamer.db), IPC socket, and logs
  requirements.txt      # Python dependencies
  tests/                # Automated test suite
```
