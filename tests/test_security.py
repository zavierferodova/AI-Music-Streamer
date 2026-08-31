"""Unit tests for OTP & Session Security Manager in music_streamer.security."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from music_streamer.db import DatabaseManager
from music_streamer.security import OTPManager


class TestSecurityManager(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_music_streamer.db"
        self.db = DatabaseManager(self.db_path)
        self.security = OTPManager(self.db)

    def tearDown(self):
        self.db.close()
        self.temp_dir.cleanup()

    def test_default_otp_initialization(self):
        """Ensure initial 6-digit OTP is created and enabled by default."""
        self.assertTrue(self.security.is_enabled())
        otp = self.security.get_current_otp()
        self.assertEqual(len(otp), 6)
        self.assertTrue(otp.isdigit())

    def test_generate_new_otp(self):
        """Verify generation of new random OTP."""
        old_otp = self.security.get_current_otp()
        new_otp = self.security.generate_new_otp()
        self.assertEqual(len(new_otp), 6)
        self.assertTrue(new_otp.isdigit())
        self.assertEqual(self.security.get_current_otp(), new_otp)

    def test_enable_disable_security(self):
        """Verify toggling security status."""
        self.security.set_enabled(False)
        self.assertFalse(self.security.is_enabled())
        self.security.set_enabled(True)
        self.assertTrue(self.security.is_enabled())

    def test_verify_otp_success_and_session_creation(self):
        """Verify successful OTP verification returns valid session token."""
        otp = self.security.get_current_otp()
        ok, token = self.security.verify_otp(otp, client_ip="127.0.0.1")
        self.assertTrue(ok)
        self.assertIsNotNone(token)
        self.assertEqual(len(token), 64)  # 32 bytes hex
        self.assertTrue(self.security.validate_session(token))

    def test_verify_otp_invalid(self):
        """Verify invalid OTP fails."""
        ok, token = self.security.verify_otp("000000", client_ip="127.0.0.1")
        self.assertFalse(ok)
        self.assertEqual(token, "")

    def test_verify_token_directly(self):
        """Verify passing an existing valid session token directly as OTP parameter succeeds."""
        otp = self.security.get_current_otp()
        _, token = self.security.verify_otp(otp, client_ip="127.0.0.1")
        ok, verified_token = self.security.verify_otp(token, client_ip="127.0.0.1")
        self.assertTrue(ok)
        self.assertEqual(verified_token, token)

    def test_single_use_otp_rotation(self):
        """Verify single-use OTP rotates immediately upon successful verification."""
        self.security.generate_new_otp(single_use=True)
        otp1 = self.security.get_current_otp()
        ok, token = self.security.verify_otp(otp1, client_ip="127.0.0.1")
        self.assertTrue(ok)
        otp2 = self.security.get_current_otp()
        self.assertNotEqual(otp1, otp2)

    def test_request_authentication_helpers(self):
        """Verify HTTP request authentication via query params, cookies, and headers."""
        otp = self.security.get_current_otp()
        _, token = self.security.verify_otp(otp, client_ip="127.0.0.1")

        # 1. Query parameter ?token=...
        mock_req = MagicMock()
        mock_req.path = f"/api/status?token={token}"
        mock_req.headers = {}
        mock_req.client_address = ("127.0.0.1", 1234)
        self.assertTrue(self.security.is_request_authenticated(mock_req))

        # 2. Query parameter ?otp=...
        mock_req.path = f"/stream.mp3?otp={self.security.get_current_otp()}"
        self.assertTrue(self.security.is_request_authenticated(mock_req))

        # 3. Cookie header
        mock_req.path = "/api/play"
        mock_req.headers = {"Cookie": f"music_session={token}"}
        self.assertTrue(self.security.is_request_authenticated(mock_req))

        # 4. Authorization Bearer header
        mock_req.headers = {"Authorization": f"Bearer {token}"}
        self.assertTrue(self.security.is_request_authenticated(mock_req))

        # 5. Invalid credentials
        mock_req.headers = {"Authorization": "Bearer bad_token"}
        mock_req.path = "/api/play"
        self.assertFalse(self.security.is_request_authenticated(mock_req))

        # 6. Disabled security allows all
        self.security.set_enabled(False)
        self.assertTrue(self.security.is_request_authenticated(mock_req))


if __name__ == "__main__":
    unittest.main()
