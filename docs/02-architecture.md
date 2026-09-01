# System Architecture

This document details the architectural design, audio streaming pipeline, concurrency model, and Inter-Process Communication (IPC) mechanisms of `music-streamer`.

---

## 1. System Architecture Overview

`music-streamer` is designed around a decoupled, event-driven audio streaming pipeline backed by an SQLite database state store and synchronized multi-sink audio broadcasting.

```mermaid
graph TD
    subgraph Control Layer [Control & Client Interfaces]
        CLI[Python CLI Suite<br/>play.py, playback.py, etc.]
        REST[REST API Clients<br/>/api/play, /api/status, etc.]
        WS_C[WebSocket Clients<br/>/ws Web Audio API]
        HTTP_C[HTTP Stream Clients<br/>/stream.mp3 VLC/mpv]
    end

    subgraph IPC Layer [Inter-Process Communication]
        SOCK[Unix Domain Socket<br/>runtime/control.sock]
        HTTP_SRV[Threading HTTP Server<br/>Port 8000]
        WS_HUB[WebSocket Hub<br/>Binary PCM & JSON Telemetry]
    end

    subgraph State Layer [State Store]
        DB[(SQLite WAL Database<br/>runtime/music_streamer.db)]
    end

    subgraph Audio Core [Audio Pipeline & Engine]
        ENG[AudioEngine<br/>Process & State Orchestrator]
        YTDL[yt-dlp Audio Stream Ingestion]
        FFMPEG_DEC[FFmpeg PCM Decoder<br/>s16le 44.1kHz Stereo]
        SIL[Comfort Silence Generator<br/>50ms PCM Chunks]
        BC[Broadcaster<br/>Fan-Out Distributor]
        FFMPEG_ENC[FFmpeg MP3 Live Encoder<br/>128 kbps CBR]
        ALSA_SINK[ALSA Hardware Sink<br/>aplay -D default]
    end

    CLI <-->|JSON Commands| SOCK
    SOCK <--> ENG
    REST <--> HTTP_SRV
    HTTP_SRV <--> ENG
    ENG <--> DB

    YTDL --> FFMPEG_DEC
    FFMPEG_DEC -->|Raw PCM 44.1kHz| ENG
    SIL -->|Zero-Byte PCM| ENG

    ENG -->|Speaker Mode| ALSA_SINK
    ENG -->|Raw PCM Broadcast| BC
    BC -->|Raw PCM| WS_HUB --> WS_C
    BC -->|Raw PCM| FFMPEG_ENC -->|Continuous MP3 Stream| HTTP_SRV --> HTTP_C
```

---

## 2. The Audio Pipeline

The audio engine guarantees seamless, low-latency audio delivery across multiple output targets simultaneously by centralizing raw PCM audio decoding.

### 2.1 Audio Ingestion & Extraction
1. When a track is requested (via URL or search query), `yt-dlp` extracts the best direct audio stream URL (`bestaudio/best`).
2. Node.js (`NODE_BIN`) executes alongside `yt-dlp` to satisfy YouTube JavaScript player challenges and extract signed streaming tokens.
3. The extracted stream URL is piped into `ffmpeg` without intermediate file downloads.

### 2.2 PCM Decoding Pipeline
The `ffmpeg` decoder process converts any source format (Opus, AAC, WebM, MP4, FLAC) into standard raw PCM:
- **Format**: Signed 16-bit Little-Endian (`s16le`)
- **Sampling Rate**: 44,100 Hz (CD Quality)
- **Channels**: 2 (Stereo)
- **Frame Size**: 4 bytes per frame (2 channels × 2 bytes/sample)

```bash
ffmpeg -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
       -ss <OFFSET> -i <AUDIO_URL> \
       -f s16le -acodec pcm_s16le -ac 2 -ar 44100 pipe:1
```

### 2.3 Audio Chunking & Pacing
Audio chunks are read from the decoder stdout in discrete **50ms blocks**:
- **Chunk Frames**: $44,100 \times 0.05 = 2,205\text{ frames}$
- **Chunk Bytes**: $2,205 \times 4\text{ bytes} = 8,820\text{ bytes}$
- **Pacing**: A monotonic high-resolution clock (`time.perf_counter()`) regulates chunk emission every 50ms, ensuring exact wall-clock synchronization across all outputs.

