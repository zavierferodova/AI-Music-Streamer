#!/usr/bin/env python3
"""
stream.py — Manage continuous HTTP stream server & broadcast station
"""

import sys
from pathlib import Path

# Ensure package is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from music_streamer.cli import build_stream_parser, handle_stream


def main():
    parser = build_stream_parser()
    args = parser.parse_args()
    sys.exit(handle_stream(args))


if __name__ == "__main__":
    main()
