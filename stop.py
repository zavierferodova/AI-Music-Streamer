#!/usr/bin/env python3
"""
stop.py — Stop audio playback (switches stream to continuous silence mode).
Usage:
  ./stop.py          # Stop playback (stream keeps broadcasting silence)
  ./stop.py --all    # Stop playback AND shut down stream server daemon
"""

import sys
from pathlib import Path

# Ensure package is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from music_streamer.cli import build_stop_parser, handle_stop


def main():
    parser = build_stop_parser()
    args = parser.parse_args()
    sys.exit(handle_stop(args))


if __name__ == "__main__":
    main()