### 2.4 Multi-Sink Fan-Out Broadcaster
Each 50ms PCM chunk is distributed simultaneously to three sinks:
1. **ALSA Hardware Output**: Written directly to `aplay -D <ALSA_DEVICE> -f cd -t raw -q` when the server is in `speaker` mode.
2. **WebSocket Real-Time Stream**: Sent as binary WebSocket frames (`Opcode 0x2`) to connected browser clients for scheduled Web Audio API playback (<50–100ms latency).
3. **Continuous MP3 Broadcast Stream**: Fed into an `ffmpeg` MP3 encoder process (`128 kbps CBR, 44.1kHz stereo`) which outputs continuously to HTTP clients connected to `/stream.mp3`.

---

## 3. Concurrency & Threading Model

The `music-streamer` server uses multi-threaded concurrency to isolate audio decoding, client distribution, network I/O, and IPC command handling:

```mermaid
graph TD
    subgraph Threads [Server Concurrency Threads]
        T_ENG[AudioEngine Thread<br/>PCM decoding loop & 50ms pacing]
        T_SIL[Silence Generator Thread<br/>Emits comfort silence when idle]
        T_IPC[Unix Socket IPC Thread<br/>Listens on control.sock]
        T_HTTP[HTTP Server Pool<br/>Handles REST requests & static assets]
        T_WS[WebSocket Hub Loop<br/>Distributes binary PCM & status JSON]
        T_ENC[FFmpeg MP3 Encoder Thread<br/>Pipes PCM into continuous MP3 stream]
    end

    subgraph Synchronization [Synchronization Primitives]
        LOCK_DB[Database RLock<br/>Thread-safe SQLite queries]
        LOCK_ENG[Engine State Lock<br/>Atomic state transitions]
        LOCK_BC[Broadcaster Subscriber Lock<br/>Safe queue registration]
        QUEUE_SUB[Per-Client Bounded Queues<br/>Maxsize 120 chunks]
    end

    T_ENG --> LOCK_ENG
    T_ENG --> LOCK_BC
    T_HTTP --> LOCK_DB
    T_IPC --> LOCK_ENG
    LOCK_BC --> QUEUE_SUB
```

### 3.1 Thread Safety Mechanisms
- **`Broadcaster.lock`**: Protects the set of active subscriber queues (`queue.Queue`). When an audio chunk arrives, it is placed into each subscriber queue using non-blocking `put_nowait()`. If a client queue is full (slow consumer), the oldest chunk is dropped to prevent memory growth.
- **`DatabaseManager.lock`**: A re-entrant lock (`threading.RLock`) synchronizes access to the SQLite connection pool, guaranteeing thread-safe reads and writes in `WAL` mode.
- **`AudioEngine.lock`**: Serializes playback commands (`play`, `pause`, `resume`, `stop`, `seek`, `skip`, `mode`) so state transitions remain atomic and predictable.

---

## 4. Inter-Process Communication (IPC)

`music-streamer` utilizes a Unix domain socket (`runtime/control.sock`) to allow CLI tools and background daemon processes to communicate synchronously without network overhead.

### 4.1 IPC Message Protocol
Communication over the Unix domain socket is newline-delimited JSON.

**Request Schema:**
```json
{
  "action": "play" | "pause" | "resume" | "stop" | "skip" | "prev" | "seek" | "volume" | "mode" | "status",
  "url": "https://www.youtube.com/watch?v=...",
  "title": "Track Title",
  "seconds": 45.0,
  "value": 80
}
```

**Response Schema:**
```json
{
  "status": "ok" | "error",
  "message": "Playback started",
  "data": { ... }
}
```

### 4.2 IPC Workflow

```mermaid
sequenceDiagram
    participant CLI as CLI Tool (e.g. ./play.py)
    participant SOCK as Unix Socket (control.sock)
    participant ENG as AudioEngine Daemon
    participant DB as SQLite DB

    CLI->>SOCK: Connect to runtime/control.sock
    CLI->>SOCK: Send JSON Command {"action": "play", "url": "..."}
    SOCK->>ENG: Dispatch Command to AudioEngine
    ENG->>DB: Update playback state in SQLite
    ENG->>ENG: Spawn yt-dlp & FFmpeg decoder
    ENG-->>SOCK: Return Response {"status": "ok"}
    SOCK-->>CLI: Return JSON Result
    CLI->>CLI: Format output & exit(0)
```

If the background daemon is not running when a CLI command is executed, the CLI tool detects the missing socket and displays an actionable prompt indicating how to start the stream server (`./stream.py --daemon`).
