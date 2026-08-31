"""
One-Time Password (OTP) & Session Security Manager backed by SQLite.
"""

import http.cookies
import secrets
import sys
import time
from typing import Dict, Optional, Tuple
from urllib.parse import parse_qs, urlparse

from music_streamer.config import SESSION_DURATION_SECONDS
from music_streamer.db import DatabaseManager, db


class OTPManager:
    """Manages 6-digit OTP passcodes and persistent authenticated sessions."""

    def __init__(self, database: Optional[DatabaseManager] = None):
        self.db = database or db
        self._init_otp_if_missing()

    def _init_otp_if_missing(self):
        current = self.db.get_setting("current_otp")
        if not current:
            initial_otp = f"{secrets.randbelow(900000) + 100000}"
            self.db.set_setting("current_otp", initial_otp)
            self.db.set_setting("otp_created_at", str(int(time.time())))
            self.db.set_setting("otp_single_use", "0")
            if self.db.get_setting("otp_enabled") is None:
                self.db.set_setting("otp_enabled", "1")

    def is_enabled(self) -> bool:
        return self.db.get_bool_setting("otp_enabled", default=True)

    def set_enabled(self, enabled: bool):
        self.db.set_setting("otp_enabled", "1" if enabled else "0")

    def get_current_otp(self) -> str:
        self._init_otp_if_missing()
        return self.db.get_setting("current_otp", "123456")

    def generate_new_otp(self, single_use: bool = False) -> str:
        """Generates a fresh cryptographically secure 6-digit OTP code."""
        new_otp = f"{secrets.randbelow(900000) + 100000}"
        self.db.set_setting("current_otp", new_otp)
        self.db.set_setting("otp_created_at", str(int(time.time())))
        self.db.set_setting("otp_single_use", "1" if single_use else "0")
        return new_otp

    def create_session(self, client_ip: str = "unknown") -> str:
        """Generates a 32-byte session token valid for SESSION_DURATION_SECONDS."""
        token = secrets.token_hex(32)
        self.db.create_session(token, client_ip=client_ip, duration_seconds=SESSION_DURATION_SECONDS)
        return token

    def get_sessions(self) -> Dict[str, Dict]:
        return self.db.get_all_active_sessions()

    def verify_otp(self, input_otp: str, client_ip: str = "unknown") -> Tuple[bool, str]:
        """
        Verifies input OTP.
        If valid, generates a session token and optionally rolls a new OTP if single_use is configured.
        Returns: (success: bool, session_token: str)
        """
        if not input_otp:
            return False, ""

        clean_input = input_otp.strip()

        # 1. Direct token validation fallback
        if self.db.validate_session(clean_input):
            return True, clean_input

        # 2. Check current OTP
        current_otp = self.get_current_otp()
        if clean_input == current_otp:
            token = self.create_session(client_ip)
            if self.db.get_bool_setting("otp_single_use"):
                self.generate_new_otp(single_use=True)
            return True, token

        return False, ""

    def validate_session(self, token: str) -> bool:
        if not token:
            return False
        return self.db.validate_session(token.strip())

    def is_request_authenticated(self, handler) -> bool:
        """
        Checks if an incoming HTTP request is authenticated via:
          1. Security disabled in settings
          2. Query param: ?token=<token> or ?otp=<code>
          3. Cookie: music_session=<token>
          4. Authorization: Bearer <token>
        """
        if not self.is_enabled():
            return True

        # 1. Check Query Params
        try:
            parsed = urlparse(handler.path)
            qs = parse_qs(parsed.query)

            query_token = qs.get("token", [None])[0]
            if query_token and self.validate_session(query_token):
                return True

            query_otp = qs.get("otp", [None])[0]
            if query_otp:
                ok, _ = self.verify_otp(query_otp, getattr(handler, "client_address", ("unknown",))[0])
                if ok:
                    return True
        except Exception:
            pass

        # 2. Check Cookie header
        try:
            cookie_header = handler.headers.get("Cookie") if hasattr(handler, "headers") else None
            if cookie_header:
                c = http.cookies.SimpleCookie(cookie_header)
                if "music_session" in c:
                    token = c["music_session"].value
                    if self.validate_session(token):
                        return True
        except Exception:
            pass

        # 3. Check Authorization header
        try:
            auth_header = handler.headers.get("Authorization", "") if hasattr(handler, "headers") else ""
            if auth_header.startswith("Bearer "):
                token = auth_header[7:].strip()
                if self.validate_session(token):
                    return True
        except Exception:
            pass

        return False


# Global singleton instance
security = OTPManager()
