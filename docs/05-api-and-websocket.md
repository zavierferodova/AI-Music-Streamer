# REST API & WebSocket Protocol

This document provides a reference for the REST API endpoints, authentication schemes, and real-time WebSocket protocol supported by `music-streamer`.

---

## 1. Authentication & Security Model

When OTP security is enabled (`otp_enabled = 1`), API requests are authenticated using session tokens.

### 1.1 Token Transport Options
Clients can provide the session token in any of the following three ways:
1. **HTTP Cookie**: `music_session=<SESSION_TOKEN>`
2. **Authorization Header**: `Authorization: Bearer <SESSION_TOKEN>`
3. **URL Query Parameter**: `?token=<SESSION_TOKEN>`

### 1.2 User Roles & Permissions

| Role | Permissions |
|---|---|
| **`admin`** | Full permissions: playback controls, queue management, volume, loop, mode switching, playlist CRUD, and settings. |
| **`subscriber`** | Read-only & streaming permissions: listen to audio stream (`/stream.mp3`, `/ws`), view server status, and execute web music search (cannot modify queue or access named playlists). |

---

## 2. REST API Reference

### 2.1 Authentication Endpoints

#### `GET /api/auth/status`
Returns current security status and caller authentication state.

**Response:**
```json
{
  "status": "ok",
  "security_enabled": true,
  "authenticated": true,
  "role": "admin"
}
```

#### `POST /api/auth/verify`
Authenticates a client using a 6-digit OTP passcode or existing session token.

**Request Payload:**
```json
{
  "otp": "482910"
}
```

**Response (Success - 200 OK):**
```json
{
  "status": "ok",
  "authenticated": true,
  "token": "7a3f8e91b2c44f0a9e8d1234567890ab",
  "role": "admin"
}
```

---

### 2.2 System & Status Endpoints

#### `GET /status` or `GET /api/status`
Returns comprehensive playback engine state, current track, volume, queue counts, and server metadata.

**Response:**
```json
{
  "status": "ok",
  "state": "playing",
  "current_title": "Denny Caknan - Wirang",
  "current_url": "https://www.youtube.com/watch?v=78Y0SxVVxP4",
  "current_thumbnail": "https://i.ytimg.com/vi/78Y0SxVVxP4/hqdefault.jpg",
  "volume": 80,
  "loop": "repeat",
  "mode": "silent",
  "playback_mode": "ordered",
  "elapsed": 45.2,
  "duration": 218.0,
  "is_buffering": false,
  "client_count": 3,
  "ws_listeners": 2,
  "total_tracks": 12,
  "queued_count": 8,
  "played_count": 3
}
```

---

### 2.3 Audio Playback Controls (Admin Role Required)

| Endpoint | Method | Payload | Description |
|---|---|---|---|
| `/api/play` | `POST` | `{"url": "...", "title": "..."}` | Immediately plays the specified URL or track title. |
| `/api/pause` | `POST` | `{}` | Pauses playback and switches to comfort silence. |
| `/api/resume` | `POST` | `{}` | Resumes audio playback in synchronization. |
| `/api/stop` | `POST` | `{}` | Stops playback (stream continues emitting silence). |
| `/api/skip` or `/api/next` | `POST` | `{}` | Skips to the next track in the queue. |
| `/api/prev` or `/api/previous` | `POST` | `{}` | Plays the previous track from playback history. |
| `/api/seek` | `POST` | `{"seconds": 90.0}` or `{"delta": 15.0}` | Seeks to an absolute timestamp or relative offset. |
| `/api/volume` | `POST` | `{"volume": 85}` | Sets absolute volume (0–100) or changes relative (`+10`, `-10`). |
| `/api/loop` | `POST` | `{"loop": "repeat"\|"repeat-one"\|"off"}` | Sets repeat loop mode. |
| `/api/mode` | `POST` | `{"mode": "silent"\|"speaker"}` | Switches between network-only and ALSA speaker mode. |

---

### 2.4 Playback Queue Management (Admin Role Required)

#### `POST /api/playback/add`
Appends a track to the ephemeral playback queue (deduplicated).

**Request Payload:**
```json
{
  "url": "https://www.youtube.com/watch?v=fBnqChaU-ck",
  "title": "GuyonWaton - Wirang"
}
```

#### `POST /api/playback/remove`
Removes a track from the playback list by ID or index.

**Request Payload:**
```json
{
  "id": "1725178200000_1"
}
```

#### `POST /api/playback/shuffle`
Randomizes unplayed queued tracks while preserving played history.

---

### 2.5 Named Playlists Management (Admin Role Required)

#### `GET /api/playlists`
Retrieves all persistent named playlists with track counts.

#### `GET /api/playlist?name=<NAME_OR_ID>`
Retrieves full details and track list for a specific playlist (with fuzzy name tolerance).

#### `POST /api/playlist/create`
Creates a new persistent playlist: `{"name": "Favorites"}`.

#### `POST /api/playlist/add`
Adds a track to a named playlist: `{"name": "Favorites", "url": "https://...", "title": "..."}`.

#### `POST /api/playlist/play`
Loads a playlist into the playback queue and begins playback: `{"name": "Favorites", "shuffle": false}`.

---

### 2.6 Music Search Endpoint

#### `POST /api/search` or `GET /api/search?q=<QUERY>`
Performs a unified search across local playlists and online providers (YouTube, SoundCloud, Bandcamp).

**Response:**
```json
{
  "status": "ok",
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
    }
  ]
}
```

---

## 3. Real-Time WebSocket Protocol (`/ws`)

The WebSocket endpoint provides real-time bi-directional communication, sub-100ms raw PCM audio streaming, and status broadcast events.

### 3.1 Handshake (RFC 6455)
Clients initiate a standard HTTP upgrade request:
```http
GET /ws HTTP/1.1
Host: localhost:8000
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
```

The server computes `Sec-WebSocket-Accept` using SHA-1 and the standard GUID (`258EAFA5-E914-47DA-95CA-C5AB0DC85B11`) and returns HTTP status `101 Switching Protocols`.

### 3.2 Binary Audio Frames (`Opcode 0x2`)
Audio chunks are pushed over WebSocket as uncompressed raw binary PCM:
- **Encoding**: 16-bit signed integer (`s16le`), 2 channels (stereo), 44.1 kHz.
- **Frame Size**: Exactly **8,820 bytes** per binary frame (50ms of audio).
- **Client Handling**: Decoded into `Float32Array` buffers and scheduled monotonically in the browser's `AudioContext.currentTime` timeline.

### 3.3 Text Telemetry Frames (`Opcode 0x1`)
The server pushes JSON telemetry frames whenever player state, volume, track, or buffer status changes:

```json
{
  "event": "status",
  "state": "playing",
  "current_title": "Denny Caknan - Wirang",
  "current_url": "https://www.youtube.com/watch?v=78Y0SxVVxP4",
  "elapsed": 12.5,
  "duration": 218.0,
  "volume": 80,
  "loop": "repeat"
}
```
