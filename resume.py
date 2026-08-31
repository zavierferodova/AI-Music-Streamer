#!/usr/bin/env python3
"""
resume.py — Resume playback after pause.
"""

import sys
from pathlib import Path

# Ensure package is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from music_streamer.cli import handle_resume
import argparse


def main():
    sys.exit(handle_resume(argparse.Namespace()))


if __name__ == "__main__":
    main()
