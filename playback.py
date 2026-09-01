#!/usr/bin/env python3
"""
playback.py — Manage persistent playback list & track history
Usage:
  ./playback.py add <URL|query> [--next|--last|--after <target>|--before <target>|--position <N>]
  ./playback.py add-url <URL> [TITLE] [--next|--last|--after <target>|--before <target>|--position <N>]
  ./playback.py add-bulk <URL1|QUERY1> <URL2|QUERY2> ... [--next|--after <target>|--position <N>]
  ./playback.py add-bulk --file <tracks.txt|tracks.json> [--next|--after <target>|--position <N>]
  ./playback.py add-bulk - [--next|--after <target>|--position <N>]  # Read from stdin
  ./playback.py add <URL|query> [next|last|after <target>|before <target>|<N>]
  ./playback.py list [--json]
  ./playback.py move <FROM_N|TITLE> <TO_N|top|next|bottom>
  ./playback.py play-next <N|TITLE|URL>
  ./playback.py reorder <N1> <N2> ...
  ./playback.py shuffle
  ./playback.py next
  ./playback.py prev
  ./playback.py play [N]
  ./playback.py interrupt <URL|query>
  ./playback.py remove <N>
  ./playback.py reset-history
  ./playback.py clear
"""

import sys
from pathlib import Path

# Ensure package is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from music_streamer.cli import build_playback_parser, handle_playback


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ["-h", "--help", "help"]:
        print(__doc__.strip())
        sys.exit(0)

    parser = build_playback_parser()
    args = parser.parse_args()
    sys.exit(handle_playback(args))


if __name__ == "__main__":
    main()
