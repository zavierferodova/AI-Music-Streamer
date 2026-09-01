# CLI Command Reference

This document provides a comprehensive command-line reference for all Python utility scripts in `music-streamer`.

---

## 1. CLI Architecture & Global Conventions

All CLI scripts interact directly with the running `music-streamer` daemon via Unix Domain Socket IPC (`runtime/control.sock`) or fallback to SQLite persistence.

- **JSON Output**: Most inspectable commands accept `--json` for machine readability and AI agent integrations.
- **Exit Codes**:
  - `0`: Success
  - `1`: General runtime error / invalid arguments
  - `2`: Daemon server not running or socket unreachable

---

## 2. Server Management: `stream.py`

Manages the continuous HTTP broadcast server, background daemon lifecycle, dynamic mode switching, and public tunneling.

```bash
./stream.py [COMMAND | OPTIONS]
```

### Options & Subcommands

| Command / Option | Description |
|---|---|
| `--daemon` | Starts the broadcast server as a detached background daemon. |
| `--port <PORT>` | Specifies the HTTP port (default: `8000`). |
| `--mode <silent\|speaker>` | Sets initial audio output mode (default: `silent`). |
| `--public` | Starts the server with an instant Cloudflare HTTPS public tunnel. |
| `status` | Checks if the server daemon is active and displays listener count. |
| `stop` | Stops the running broadcast server daemon cleanly. |
| `speaker` | Dynamically switches active server to `speaker` mode (unmutes ALSA). |
| `silent` | Dynamically switches active server to `silent` mode (mutes ALSA, stream continues). |
| `public` | Displays active public Cloudflare HTTPS tunnel URLs. |

**Examples:**
```bash
# Start background broadcast daemon
./stream.py --daemon --port 8000

# Switch active server to hardware speaker output on the fly
./stream.py speaker

# Stop the server daemon
./stream.py stop
```

---

## 3. Playback Controls

### 3.1 `play.py`
Plays a direct URL immediately on the broadcast stream (and local speaker if in speaker mode).

```bash
./play.py "<URL>" [VOLUME 0-100] [LOOP yes|no]
```

**Example:**
```bash
./play.py "https://www.youtube.com/watch?v=78Y0SxVVxP4" 80 yes
```

---

### 3.2 `play_search.py`
Searches YouTube/SoundCloud for a query and immediately plays the first result.

```bash
./play_search.py "<QUERY>" [VOLUME 0-100] [LOOP yes|no]
```

**Example:**
```bash
./play_search.py "Denny Caknan Wirang" 85 yes
```

---

### 3.3 `pause.py` & `resume.py`
Controls playback pause and resume states without dropping client connections.

```bash
# Pause playback (streams comfort silence)
./pause.py

# Resume playback in lockstep sync
./resume.py
```

---

### 3.4 `stop.py`
Stops music playback or completely halts the entire background broadcast server.

```bash
# Stop current track (stream remains online emitting silence)
./stop.py

# Stop music AND kill the stream server daemon
./stop.py --all
```

---

### 3.5 `prev.py`
Skips back to the previously played track in the history stack.

```bash
./prev.py
```

---

### 3.6 `volume.py`
Displays or adjusts the master audio volume.

```bash
./volume.py [VOLUME | +N | -N | mute | unmute]
```

**Examples:**
```bash
./volume.py        # Show current volume
./volume.py 75     # Set absolute volume to 75%
./volume.py +10    # Increase volume by 10%
./volume.py -5     # Decrease volume by 5%
./volume.py mute   # Mute ALSA speaker output
./volume.py unmute # Unmute ALSA speaker output
```

---

### 3.7 `loop.py`
Configures repeat and loop playback behavior.

```bash
./loop.py [repeat | repeat-one | off | toggle | status]
```

| Mode | Behavior |
|---|---|
| `repeat` | Loops all tracks in queue (sequential or fair shuffle). |
| `repeat-one` | Continuously repeats the current track. |
| `off` | Playback stops when the queue finishes. |
| `toggle` | Cycles through repeat modes. |

---

## 4. Playback Queue Management: `playback.py`

Manages the ephemeral playback list, queued tracks, and fair shuffle cycles.

```bash
./playback.py <SUBCOMMAND> [ARGS...]
```

### Subcommands

