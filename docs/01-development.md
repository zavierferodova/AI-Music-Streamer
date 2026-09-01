# Development Guide

This guide provides step-by-step instructions for setting up the local development environment, installing system libraries, building the frontend interface, running the automated test suite, and debugging the `music-streamer` platform.

---

## 1. Prerequisites & System Dependencies

`music-streamer` requires **Python 3.10+**, **Node.js 18+**, and core Linux audio utilities.

### 1.1 Required Linux Packages

| Package | Purpose |
|---|---|
| `ffmpeg` | Real-time audio decoding and continuous MP3 live stream encoding. |
| `alsa-utils` | Linux ALSA sound architecture tools (`aplay` for raw PCM audio playback, `amixer` for volume/mute control). |
| `libasound2` & `libasound2-plugins` | Core ALSA shared libraries and software plugins (PulseAudio/PipeWire ALSA bridges). |
| `yt-dlp` | Audio stream URL extraction from YouTube, SoundCloud, Bandcamp, and direct media sources. |
| `nodejs` (v18+) | JavaScript execution engine required by `yt-dlp` to resolve YouTube JavaScript player extraction challenges and to build the Next.js web application. |
| `mpv` *(optional)* | Lightweight CLI audio player useful for testing HTTP stream feeds. |
| `cloudflared` *(optional)* | CLI tunnel client for zero-configuration public HTTPS broadcasting. |

### 1.2 Package Installation Commands

**Ubuntu / Debian:**
```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip ffmpeg alsa-utils libasound2 libasound2-plugins yt-dlp nodejs npm mpv curl
```

**Arch Linux:**
```bash
sudo pacman -S python python-pip ffmpeg alsa-utils alsa-lib yt-dlp nodejs npm mpv curl
```

---

## 2. Python Environment Setup

### 2.1 Virtual Environment Initialization

From the repository root:

```bash
# 1. Create a Python 3 virtual environment
python3 -m venv .venv

# 2. Activate the virtual environment
source .venv/bin/activate

# 3. Upgrade pip and install package dependencies
pip install --upgrade pip
pip install -r requirements.txt
```

### 2.2 Python Dependencies (`requirements.txt`)

The core Python suite relies on standard library components (`sqlite3`, `socket`, `http.server`, `subprocess`, `threading`, `queue`) alongside carefully selected lightweight dependencies:

```
pytest>=8.0.0
pytest-mock>=3.14.0
yt-dlp>=2024.0.0
```

---

## 3. Web Interface Build Workflow

The web interface is located in the `web/` directory and is built with **Next.js 15**, **React 19**, and **Tailwind CSS**. It is configured for static export (`output: 'export'`), producing static HTML/JS/CSS assets in `web/out/` that the Python HTTP server serves with zero runtime Node.js dependency.

### 3.1 Install Web Dependencies

```bash
cd web
npm install
```

### 3.2 Compiling the Frontend for Production

When frontend components or styles in `web/` are modified, regenerate the production bundle in `web/out/`:

```bash
cd web
npm run build
```

The Next.js build produces static artifacts in `web/out/` containing `index.html`, JavaScript bundles, and Tailwind CSS styles.

### 3.3 Web Development Mode (Hot Reloading)

For rapid UI development with live reloading:

```bash
cd web
npm run dev
```

The development server runs on `http://localhost:3000`. Set the backend proxy or configure the API URL to target the active Python broadcast daemon on port `8000`.

---

## 4. Running the Automated Test Suite

The test suite is built on `pytest` and `pytest-mock` and covers database operations, audio engine synchronization, IPC socket protocol, REST handlers, and WebSocket broadcasting.

### 4.1 Running All Tests

```bash
.venv/bin/pytest tests/ -v
```

### 4.2 Test Suite Structure

| Test Module | Coverage Area |
|---|---|
| [test_db.py](file:///home/tech/music-streamer/tests/test_db.py) | SQLite WAL operations, table schemas, track deduplication, fuzzy token matching, and playlist CRUD. |
| [test_engine.py](file:///home/tech/music-streamer/tests/test_engine.py) | Audio engine buffer calculation, comfort silence chunking, ALSA process sync, and mode switching. |
| [test_playback.py](file:///home/tech/music-streamer/tests/test_playback.py) | Playback queue transitions, fair shuffle cycle management, history preservation, and state retrieval. |
| [test_playlist.py](file:///home/tech/music-streamer/tests/test_playlist.py) | Named playlists, track addition/removal, deduplication on import, fuzzy name lookup. |
| [test_search.py](file:///home/tech/music-streamer/tests/test_search.py) | Multi-provider query dispatching, unified search ranking, local vs. web result segregation. |
| [test_security.py](file:///home/tech/music-streamer/tests/test_security.py) | Two-tier OTP generation, verification, timing-safe checks, cookie/token validation, and role enforcement. |
| [test_ipc_and_server.py](file:///home/tech/music-streamer/tests/test_ipc_and_server.py) | Unix domain socket communication, JSON command payloads, and server request dispatching. |
| [test_web.py](file:///home/tech/music-streamer/tests/test_web.py) | HTTP REST endpoints, WebSocket RFC 6455 handshakes, text event broadcasting, and binary PCM streaming. |
| [test_cli.py](file:///home/tech/music-streamer/tests/test_cli.py) | CLI argument parsers, exit code validation, and JSON output formatting. |

### 4.3 Running Specific Test Modules

```bash
# Run database tests only
.venv/bin/pytest tests/test_db.py -v

# Run audio engine tests only
.venv/bin/pytest tests/test_engine.py -v

# Run tests matching a specific expression
.venv/bin/pytest -k "test_fuzzy_search" -v
```

---

## 5. Development Workflow & Debugging

### 5.1 Starting the Server in Foreground Mode

To monitor real-time server and audio engine logs in your terminal:

```bash
./stream.py --port 8000 --mode silent
```

To enable speaker output concurrently:

```bash
./stream.py --port 8000 --mode speaker
```

### 5.2 Inspecting Runtime Logs

When running in background daemon mode (`./stream.py --daemon`), runtime logs and process information are stored in `runtime/`:

```bash
# Tail broadcast server logs
tail -f runtime/stream_server.log

# Check active process IDs
cat runtime/stream_server.pid
```

### 5.3 Verifying Unix Domain Socket IPC

You can test low-level communication with the active broadcast daemon using `nc` (netcat) or Python:

```bash
# Send a JSON command to the Unix domain socket
echo '{"action": "status"}' | nc -U runtime/control.sock
```

---

## 6. Code Style & Engineering Standards

- **Python Standard**: Follow PEP 8 guidelines. Type annotations (`typing.Dict`, `typing.List`, `typing.Optional`, `typing.Tuple`) should be used across all public function signatures.
- **Error Handling**: Subprocess operations (`ffmpeg`, `yt-dlp`, `aplay`) must use timeouts, process cleanup handlers, and exception guards to prevent orphaned zombie processes.
- **Thread Safety**: All database interactions, broadcaster subscriber collections, and engine state modifications must acquire appropriate threading locks (`threading.RLock` / `threading.Lock`).
- **Transactional Integrity**: Database writes that modify multiple related records (such as playlist reordering or queue state transitions) must execute inside atomic SQLite transactions.
