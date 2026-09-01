"""Unit tests for Two-Tier OTP & Session Security Manager in music_streamer.security."""

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
        """Ensure initial 6-digit OTPs for both Admin and Subscriber are created and unique."""
        self.assertTrue(self.security.is_enabled())
        admin_otp = self.security.get_admin_otp()
        sub_otp = self.security.get_subscriber_otp()

        self.assertEqual(len(admin_otp), 6)
        self.assertTrue(admin_otp.isdigit())
        self.assertEqual(len(sub_otp), 6)
        self.assertTrue(sub_otp.isdigit())
        self.assertNotEqual(admin_otp, sub_otp)

    def test_generate_new_otp(self):
        """Verify generation of new random OTPs for specific roles and all."""
        old_admin = self.security.get_admin_otp()
        old_sub = self.security.get_subscriber_otp()

        # 1. Regenerate admin only
        new_admin = self.security.generate_new_otp(role="admin")
        self.assertEqual(len(new_admin), 6)
        self.assertEqual(self.security.get_admin_otp(), new_admin)
        self.assertEqual(self.security.get_subscriber_otp(), old_sub)

        # 2. Regenerate subscriber only
        new_sub = self.security.generate_new_otp(role="subscriber")
        self.assertEqual(len(new_sub), 6)
        self.assertEqual(self.security.get_subscriber_otp(), new_sub)
        self.assertEqual(self.security.get_admin_otp(), new_admin)

        # 3. Regenerate all
        new_both = self.security.generate_new_otp(role="all")
        self.assertIn("admin", new_both)
        self.assertIn("subscriber", new_both)
        self.assertNotEqual(new_both["admin"], new_both["subscriber"])
        self.assertEqual(self.security.get_admin_otp(), new_both["admin"])
        self.assertEqual(self.security.get_subscriber_otp(), new_both["subscriber"])

    def test_enable_disable_security(self):
        """Verify toggling security status."""
        self.security.set_enabled(False)
        self.assertFalse(self.security.is_enabled())
        self.security.set_enabled(True)
        self.assertTrue(self.security.is_enabled())

    def test_verify_admin_otp_and_session_role(self):
        """Verify Admin OTP returns valid admin session token and role."""
        admin_otp = self.security.get_admin_otp()
        ok, token, role = self.security.verify_otp(admin_otp, client_ip="127.0.0.1")
        self.assertTrue(ok)
        self.assertEqual(role, "admin")
        self.assertEqual(len(token), 64)  # 32 bytes hex
        self.assertTrue(self.security.validate_session(token))
        self.assertEqual(self.security.get_token_role(token), "admin")

    def test_verify_subscriber_otp_and_session_role(self):
        """Verify Subscriber OTP returns valid subscriber session token and role."""
        sub_otp = self.security.get_subscriber_otp()
        ok, token, role = self.security.verify_otp(sub_otp, client_ip="127.0.0.1")
        self.assertTrue(ok)
        self.assertEqual(role, "subscriber")
        self.assertEqual(len(token), 64)
        self.assertTrue(self.security.validate_session(token))
        self.assertEqual(self.security.get_token_role(token), "subscriber")

    def test_verify_otp_invalid(self):
        """Verify invalid OTP fails."""
        ok, token, role = self.security.verify_otp("000000", client_ip="127.0.0.1")
        self.assertFalse(ok)
        self.assertEqual(token, "")
        self.assertEqual(role, "")

    def test_verify_token_directly(self):
        """Verify passing an existing valid session token directly returns its correct role."""
        admin_otp = self.security.get_admin_otp()
        _, token, _ = self.security.verify_otp(admin_otp, client_ip="127.0.0.1")
        ok, verified_token, role = self.security.verify_otp(token, client_ip="127.0.0.1")
        self.assertTrue(ok)
        self.assertEqual(verified_token, token)
        self.assertEqual(role, "admin")

    def test_single_use_otp_rotation(self):
        """Verify single-use OTP rotates immediately upon successful verification."""
        self.security.generate_new_otp(role="admin", single_use=True)
        otp1 = self.security.get_admin_otp()
        ok, token, role = self.security.verify_otp(otp1, client_ip="127.0.0.1")
        self.assertTrue(ok)
        self.assertEqual(role, "admin")
        otp2 = self.security.get_admin_otp()
        self.assertNotEqual(otp1, otp2)

    def test_role_based_request_authentication(self):
        """Verify role authorization for admin vs subscriber requests."""
        admin_otp = self.security.get_admin_otp()
        _, admin_token, _ = self.security.verify_otp(admin_otp, client_ip="127.0.0.1")

        sub_otp = self.security.get_subscriber_otp()
        _, sub_token, _ = self.security.verify_otp(sub_otp, client_ip="127.0.0.1")

        # Mock Admin Request
        admin_req = MagicMock()
        admin_req.path = f"/api/play?token={admin_token}"
        admin_req.headers = {}
        admin_req.client_address = ("127.0.0.1", 1234)

        # Mock Subscriber Request
        sub_req = MagicMock()
        sub_req.path = f"/stream.mp3?token={sub_token}"
        sub_req.headers = {}
        sub_req.client_address = ("127.0.0.1", 5678)

        # Mock Unauthenticated Request
        unauth_req = MagicMock()
        unauth_req.path = "/api/status"
        unauth_req.headers = {}
        unauth_req.client_address = ("127.0.0.1", 9999)

        # Test roles extraction
        self.assertEqual(self.security.get_request_role(admin_req), "admin")
        self.assertEqual(self.security.get_request_role(sub_req), "subscriber")
        self.assertIsNone(self.security.get_request_role(unauth_req))

        # Admin requirements
        self.assertTrue(self.security.is_request_authenticated(admin_req, required_role="admin"))
        self.assertFalse(self.security.is_request_authenticated(sub_req, required_role="admin"))
        self.assertFalse(self.security.is_request_authenticated(unauth_req, required_role="admin"))

        # Subscriber requirements (allows both admin and subscriber)
        self.assertTrue(self.security.is_request_authenticated(admin_req, required_role="subscriber"))
        self.assertTrue(self.security.is_request_authenticated(sub_req, required_role="subscriber"))
        self.assertFalse(self.security.is_request_authenticated(unauth_req, required_role="subscriber"))

        # General auth requirements
        self.assertTrue(self.security.is_request_authenticated(admin_req))
        self.assertTrue(self.security.is_request_authenticated(sub_req))
        self.assertFalse(self.security.is_request_authenticated(unauth_req))

        # Disabled security allows all
        self.security.set_enabled(False)
        self.assertTrue(self.security.is_request_authenticated(unauth_req, required_role="admin"))
        self.assertTrue(self.security.is_request_authenticated(unauth_req, required_role="subscriber"))


if __name__ == "__main__":
    unittest.main()
