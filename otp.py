#!/usr/bin/env python3
"""
otp.py — One-Time Password (OTP) & Stream Security Manager
Usage:
  ./otp.py               # Show current active OTP and quick access links
  ./otp.py new           # Generate a new OTP code
  ./otp.py on            # Enable OTP security protection
  ./otp.py off           # Disable OTP security protection
  ./otp.py sessions      # List active authenticated sessions
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
