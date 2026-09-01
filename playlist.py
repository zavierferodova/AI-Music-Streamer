#!/usr/bin/env python3
"""
playlist.py — Manage persistent named playlists stored in SQLite
Usage:
  ./playlist.py create <NAME>
  ./playlist.py rename <OLD_NAME> <NEW_NAME>
  ./playlist.py list [--json]
  ./playlist.py show <NAME> [--json]
  ./playlist.py add <NAME> <URL|query...>
  ./playlist.py add-bulk <NAME> <TRACK1> <TRACK2> ...
  ./playlist.py add-bulk <NAME> --file <tracks.txt|tracks.json>
  ./playlist.py add-bulk <NAME> -  # Read tracks from stdin
  ./playlist.py remove <NAME> <INDEX|ID|TITLE...>
  ./playlist.py remove-bulk <NAME> <ITEM1> <ITEM2> ...
  ./playlist.py remove-bulk <NAME> --file <remove.txt|remove.json>
  ./playlist.py remove-bulk <NAME> -  # Read items to remove from stdin
  ./playlist.py delete <NAME>
  ./playlist.py play <NAME> [--shuffle]
  ./playlist.py queue <NAME> [--shuffle]
"""

import sys
from pathlib import Path

# Ensure package is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from music_streamer.cli import build_playlist_parser, handle_playlist


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ["-h", "--help", "help"]:
        print(__doc__.strip())
        sys.exit(0)

    parser = build_playlist_parser()
    args = parser.parse_args()
    sys.exit(handle_playlist(args))


if __name__ == "__main__":
    main()
