#!/usr/bin/env python3
"""
pause.py — Pause playback (mutes ALSA speaker and streams silence to clients).
"""

import sys
from pathlib import Path

# Ensure package is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from music_streamer.cli import handle_pause
import argparse


def main():
    sys.exit(handle_pause(argparse.Namespace()))


if __name__ == "__main__":
    main()
