"""Unit tests for Universal Music Search in music_streamer.search."""

import json
import unittest
from unittest.mock import MagicMock, patch

from music_streamer.search import (
    SearchResult,
    SearchResults,
    format_search_results,
    parse_search_output,
    search_music,
)


class TestSearch(unittest.TestCase):
    def test_parse_search_output(self):
        """Verify parsing yt-dlp triple output lines into SearchResults."""
        raw_output = "dQw4w9WgXcQ\nRick Astley - Never Gonna Give You Up\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n78Y0SxVVxP4\nDenny Caknan - Wirang\nhttps://www.youtube.com/watch?v=78Y0SxVVxP4\n"
        results = parse_search_output("test query", "youtube", raw_output)

        self.assertEqual(results.count, 2)
        self.assertEqual(len(results.results), 2)
        self.assertEqual(results.results[0].id, "dQw4w9WgXcQ")
        self.assertEqual(results.results[0].title, "Rick Astley - Never Gonna Give You Up")
        self.assertEqual(results.results[0].url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        self.assertEqual(results.results[1].id, "78Y0SxVVxP4")

    def test_format_search_results_json(self):
        """Verify JSON formatting of search results."""
        results = SearchResults(
            query="Alan Walker",
            provider="youtube",
            count=1,
            results=[SearchResult(id="123", title="Faded", url="https://youtube.com/watch?v=123")],
        )
        formatted = format_search_results(results, mode="json")
        data = json.loads(formatted)
        self.assertEqual(data["query"], "Alan Walker")
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["id"], "123")

    def test_format_search_results_url_and_id(self):
        """Verify URL and ID extraction modes."""
        results = SearchResults(
            query="Alan Walker",
            provider="youtube",
            count=2,
            results=[
                SearchResult(id="123", title="Faded", url="https://youtube.com/watch?v=123"),
                SearchResult(id="456", title="Sing Me To Sleep", url="https://youtube.com/watch?v=456"),
            ],
        )
        # First result URL
        self.assertEqual(format_search_results(results, mode="url", select_index=1), "https://youtube.com/watch?v=123")
        # Second result URL
        self.assertEqual(format_search_results(results, mode="url", select_index=2), "https://youtube.com/watch?v=456")
        # First result ID
        self.assertEqual(format_search_results(results, mode="id", select_index=1), "123")

    def test_format_search_results_text(self):
        """Verify human readable text table formatting."""
        results = SearchResults(
            query="Alan Walker",
            provider="youtube",
            count=1,
            results=[SearchResult(id="123", title="Faded", url="https://youtube.com/watch?v=123")],
        )
        formatted = format_search_results(results, mode="text")
        self.assertIn("Query: Alan Walker", formatted)
        self.assertIn("Faded", formatted)
        self.assertIn("https://youtube.com/watch?v=123", formatted)

    @patch("subprocess.check_output")
    def test_search_music_mocked(self, mock_subprocess):
        """Verify search_music invokes yt-dlp with appropriate arguments."""
        mock_subprocess.return_value = "vid1\nTitle 1\nhttps://youtube.com/watch?v=vid1\n"
        res = search_music("Alan Walker", num=1, provider="youtube")
        self.assertEqual(res.count, 1)
        self.assertEqual(res.results[0].title, "Title 1")

    @patch("subprocess.check_output")
    def test_fetch_track_metadata(self, mock_subprocess):
        """Verify fetch_track_metadata extracts real title and thumbnail from a URL."""
        from music_streamer.search import fetch_track_metadata

        mock_subprocess.return_value = "Denny Caknan - Wirang (Official Music Video)\nhttps://i.ytimg.com/vi/78Y0SxVVxP4/maxresdefault.jpg\n"
        meta = fetch_track_metadata("https://www.youtube.com/watch?v=78Y0SxVVxP4")
        self.assertEqual(meta["title"], "Denny Caknan - Wirang (Official Music Video)")
        self.assertEqual(meta["thumbnail"], "https://i.ytimg.com/vi/78Y0SxVVxP4/maxresdefault.jpg")

    def test_search_unified(self):
        """Verify search_unified checks local SQLite tracks first and combines with web."""
        import tempfile
        from pathlib import Path
        from music_streamer.db import DatabaseManager
        from music_streamer.playlist import PlaylistManager
        from music_streamer.search import search_unified

        with tempfile.TemporaryDirectory() as td:
            db_inst = DatabaseManager(Path(td) / "test_search.db")
            pl_mgr = PlaylistManager(db_inst)

            # Create playlist with matching track
            pl_mgr.create_playlist("Top Hits")
            pl_mgr.add_track("Top Hits", url="https://youtube.com/watch?v=local1", title="Alan Walker Faded", auto_fetch=False)

            with patch("music_streamer.search.search_music") as mock_web_search:
                mock_web_search.return_value = SearchResults(
                    query="Alan Walker",
                    provider="youtube",
                    count=1,
                    results=[SearchResult(id="web1", title="Alan Walker - Spectre", url="https://youtube.com/watch?v=web1")],
                )

                res = search_unified("Alan Walker", count=5, include_web=True, database=db_inst)

                self.assertEqual(res["local_count"], 1)
                self.assertEqual(res["local_results"][0]["title"], "Alan Walker Faded")
                self.assertEqual(res["local_results"][0]["source_label"], "Playlist: Top Hits")
                self.assertEqual(res["web_count"], 1)
                self.assertEqual(res["web_results"][0]["title"], "Alan Walker - Spectre")


if __name__ == "__main__":
    unittest.main()
