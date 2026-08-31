#!/usr/bin/env python3
"""
search.py — Search music and return YouTube/SoundCloud/Bandcamp results.
Usage:
  ./search.py "query" [NUM]
  ./search.py --json "query" [NUM]
  ./search.py --first "query"
  ./search.py --url N "query"
  ./search.py --id N "query"
"""

import sys
from pathlib import Path

# Ensure package is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from music_streamer.cli import build_search_parser, handle_search


def main():
    parser = build_search_parser()
    args = parser.parse_args()
    sys.exit(handle_search(args))


if __name__ == "__main__":
    main()
