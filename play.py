#!/usr/bin/env python3
"""
play.py — Play audio from a URL (YouTube, etc.) on local ALSA & live stream in sync.
Usage:
  ./play.py "URL" [VOLUME 0-100] [LOOP yes|no]
"""

import sys
from pathlib import Path

# Ensure package is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from music_streamer.cli import build_play_parser, handle_play


def main():
    parser = build_play_parser()
    args = parser.parse_args()
    sys.exit(handle_play(args))


if __name__ == "__main__":
    main()
