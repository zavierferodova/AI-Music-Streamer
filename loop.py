#!/usr/bin/env python3
"""
loop.py — Get or set loop mode while playing.
Usage:
  ./loop.py              # show current loop state
  ./loop.py repeat       # loop entire tracklist from first (by order/shuffle)
  ./loop.py repeat-one   # repeat single current music continuously
  ./loop.py off          # disable loop (play once, then stop)
  ./loop.py toggle       # cycle through repeat -> repeat-one -> off
  ./loop.py status       # alias for show
"""

import sys
from pathlib import Path

# Ensure package is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from music_streamer.cli import build_loop_parser, handle_loop


def main():
    parser = build_loop_parser()
    args = parser.parse_args()
    sys.exit(handle_loop(args))


if __name__ == "__main__":
    main()
