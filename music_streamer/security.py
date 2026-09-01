"""
One-Time Password (OTP) & Two-Tier Session Security Manager backed by SQLite.
Supports Admin role (full control & playlists) and Subscriber role (stream & track view only).
"""

import http.cookies
import secrets
import sys
import time
from typing import Dict, Optional, Tuple, Union
from urllib.parse import parse_qs, urlparse

from music_streamer.config import SESSION_DURATION_SECONDS
from music_streamer.db import DatabaseManager, db


class OTPManager:
    """Manages 6-digit Admin and Subscriber OTP passcodes and role-based sessions."""

    def __init__(self, database: Optional[DatabaseManager] = None):
        self.db = database or db
        self._init_otp_if_missing()

    def _init_otp_if_missing(self):
        admin_otp = self.db.get_setting("admin_otp")
        if not admin_otp:
            # Fallback / migrate from older single-OTP key if present
            current = self.db.get_setting("current_otp")
            admin_otp = current or f"{secrets.randbelow(900000) + 100000}"
            self.db.set_setting("admin_otp", admin_otp)
            self.db.set_setting("current_otp", admin_otp)
            self.db.set_setting("admin_otp_created_at", str(int(time.time())))
            self.db.set_setting("admin_otp_single_use", "0")

        sub_otp = self.db.get_setting("subscriber_otp")
        if not sub_otp:
            while True:
                candidate = f"{secrets.randbelow(900000) + 100000}"
                if candidate != admin_otp:
                    sub_otp = candidate
                    break
            self.db.set_setting("subscriber_otp", sub_otp)
            self.db.set_setting("subscriber_otp_created_at", str(int(time.time())))
            self.db.set_setting("subscriber_otp_single_use", "0")

        if self.db.get_setting("otp_enabled") is None:
            self.db.set_setting("otp_enabled", "1")

    def is_enabled(self) -> bool:
        return self.db.get_bool_setting("otp_enabled", default=True)

    def set_enabled(self, enabled: bool):
        self.db.set_setting("otp_enabled", "1" if enabled else "0")

    def get_admin_otp(self) -> str:
        self._init_otp_if_missing()
        return self.db.get_setting("admin_otp", self.db.get_setting("current_otp", "123456"))

    def get_subscriber_otp(self) -> str:
        self._init_otp_if_missing()
        return self.db.get_setting("subscriber_otp", "654321")

    def get_current_otp(self, role: str = "admin") -> str:
        """Backward-compatible helper returning current OTP for specified role."""
        if role == "subscriber":
            return self.get_subscriber_otp()
        return self.get_admin_otp()

    def generate_new_otp(self, role: str = "all", single_use: bool = False) -> Union[str, Dict[str, str]]:
        """
        Generates fresh cryptographically secure 6-digit OTP code(s).
        role: 'admin', 'subscriber', or 'all'/'both'
        """
        now = str(int(time.time()))
        single_val = "1" if single_use else "0"

        if role == "admin":
            sub_otp = self.get_subscriber_otp()
            while True:
                new_admin = f"{secrets.randbelow(900000) + 100000}"
                if new_admin != sub_otp:
                    break
            self.db.set_setting("admin_otp", new_admin)
            self.db.set_setting("current_otp", new_admin)
            self.db.set_setting("admin_otp_created_at", now)
            self.db.set_setting("admin_otp_single_use", single_val)
            return new_admin

        elif role == "subscriber":
            admin_otp = self.get_admin_otp()
            while True:
                new_sub = f"{secrets.randbelow(900000) + 100000}"
                if new_sub != admin_otp:
                    break
            self.db.set_setting("subscriber_otp", new_sub)
            self.db.set_setting("subscriber_otp_created_at", now)
            self.db.set_setting("subscriber_otp_single_use", single_val)
            return new_sub

        else:
            # Generate both
            new_admin = f"{secrets.randbelow(900000) + 100000}"
            while True:
                new_sub = f"{secrets.randbelow(900000) + 100000}"
                if new_sub != new_admin:
                    break
            self.db.set_setting("admin_otp", new_admin)
            self.db.set_setting("current_otp", new_admin)
            self.db.set_setting("admin_otp_created_at", now)
            self.db.set_setting("admin_otp_single_use", single_val)
            self.db.set_setting("subscriber_otp", new_sub)
            self.db.set_setting("subscriber_otp_created_at", now)
            self.db.set_setting("subscriber_otp_single_use", single_val)
            return {"admin": new_admin, "subscriber": new_sub}

    def create_session(self, client_ip: str = "unknown", role: str = "admin") -> str:
        """Generates a 32-byte session token valid for SESSION_DURATION_SECONDS."""
        token = secrets.token_hex(32)
        self.db.create_session(token, client_ip=client_ip, role=role, duration_seconds=SESSION_DURATION_SECONDS)
        return token

    def get_sessions(self) -> Dict[str, Dict]:
        return self.db.get_all_active_sessions()

    def get_token_role(self, token: str) -> Optional[str]:
        if not token:
            return None
        return self.db.get_session_role(token.strip())

    def verify_otp(self, input_otp: str, client_ip: str = "unknown") -> Tuple[bool, str, str]:
        """
        Verifies input OTP code or existing session token.
        Returns: (success: bool, session_token: str, role: str)
        """
        if not input_otp:
            return False, "", ""

        clean_input = input_otp.strip()

        # 1. Direct token validation fallback
        token_role = self.get_token_role(clean_input)
        if token_role:
            return True, clean_input, token_role

        # 2. Check Admin OTP
        admin_otp = self.get_admin_otp()
        if clean_input == admin_otp:
            token = self.create_session(client_ip=client_ip, role="admin")
            if self.db.get_bool_setting("admin_otp_single_use"):
                self.generate_new_otp(role="admin", single_use=True)
            return True, token, "admin"

        # 3. Check Subscriber OTP
        sub_otp = self.get_subscriber_otp()
        if clean_input == sub_otp:
            token = self.create_session(client_ip=client_ip, role="subscriber")
            if self.db.get_bool_setting("subscriber_otp_single_use"):
                self.generate_new_otp(role="subscriber", single_use=True)
            return True, token, "subscriber"

        return False, "", ""

    def validate_session(self, token: str) -> bool:
        if not token:
            return False
        return self.db.validate_session(token.strip())

    def get_request_role(self, handler) -> Optional[str]:
        """
        Extracts authenticated role ('admin' or 'subscriber') from incoming HTTP request.
        Returns 'admin' if security is disabled.
        Returns None if not authenticated.
        """
        if not self.is_enabled():
            return "admin"

        # 1. Check Query Params
        try:
            parsed = urlparse(handler.path)
            qs = parse_qs(parsed.query)

            query_token = qs.get("token", [None])[0]
            if query_token:
                role = self.get_token_role(query_token)
                if role:
                    return role

            query_otp = qs.get("otp", [None])[0]
            if query_otp:
                client_ip = getattr(handler, "client_address", ("unknown",))[0]
                ok, _, role = self.verify_otp(query_otp, client_ip)
                if ok:
                    return role
        except Exception:
            pass

        # 2. Check Cookie header
        try:
            cookie_header = handler.headers.get("Cookie") if hasattr(handler, "headers") else None
            if cookie_header:
                c = http.cookies.SimpleCookie(cookie_header)
                if "music_session" in c:
                    token = c["music_session"].value
                    role = self.get_token_role(token)
                    if role:
                        return role
        except Exception:
            pass

        # 3. Check Authorization header
        try:
            auth_header = handler.headers.get("Authorization", "") if hasattr(handler, "headers") else ""
            if auth_header.startswith("Bearer "):
                token = auth_header[7:].strip()
                role = self.get_token_role(token)
                if role:
                    return role
        except Exception:
            pass

        return None

    def is_request_authenticated(self, handler, required_role: Optional[str] = None) -> bool:
        """
        Checks if request meets authentication requirements:
          - required_role = 'admin': must be authenticated as admin
          - required_role = 'subscriber': must be authenticated as admin or subscriber
          - required_role = None: any valid authenticated session
        """
        if not self.is_enabled():
            return True

        role = self.get_request_role(handler)
        if not role:
            return False

        if required_role == "admin":
            return role == "admin"
        elif required_role == "subscriber":
            return role in ["admin", "subscriber"]
        return True


# Global singleton instance
security = OTPManager()
