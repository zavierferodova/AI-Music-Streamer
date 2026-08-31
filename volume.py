#!/usr/bin/env python3
"""
volume.py — Adjust ALSA volume while playing (or paused).
Usage:
  ./volume.py 75        # set absolute
  ./volume.py +10       # increase by 10
  ./volume.py -10       # decrease by 10
  ./volume.py mute      # mute
  ./volume.py unmute    # unmute
  ./volume.py           # show current volume
"""

import sys
from pathlib import Path

# Ensure package is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from music_streamer.cli import build_volume_parser, handle_volume


def main():
    parser = build_volume_parser()
    args = parser.parse_args()
    sys.exit(handle_volume(args))


if __name__ == "__main__":
    main()
