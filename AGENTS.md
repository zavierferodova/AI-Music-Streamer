# AGENTS.md — Developer & AI Agent Guide

This document serves as the primary technical reference and operational protocol for AI agents and human engineers contributing to the `music-streamer` codebase.

---

## 1. Project Overview & Core Mission

`music-streamer` is a real-time, multi-sink audio streaming and playback platform for Linux (Ubuntu/Debian/Arch). It ingests media streams (YouTube, SoundCloud, Bandcamp, direct URLs), decodes them into raw PCM (44.1 kHz, 16-bit stereo), and concurrently feeds:
1. **Web Audio API Stream** (`/ws`): Binary raw PCM stream pushed over WebSocket for sub-100ms lockstep playback in web browsers.
2. **Continuous HTTP MP3 Stream** (`/stream.mp3`): 24/7 always-on 128 kbps CBR broadcast with comfort silence for VLC/mpv/media players.
3. **Server Hardware Speaker** (`aplay` on ALSA device `default`): Active when explicitly switched to `speaker` mode.

State persistence is managed via **SQLite in WAL mode** (`runtime/music_streamer.db`), and background communication is handled over a **Unix Domain Socket** (`runtime/control.sock`).

---

## 2. Repository Layout & Key Locations

```
music-streamer/
├── music_streamer/            # Core Python package
│   ├── config.py              # Central audio constants, paths, and environment settings
│   ├── db.py                  # SQLite WAL database layer, deduplication & fuzzy token matching
│   ├── engine.py              # AudioEngine, Broadcaster, and PCM decoding pipeline
│   ├── playback.py            # Playback list manager, queue states, and fair shuffle cycles
│   ├── playlist.py            # Persistent named playlists controller
│   ├── search.py              # Multi-provider music search engine (YouTube, SoundCloud, etc.)
│   ├── security.py            # Two-tier OTP authentication (Admin vs Subscriber) & sessions
│   ├── server.py              # HTTP server, WebSocket hub, and REST API handlers
│   ├── ipc.py                 # Unix domain socket IPC protocol client/server
│   └── cli.py                 # Central CLI argument parsing and handler functions
├── web/                       # Next.js 15 & Tailwind CSS Frontend
│   ├── app/                   # Next.js App Router (globals.css, layout.tsx, page.tsx)
│   ├── components/            # Modular React components (NowPlayingHero, PlaybackList, etc.)
│   ├── hooks/                 # React hooks (useAudioStream, useStreamStatus, useAuth)
│   ├── lib/                   # API client, WebSocket client (ws.ts), and utilities
│   └── out/                   # Built static export served directly by the Python HTTP server
├── runtime/                   # Runtime directory (auto-created, git-ignored)
│   ├── music_streamer.db      # SQLite database (WAL mode)
│   ├── control.sock           # IPC Unix domain socket
│   ├── stream_server.pid      # Daemon server process ID file
│   └── stream_server.log      # Broadcast daemon log output
├── tests/                     # Automated unit and integration test suite (pytest)
├── docs/                      # Numbered engineering documentation suite (00–09)
├── stream.py                  # CLI: Server daemon management (start/stop/status/speaker/silent)
├── play.py                    # CLI: Play direct URL
├── play_search.py             # CLI: Search & play first result
├── search.py                  # CLI: Multi-provider search
├── playback.py                # CLI: Ephemeral queue management
├── playlist.py                # CLI: Named persistent playlists
├── pause.py / resume.py       # CLI: Playback control
├── volume.py                  # CLI: Master volume & mute
├── loop.py                    # CLI: Repeat mode toggle
├── otp.py                     # CLI: OTP security manager
├── status.py                  # CLI: Full system & player status
├── stop.py                    # CLI: Stop music or halt daemon
└── requirements.txt           # Python dependencies
```

---

## 3. Core Technical Invariants & Rules

When modifying or extending the codebase, AI agents MUST preserve the following invariants:

### 3.1 Audio Processing & Chunk Sizing
- **Sample Rate**: Always `44,100 Hz` (CD Quality).
- **Channels**: Always `2` (Stereo).
- **Sample Format**: Signed 16-bit Little-Endian (`s16le`, 2 bytes/sample, 4 bytes/frame).
- **Chunk Duration**: Exactly `50ms` (`0.05` seconds).
- **Chunk Frames**: Exactly `2,205` frames per chunk.
- **Chunk Bytes**: Exactly `8,820` bytes per chunk ($2,205 \times 4$).
- **Comfort Silence**: `SILENCE_CHUNK = b"\x00" * 8820`. Comfort silence must be broadcast during pauses, stops, and track transitions to prevent client TCP disconnections or buffer starvation.

### 3.2 Thread Safety & Concurrency
- **Database Access**: All SQLite queries must use `DatabaseManager.get_connection()`, which wraps connections in a re-entrant lock (`threading.RLock`). Never open unmanaged sqlite connections directly.
- **Engine State**: State transitions (`play`, `pause`, `resume`, `stop`, `seek`, `skip`, `mode`) must be synchronized under `AudioEngine.lock`.
- **Broadcaster Queues**: Client registration and queue fan-out must be protected by `Broadcaster.lock`. Always use bounded queues (`maxsize=120`) and non-blocking `put_nowait()` with drop-oldest fallback to prevent memory leaks from slow consumers.

