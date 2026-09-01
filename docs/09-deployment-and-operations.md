# Deployment & Operations Guide

This guide covers running `music-streamer` in production, configuring systemd services, setting up public Cloudflare HTTPS tunnels, tuning ALSA audio devices, and troubleshooting common operational issues.

---

## 1. Daemon Management

`music-streamer` includes built-in background daemon support with process tracking and log capture:

```bash
# Start background broadcast daemon
./stream.py --daemon --port 8000

# Check daemon status
./stream.py status

# Tail live daemon logs
tail -f runtime/stream_server.log

# Gracefully stop the daemon
./stream.py stop
```

### Runtime File Locations

| File | Purpose |
|---|---|
| `runtime/stream_server.pid` | Process ID of the active broadcast server daemon. |
| `runtime/stream_server.log` | Standard output and error logs from the server daemon. |
| `runtime/control.sock` | Unix domain socket used for IPC communication. |
| `runtime/music_streamer.db` | SQLite database storing playlists, queues, settings, and sessions. |
| `runtime/tunnel.pid` & `log` | Process ID and logs for the Cloudflare public HTTPS tunnel. |

---

## 2. Systemd Service Setup

For production servers, running `music-streamer` as a systemd service ensures automatic startup on boot and automatic restarts on failure.

### 2.1 Service File Definition (`/etc/systemd/system/music-streamer.service`)

Create the service file using `sudo nano /etc/systemd/system/music-streamer.service`:

```ini
[Unit]
Description=Music Streamer Audio Broadcast Service
After=network.target sound.target

[Service]
Type=simple
User=tech
WorkingDirectory=/home/tech/music-streamer
Environment="PATH=/home/tech/music-streamer/.venv/bin:/usr/local/bin:/usr/bin"
Environment="ALSA_DEVICE=default"
ExecStart=/home/tech/music-streamer/.venv/bin/python3 /home/tech/music-streamer/stream.py --port 8000 --mode silent
Restart=always
RestartSec=3
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

### 2.2 Enabling and Starting the Service

```bash
# Reload systemd manager configuration
sudo systemctl daemon-reload

# Enable automatic start on system boot
sudo systemctl enable music-streamer

# Start the service immediately
sudo systemctl start music-streamer

# Check service status
sudo systemctl status music-streamer

# View real-time service logs
journalctl -u music-streamer -f
```

---

## 3. Public Worldwide Streaming (Cloudflare Tunnel)

To share the music stream or web control panel with remote listeners without opening router ports or configuring dynamic DNS, `music-streamer` integrates with **Cloudflare Tunnels**:

### 3.1 Quick Public Tunnel

```bash
# Start the server daemon with public tunnel enabled
./stream.py --daemon --public --port 8000

# Or enable public tunneling on an already-running server
./stream.py public
```

The server automatically launches `cloudflared` in the background and prints the worldwide public HTTPS URL (e.g. `https://random-words.trycloudflare.com`).

---

## 4. Linux Audio & ALSA Configuration

### 4.1 Audio Permissions
Ensure the user running `music-streamer` belongs to the `audio` group:

```bash
sudo usermod -aG audio $USER
```

### 4.2 Selecting Audio Sinks (`ALSA_DEVICE`)
By default, `music-streamer` routes hardware audio to ALSA device `default`. To target a specific USB DAC, HDMI output, or PCI sound card:

```bash
# List all available ALSA playback devices
aplay -l

# Set custom device via environment variable
export ALSA_DEVICE="hw:1,0"
./stream.py --mode speaker
```

---

## 5. Troubleshooting & FAQ

### 5.1 YouTube Extraction Error: "Sign in to confirm you’re not a bot" or JS Challenges
- **Cause**: YouTube requires JavaScript execution to resolve bot challenges for ciphered video streams.
- **Solution**: Ensure Node.js is installed. `music-streamer` will automatically pass the Node binary to `yt-dlp`. You can also override the path:
  ```bash
  export NODE_BIN="/usr/bin/node"
  ./stream.py --daemon
  ```

### 5.2 Server Hardware Speaker is Silent in Speaker Mode
1. Verify the server is in `speaker` mode: `./stream.py speaker`.
2. Check ALSA volume and unmute using `alsamixer` or `amixer`:
   ```bash
   amixer set Master unmute
   amixer set Master 80%
   ```
3. Test raw ALSA playback manually:
   ```bash
   speaker-test -t wav -c 2
   ```

### 5.3 Address Already in Use (`Errno 98`)
- **Cause**: An old server instance is still bound to port 8000.
- **Solution**:
  ```bash
  ./stream.py stop
  # Or force cleanup:
  fuser -k 8000/tcp
  ```

### 5.4 High Latency on Web Player
- If the Web Audio API player latency exceeds 150ms, ensure the browser tab has not been suspended by the operating system. Clicking the playback button or refocusing the tab resets the monotonic audio timeline to standard `<50–100ms` synchronization.
