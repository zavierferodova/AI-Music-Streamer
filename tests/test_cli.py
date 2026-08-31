"""Unit tests for CLI argument parsers in music_streamer.cli."""

import unittest

from music_streamer.cli import (
    build_loop_parser,
    build_otp_parser,
    build_play_parser,
    build_playback_parser,
    build_playlist_parser,
    build_search_parser,
    build_status_parser,
    build_stop_parser,
    build_stream_parser,
    build_volume_parser,
)


class TestCLI(unittest.TestCase):
    def test_play_parser(self):
        """Verify play CLI arguments."""
        parser = build_play_parser()
        args = parser.parse_args(["https://youtube.com/watch?v=123", "75", "no"])
        self.assertEqual(args.url, "https://youtube.com/watch?v=123")
        self.assertEqual(args.volume, "75")
        self.assertEqual(args.loop, "no")

    def test_search_parser(self):
        """Verify search CLI arguments."""
        parser = build_search_parser()
        args = parser.parse_args(["Alan Walker", "--num", "3", "--json", "--provider", "youtube"])
        self.assertEqual(args.query, ["Alan Walker"])
        self.assertEqual(args.num, 3)
        self.assertTrue(args.json)
        self.assertEqual(args.provider, "youtube")

    def test_playback_parser(self):
        """Verify playback CLI subcommands."""
        parser = build_playback_parser()
        args = parser.parse_args(["add", "https://youtube.com/watch?v=123"])
        self.assertEqual(args.command, "add")
        self.assertEqual(args.target, ["https://youtube.com/watch?v=123"])

        args_list = parser.parse_args(["list", "--json"])
        self.assertEqual(args_list.command, "list")
        self.assertTrue(args_list.json)

    def test_volume_parser(self):
        """Verify volume CLI arguments."""
        parser = build_volume_parser()
        self.assertEqual(parser.parse_args(["70"]).volume, "70")
        self.assertEqual(parser.parse_args(["+10"]).volume, "+10")
        self.assertEqual(parser.parse_args(["mute"]).volume, "mute")

    def test_loop_parser(self):
        """Verify loop CLI arguments."""
        parser = build_loop_parser()
        self.assertEqual(parser.parse_args(["yes"]).mode, "yes")
        self.assertEqual(parser.parse_args(["toggle"]).mode, "toggle")

    def test_otp_parser(self):
        """Verify OTP CLI subcommands."""
        parser = build_otp_parser()
        self.assertEqual(parser.parse_args(["new"]).command, "new")
        self.assertEqual(parser.parse_args(["on"]).command, "on")

    def test_status_parser(self):
        """Verify status CLI arguments."""
        parser = build_status_parser()
        self.assertTrue(parser.parse_args(["--json"]).json)

    def test_stop_parser(self):
        """Verify stop CLI arguments."""
        parser = build_stop_parser()
        self.assertTrue(parser.parse_args(["--all"]).all)

    def test_stream_parser(self):
        """Verify stream server CLI arguments."""
        parser = build_stream_parser()
        args = parser.parse_args(["--daemon", "--mode", "speaker", "--port", "9000"])
        self.assertTrue(args.daemon)
        self.assertEqual(args.mode, "speaker")
        self.assertEqual(args.port, 9000)

    def test_playlist_parser(self):
        """Verify playlist CLI subcommands and flags."""
        parser = build_playlist_parser()
        args_create = parser.parse_args(["create", "Chill Vibes"])
        self.assertEqual(args_create.command, "create")
        self.assertEqual(args_create.playlist, "Chill Vibes")

        args_add = parser.parse_args(["add", "Favorites", "https://youtube.com/watch?v=123"])
        self.assertEqual(args_add.command, "add")
        self.assertEqual(args_add.playlist, "Favorites")
        self.assertEqual(args_add.target, ["https://youtube.com/watch?v=123"])

        args_play = parser.parse_args(["play", "Favorites", "--shuffle"])
        self.assertEqual(args_play.command, "play")
        self.assertEqual(args_play.playlist, "Favorites")
        self.assertTrue(args_play.shuffle)


if __name__ == "__main__":
    unittest.main()