### 3.3 Subprocess Management
- External child processes (`ffmpeg`, `yt-dlp`, `aplay`) must be spawned with process groups (`preexec_fn=os.setsid`).
- When terminating decoders or audio sinks, kill the entire process tree using `os.killpg(os.getpgid(proc.pid), signal.SIGTERM)` (with `SIGKILL` timeout fallback) to prevent orphaned zombie processes.

### 3.4 Web Frontend Modifications
- The web frontend in `web/` is statically exported to `web/out/`.
- If you modify any file inside `web/app/`, `web/components/`, `web/hooks/`, or `web/lib/`, you **MUST** recompile the frontend bundle:
  ```bash
  cd web && npm run build
  ```
- Do not introduce server-side Node.js runtime dependencies; the Python server hosts the static export files directly from `web/out/`.

### 3.5 Security & Dual-Role Access Control
- Two-tier OTP model:
  - **`admin`**: Full control (playback, queue, playlists, settings).
  - **`subscriber`**: Read-only stream listening and metadata viewing only (blocked from modifying queue, settings, or accessing named playlists).
- Constant-time string comparison (`secrets.compare_digest`) must be used for all passcode verifications to prevent side-channel timing attacks.

### 3.6 Skill-Based Application Operation
- When operating, controlling, or interacting with music streaming and playback on behalf of the user (such as playing tracks, searching, managing queue and playlists, adjusting volume/loop, or switching broadcast modes), AI agents **MUST** use and follow the `music-streamer` skill ([`.agents/skills/music-streamer/SKILL.md`](.agents/skills/music-streamer/SKILL.md)).

---

## 4. Agent Operational Workflows

### 4.1 Operating via the `music-streamer` Skill
AI agents must consult and execute workflows defined in the `music-streamer` skill ([`.agents/skills/music-streamer/SKILL.md`](.agents/skills/music-streamer/SKILL.md)) for all user-facing player operations, queue reordering, fair shuffle, playlist manipulation, and broadcast lifecycle commands.

### 4.2 Playback & Queue Decision Protocol (Local Exact → Web Exact → Ask if in Doubt)
Before executing a music playback or queue request:
1. **Search First**: Execute `~/music-streamer/search.py --json "<query>" 5`.
2. **Local Exact Match**: If found in local library (`is_exact_match: true` or `match_score >= 0.90`), play or queue it directly without extra prompts.
3. **Web Exact Match (if no local match)**: If not in local library but web search has an unambiguous exact match, play or queue it directly.
4. **Ask User if in Doubt**: If there is ambiguity or doubt between local and web results (e.g. multiple versions, partial match, live vs. official), prompt the user using `ask_question` to choose the desired version before playing.
5. **Execute Playback/Queue**:
   - Direct Play: `./play.py "<URL>" 80 yes`
   - Queue Track: `./playback.py add-url "<URL>" "<TITLE>" [--next|--after <target>|--before <target>|--position <N>]`

### 4.3 Starting and Managing the Daemon
```bash
# Start background broadcast daemon
./stream.py --daemon --port 8000

# Start with synchronized hardware speaker
./stream.py --daemon --mode speaker --port 8000

# Check daemon health & listener metrics
./status.py --json

# Gracefully stop the broadcast daemon
./stream.py stop
```

### 4.4 Running Test Suites
Always run the complete test suite before submitting code changes:
```bash
.venv/bin/pytest tests/ -v
```

---

## 5. Detailed Documentation Index

For in-depth explanations of specific subsystems, consult the [`docs/`](docs/) directory:

- [docs/00-overview.md](docs/00-overview.md): System Summary, Capabilities, and Topology
- [docs/01-development.md](docs/01-development.md): Environment Setup, Dependencies, Build Workflow, and Testing
- [docs/02-architecture.md](docs/02-architecture.md): System Architecture, Concurrency Model, and IPC
- [docs/03-database-and-state.md](docs/03-database-and-state.md): SQLite WAL Layer, Schema, Deduplication, and Fair Shuffle
- [docs/04-audio-engine.md](docs/04-audio-engine.md): Audio Specs, ALSA Sync, Comfort Silence, and Mode Switching
- [docs/05-api-and-websocket.md](docs/05-api-and-websocket.md): REST API Reference and RFC 6455 WebSocket Protocol
- [docs/06-cli-reference.md](docs/06-cli-reference.md): CLI Command Reference and Automation Protocol
- [docs/07-web-interface.md](docs/07-web-interface.md): Next.js Frontend Architecture, Web Audio API, and Components
- [docs/08-security-and-auth.md](docs/08-security-and-auth.md): Two-Tier OTP Security Model, Session Lifecycle, and Access Control
- [docs/09-deployment-and-operations.md](docs/09-deployment-and-operations.md): Daemon Service, Cloudflare Tunneling, and Troubleshooting
