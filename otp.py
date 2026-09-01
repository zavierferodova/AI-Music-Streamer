#!/usr/bin/env python3
"""
otp.py — Two-Tier One-Time Password (OTP) & Stream Security Manager
Usage:
  ./otp.py                          # Show Admin & Subscriber OTPs and quick access links
  ./otp.py new [admin|subscriber]   # Generate new OTP code (admin, subscriber, or all)
  ./otp.py on                       # Enable OTP security protection
  ./otp.py off                      # Disable OTP security protection
  ./otp.py sessions                 # List active authenticated sessions with roles
"""

import sys
from pathlib import Path

# Ensure package is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from music_streamer.cli import build_otp_parser, handle_otp


def main():
    parser = build_otp_parser()
    args = parser.parse_args()
    sys.exit(handle_otp(args))


if __name__ == "__main__":
    main()
