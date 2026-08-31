"""
music_streamer — Refactored, Fully Synchronized Music Streaming Suite.

Modules:
  - config: Centralized configuration, paths, and audio constants.
  - db: Thread-safe SQLite persistence layer (WAL mode).
  - security: OTP authentication & session token management.
  - playback: Persistent playback list, fair shuffle, and loop cycle management.
  - search: Universal music search provider (YouTube, SoundCloud, Bandcamp, Spotify).
  - engine: AudioEngine (yt-dlp -> ffmpeg -> PCM -> ALSA / MP3 stream) & Broadcaster.
  - ipc: Synchronous Unix domain socket & REST API client.
  - server: Threaded HTTP Server, WebSocket Hub (RFC 6455), and Unix socket listener.
  - cli: Unified command-line interface.
"""

__version__ = "2.0.0"
