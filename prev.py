#!/usr/bin/env python3
"""
prev.py — Play previous track from playback list.
"""

import argparse
import sys
from pathlib import Path

# Ensure package is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from music_streamer.cli import handle_prev


def main():
    sys.exit(handle_prev(argparse.Namespace()))


if __name__ == "__main__":
    main()
