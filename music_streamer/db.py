"""
SQLite Database Layer (WAL Mode) for state persistence and synchronization.
"""

import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

from music_streamer.config import DB_PATH, SESSION_DURATION_SECONDS


class DatabaseManager:
    """Thread-safe and process-safe SQLite database manager with WAL mode."""

    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self._init_db()

    def _get_raw_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(
            str(self.db_path),
            timeout=10.0,
            check_same_thread=False,
            isolation_level=None,  # Autocommit mode, explicit transactions when needed
        )
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL;")
        cur.execute("PRAGMA busy_timeout=5000;")
        cur.execute("PRAGMA synchronous=NORMAL;")
        cur.close()
        return conn

    @contextmanager
    def get_connection(self):
        """Context manager providing thread-locked access to the database."""
        with self.lock:
            conn = self._get_raw_connection()
            try:
                yield conn
            finally:
                conn.close()

    def _init_db(self):
        """Initialize table schemas and indexes."""
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS playback_tracks (
                    id TEXT PRIMARY KEY,
                    url TEXT NOT NULL,
                    title TEXT NOT NULL,
                    thumbnail TEXT,
                    status TEXT NOT NULL,
                    sort_order INTEGER NOT NULL,
                    added_at INTEGER NOT NULL,
                    played_at INTEGER
                );
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_playback_status ON playback_tracks(status);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_playback_order ON playback_tracks(sort_order);")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS otp_sessions (
                    token TEXT PRIMARY KEY,
                    client_ip TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL
                );
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_sessions(expires_at);")

            # Set default settings if absent
            defaults = {
                "state": "stopped",
                "volume": "80",
                "loop": "yes",
                "mode": "silent",
                "playback_mode": "ordered",
                "otp_enabled": "1",
                "current_url": "",
                "current_title": "",
                "current_thumbnail": "",
                "last_played_url": "",
            }
            now = int(time.time())
            for k, v in defaults.items():
                cur.execute(
                    "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?);",
                    (k, v, now),
                )
            cur.close()

    def close(self):
        pass

    # -------------------------------------------------------------------------
    # Settings Key-Value Store
    # -------------------------------------------------------------------------

    def get_setting(self, key: str, default: Optional[str] = None) -> Optional[str]:
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT value FROM settings WHERE key = ?;", (key,))
            row = cur.fetchone()
            cur.close()
            return row["value"] if row else default

    def get_int_setting(self, key: str, default: int = 0) -> int:
        val = self.get_setting(key)
        if val is None:
            return default
        try:
            return int(val)
        except (ValueError, TypeError):
            return default

    def get_bool_setting(self, key: str, default: bool = False) -> bool:
        val = self.get_setting(key)
        if val is None:
            return default
        return val.lower() in ["1", "true", "yes", "on"]

    def set_setting(self, key: str, value: Any):
        with self.get_connection() as conn:
            cur = conn.cursor()
            now = int(time.time())
            cur.execute(
                """
                INSERT INTO settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
                """,
                (key, str(value), now),
            )
            cur.close()

    def get_all_settings(self) -> Dict[str, str]:
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT key, value FROM settings;")
            rows = cur.fetchall()
            cur.close()
            return {r["key"]: r["value"] for r in rows}

    def delete_setting(self, key: str):
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM settings WHERE key = ?;", (key,))
            cur.close()

    # -------------------------------------------------------------------------
    # Playback Track Storage
    # -------------------------------------------------------------------------

    def add_track(
        self,
        url: str,
        title: str = "",
        thumbnail: str = "",
        status: str = "queued",
        added_at: Optional[int] = None,
    ) -> Dict[str, Any]:
        with self.get_connection() as conn:
            cur = conn.cursor()
            now = added_at or int(time.time())
            # Find next sort order
            cur.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM playback_tracks;")
            next_order = cur.fetchone()["next_order"]
            track_id = f"{int(now * 1000)}_{next_order}"

            track = {
                "id": track_id,
                "url": url,
                "title": title or url,
                "thumbnail": thumbnail or "",
                "status": status,
                "sort_order": next_order,
                "added_at": now,
                "played_at": None,
            }
            cur.execute(
                """
                INSERT INTO playback_tracks (id, url, title, thumbnail, status, sort_order, added_at, played_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    track["id"],
                    track["url"],
                    track["title"],
                    track["thumbnail"],
                    track["status"],
                    track["sort_order"],
                    track["added_at"],
                    track["played_at"],
                ),
            )
            cur.close()
            return track

    def get_tracks(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        with self.get_connection() as conn:
            cur = conn.cursor()
            if status:
                cur.execute(
                    "SELECT * FROM playback_tracks WHERE status = ? ORDER BY sort_order ASC;",
                    (status,),
                )
            else:
                cur.execute("SELECT * FROM playback_tracks ORDER BY sort_order ASC;")
            rows = cur.fetchall()
            cur.close()
            return [dict(r) for r in rows]

    def get_track_by_id(self, track_id: str) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM playback_tracks WHERE id = ?;", (str(track_id),))
            row = cur.fetchone()
            cur.close()
            return dict(row) if row else None

    def update_track_status(self, track_id: str, status: str, played_at: Optional[int] = None):
        with self.get_connection() as conn:
            cur = conn.cursor()
            if played_at is None and status == "played":
                played_at = int(time.time())
            cur.execute(
                "UPDATE playback_tracks SET status = ?, played_at = ? WHERE id = ?;",
                (status, played_at, str(track_id)),
            )
            cur.close()

    def update_track_info(self, track_id: str, title: Optional[str] = None, thumbnail: Optional[str] = None):
        with self.get_connection() as conn:
            cur = conn.cursor()
            if title is not None and thumbnail is not None:
                cur.execute(
                    "UPDATE playback_tracks SET title = ?, thumbnail = ? WHERE id = ?;",
                    (title, thumbnail, str(track_id)),
                )
            elif title is not None:
                cur.execute(
                    "UPDATE playback_tracks SET title = ? WHERE id = ?;",
                    (title, str(track_id)),
                )
            elif thumbnail is not None:
                cur.execute(
                    "UPDATE playback_tracks SET thumbnail = ? WHERE id = ?;",
                    (thumbnail, str(track_id)),
                )
            cur.close()

    def reorder_tracks(self, track_ids: List[str]):
        with self.get_connection() as conn:
            cur = conn.cursor()
            for idx, tid in enumerate(track_ids):
                cur.execute(
                    "UPDATE playback_tracks SET sort_order = ? WHERE id = ?;",
                    (idx, str(tid)),
                )
            cur.close()

    def remove_track_by_id(self, track_id: str) -> bool:
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM playback_tracks WHERE id = ?;", (str(track_id),))
            deleted = cur.rowcount > 0
            cur.close()
            return deleted

    def remove_track_by_index(self, index: int) -> bool:
        tracks = self.get_tracks()
        if 0 <= index < len(tracks):
            return self.remove_track_by_id(tracks[index]["id"])
        return False

    def reset_track_history(self):
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE playback_tracks SET status = 'queued', played_at = NULL;")
            cur.close()

    def clear_all_tracks(self):
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM playback_tracks;")
            cur.close()

    # -------------------------------------------------------------------------
    # OTP Sessions Storage
    # -------------------------------------------------------------------------

    def create_session(
        self,
        token: str,
        client_ip: str = "unknown",
        duration_seconds: int = SESSION_DURATION_SECONDS,
    ) -> str:
        with self.get_connection() as conn:
            cur = conn.cursor()
            now = int(time.time())
            expires_at = now + duration_seconds
            cur.execute(
                """
                INSERT INTO otp_sessions (token, client_ip, created_at, expires_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(token) DO UPDATE SET client_ip = excluded.client_ip, expires_at = excluded.expires_at;
                """,
                (token, client_ip, now, expires_at),
            )
            cur.close()
            return token

    def get_session(self, token: str) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM otp_sessions WHERE token = ?;", (token,))
            row = cur.fetchone()
            cur.close()
            return dict(row) if row else None

    def validate_session(self, token: str) -> bool:
        if not token:
            return False
        with self.get_connection() as conn:
            cur = conn.cursor()
            now = int(time.time())
            cur.execute(
                "SELECT token FROM otp_sessions WHERE token = ? AND expires_at > ?;",
                (token, now),
            )
            row = cur.fetchone()
            cur.close()
            return row is not None

    def prune_expired_sessions(self):
        with self.get_connection() as conn:
            cur = conn.cursor()
            now = int(time.time())
            cur.execute("DELETE FROM otp_sessions WHERE expires_at <= ?;", (now,))
            cur.close()

    def get_all_active_sessions(self) -> Dict[str, Dict[str, Any]]:
        self.prune_expired_sessions()
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM otp_sessions;")
            rows = cur.fetchall()
            cur.close()
            return {r["token"]: dict(r) for r in rows}


# Global singleton instance
db = DatabaseManager()
