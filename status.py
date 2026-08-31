#!/usr/bin/env python3
"""
status.py — Show current player & stream server status
Usage:
  ./status.py           # human-readable
  ./status.py --json    # JSON for AI/tools
"""

import sys
from pathlib import Path

# Ensure package is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from music_streamer.cli import build_status_parser, handle_status


def main():
    parser = build_status_parser()
    args = parser.parse_args()
    sys.exit(handle_status(args))


if __name__ == "__main__":
    main()
