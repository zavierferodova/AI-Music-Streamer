#!/usr/bin/env python3
"""
play_search.py — Search and immediately play the first result.
Usage:
  ./play_search.py "query" [VOLUME] [LOOP]
"""

import sys
from pathlib import Path

# Ensure package is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from music_streamer.cli import build_play_parser, handle_play


def main():
    if len(sys.argv) < 2:
        print("Usage: play_search.py <query> [VOLUME 0-100] [LOOP yes|no]", file=sys.stderr)
        sys.exit(1)

    query = sys.argv[1]
    volume = sys.argv[2] if len(sys.argv) > 2 else None
    loop = sys.argv[3] if len(sys.argv) > 3 else "yes"

    parser = build_play_parser()
    args = parser.parse_args([query, volume, loop] if volume else [query])
    sys.exit(handle_play(args))


if __name__ == "__main__":
    main()