| Subcommand | Description |
|---|---|
| `list [--json]` | Lists all tracks (Played, Now Playing, Upcoming). |
| `add "<QUERY_OR_URL>" [OPTIONS]` | Adds track to queue (deduplicated). Supports `--next`, `--last`, `--after <TARGET>`, `--before <TARGET>`, `--position <N>`, or positional shorthand (`next`, `last`, `after <TARGET>`, `before <TARGET>`). |
| `add-url "<URL>" "<TITLE>" [OPTIONS]` | Appends explicit URL and Title with optional placement (`--next`, `--after <TARGET>`, `--before <TARGET>`, `--position <N>`). |
| `add-bulk <TRACKS...> [--file FILE] [OPTIONS]` | Adds multiple tracks/URLs in bulk (supports positional arguments, `--file <txt/json>`, stdin `-`, and batch placement `--next`, `--after <TARGET>`, `--before <TARGET>`, `--position <N>`). |
| `move <FROM|TITLE> <TO|top|next|bottom>` | Moves a queued track by 1-based index or title to destination. |
| `move-bulk <ITEMS...> [OPTIONS]` | Moves multiple tracks as a batch (supports `--next`, `--after <TARGET>`, `--before <TARGET>`, `--position <N>`). |
| `play-next <N|TITLE|URL>` | Moves specified track to play immediately next in queue. |
| `reorder <ITEMS...> [--file FILE]` | Reorders active queue by 1-based index sequence, track titles, IDs, sequence files, or piped stdin (`-`). Supports partial sequence prioritization. |
| `shuffle` | Shuffles upcoming unplayed tracks (preserves played history). |
| `remove <INDEX_OR_ID>` | Removes track at specified 1-based index or ID. |
| `play <INDEX_OR_ID>` | Shifts track to active position and marks previous song as played. |
| `next` | Skips current track and plays next in queue. |
| `reset-history` | Resets all played tracks back to queued status for replay. |
| `clear` | Clears all tracks from the queue. |

### Replay & Reordering Invariant Rules
- **Locked Played History**: Tracks with `status == 'played'` are immutable history items and cannot be moved or reordered.
- **Dynamic Replay Shifting**: When replaying an earlier track, the actively streaming song is marked as `played`, and the selected track shifts to the `playing` position immediately following the played history.
- **Queue Protection**: Moves targeting positions before played tracks are automatically clamped to the top of the upcoming queue (`NEXT UP`).

---

## 5. Named Playlists Management: `playlist.py`

Manages persistent named collections stored permanently in the SQLite database.

```bash
./playlist.py <SUBCOMMAND> [ARGS...]
```

### Subcommands

| Subcommand | Description |
|---|---|
| `list [--json]` | Lists all saved playlists and track counts. |
| `create "<NAME>"` | Creates a new empty playlist. |
| `rename "<OLD>" "<NEW>"` | Renames an existing playlist. |
| `show "<NAME>" [--json]` | Displays all tracks in a playlist. |
| `add "<NAME>" "<URL_OR_QUERY>"` | Adds track to named playlist (auto-fetches metadata). |
| `remove "<NAME>" <INDEX>` | Removes track at 1-based index from playlist. |
| `play "<NAME>" [--shuffle]` | Loads playlist into queue and starts playback. |
| `queue "<NAME>"` | Appends playlist tracks to existing playback queue. |
| `delete "<NAME>"` | Deletes a playlist and its track associations. |

---

## 6. Music Search: `search.py`

Searches across local playlists and online media providers.

```bash
./search.py "<QUERY>" [COUNT] [--provider youtube|soundcloud|bandcamp|spotify] [--json] [--first]
```

**JSON Output Example (`search.py --json "Wirang" 3`):**
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
  "web_count": 3,
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

## 7. Security & Passcodes: `otp.py`

Manages the two-tier One-Time Password (OTP) security system.

```bash
./otp.py [SUBCOMMAND]
```

### Subcommands

| Subcommand | Description |
|---|---|
| `show` | Displays current active Admin and Subscriber OTP passcodes. |
| `new [admin\|subscriber\|all]` | Generates fresh 6-digit OTP passcode(s). |
| `on` | Enables OTP passcode security. |
| `off` | Disables OTP passcode security (open public access). |
| `sessions` | Lists all active authenticated client IP sessions. |

---

## 8. System Status: `status.py`

Inspects full broadcast server state, current track, volume, and queue details.

```bash
# Human-readable format
./status.py

# JSON format for scripts & AI agents
./status.py --json
```
