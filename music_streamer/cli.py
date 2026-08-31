"""
Unified CLI Subcommands & Parsers for the Music Streamer Python Suite.
"""

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from dataclasses import asdict
from typing import Optional

from music_streamer.config import (
    DEFAULT_PORT,
    PID_FILE,
    PLAYER_PID_FILE,
    ROOT_DIR,
    SERVER_LOG_FILE,
    SOCKET_PATH,
    TUNNEL_LOG_FILE,
    TUNNEL_PID_FILE,
)
from music_streamer.db import db
from music_streamer.ipc import send_ipc_command
from music_streamer.playback import playback_mgr
from music_streamer.playlist import playlist_mgr
from music_streamer.search import fetch_track_metadata, format_search_results, search_music
from music_streamer.security import security


# -----------------------------------------------------------------------------
# System & Tunnel Helpers
# -----------------------------------------------------------------------------


def is_tunnel_running() -> Optional[int]:
    """Returns PID of active cloudflared tunnel if running, or None."""
    pid = None
    if TUNNEL_PID_FILE.exists():
        try:
            pid = int(TUNNEL_PID_FILE.read_text().strip())
        except Exception:
            pass
    if not pid:
        pid_str = db.get_setting("tunnel_pid", "")
        if pid_str and pid_str.isdigit():
            pid = int(pid_str)

    if pid:
        try:
            os.kill(pid, 0)
            return pid
        except OSError:
            TUNNEL_PID_FILE.unlink(missing_ok=True)
            db.set_setting("tunnel_pid", "0")
            db.set_setting("public_url", "")
            return None
    return None


def stop_tunnel() -> bool:
    """Stops any active cloudflared tunnel process."""
    pid = is_tunnel_running()
    if pid:
        try:
            os.kill(pid, signal.SIGTERM)
            time.sleep(0.3)
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
    TUNNEL_PID_FILE.unlink(missing_ok=True)
    db.set_setting("tunnel_pid", "0")
    db.set_setting("public_url", "")
    subprocess.run(["pkill", "-f", "cloudflared.*localhost:8000"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return True


def start_tunnel(port: int = DEFAULT_PORT) -> tuple[bool, str]:
    """Starts detached cloudflared public tunnel in background and returns (success, public_url)."""
    running_pid = is_tunnel_running()
    current_pub_url = db.get_setting("public_url", "")
    if running_pid and current_pub_url:
        return True, current_pub_url

    # Check for cloudflared binary
    cf_bin = None
    for p in ["/usr/local/bin/cloudflared", "/usr/bin/cloudflared"]:
        if os.path.exists(p):
            cf_bin = p
            break
    if not cf_bin:
        try:
            cf_bin = subprocess.check_output(["which", "cloudflared"], text=True).strip()
        except Exception:
            pass

    if not cf_bin:
        return False, "cloudflared binary not found on system."

    # Kill old hanging tunnels on this port
    stop_tunnel()
    time.sleep(0.3)

    # Open fresh tunnel log
    log_file = open(TUNNEL_LOG_FILE, "w")
    proc = subprocess.Popen(
        [cf_bin, "tunnel", "--url", f"http://127.0.0.1:{port}"],
        stdout=log_file,
        stderr=subprocess.STDOUT,
        start_new_session=True,  # Fully detached from terminal / CLI process
    )

    TUNNEL_PID_FILE.write_text(str(proc.pid))
    db.set_setting("tunnel_pid", str(proc.pid))

    # Poll log for public url
    pub_url = ""
    for _ in range(35):
        time.sleep(0.3)
        if proc.poll() is not None:
            return False, f"cloudflared exited unexpectedly with code {proc.returncode}."
        if TUNNEL_LOG_FILE.exists():
            try:
                content = TUNNEL_LOG_FILE.read_text(errors="ignore")
                m = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", content)
                if m:
                    pub_url = m.group(0)
                    db.set_setting("public_url", pub_url)
                    break
            except Exception:
                pass

    if pub_url:
        return True, pub_url
    return False, "Timed out waiting for cloudflared tunnel URL to be assigned."


def get_lan_ip() -> str:
    """Returns local network IP address."""
    try:
        return subprocess.check_output(["hostname", "-I"], text=True).strip().split()[0]
    except Exception:
        return "127.0.0.1"


def get_alsa_volume() -> int:
    """Queries ALSA Master volume percentage."""
    try:
        out = subprocess.check_output(["amixer", "get", "Master"], text=True, stderr=subprocess.DEVNULL)
        m = re.search(r"(\d+)%", out)
        if m:
            return int(m.group(1))
    except Exception:
        pass
    return db.get_int_setting("volume", 80)


def set_alsa_volume(vol: int, unmute: bool = True):
    """Sets ALSA Master and PCM volume."""
    vol = max(0, min(100, vol))
    try:
        cmd = ["amixer", "-q", "set", "Master", f"{vol}%"]
        if unmute:
            cmd.append("unmute")
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        subprocess.run(
            ["amixer", "-q", "set", "PCM", f"{vol}%", "unmute"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except Exception:
        pass


def is_server_running() -> Optional[int]:
    """Checks if stream server process is currently running."""
    pid = db.get_int_setting("server_pid", 0)
    if not pid and PID_FILE.exists():
        try:
            pid = int(PID_FILE.read_text().strip())
        except Exception:
            pid = 0
    if pid > 0:
        try:
            os.kill(pid, 0)
            return pid
        except OSError:
            return None
    return None


# -----------------------------------------------------------------------------
# Argument Parsers
# -----------------------------------------------------------------------------


def build_play_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Play a direct URL on local speaker & live broadcast in sync")
    parser.add_argument("url", nargs="?", help="URL (YouTube, etc.) or search query to play")
    parser.add_argument("volume", nargs="?", help="Volume (0-100, +N, -N)")
    parser.add_argument("loop", nargs="?", default="yes", help="Loop mode (yes|no)")
    return parser


def build_search_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Search music across YouTube, SoundCloud, etc.")
    parser.add_argument("query", nargs="+", help="Search query")
    parser.add_argument("-n", "--num", type=int, default=5, help="Number of results (default: 5)")
    parser.add_argument("-p", "--provider", default="youtube", help="Provider: youtube, soundcloud, bandcamp, spotify")
    parser.add_argument("-j", "--json", action="store_true", help="Output results in JSON format")
    parser.add_argument("-u", "--url", type=int, default=0, help="Print only the Nth result URL (1-indexed)")
    parser.add_argument("-i", "--id", type=int, default=0, help="Print only the Nth result video ID (1-indexed)")
    parser.add_argument("--first", action="store_true", help="Print the first result URL")
    return parser


def build_playback_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage persistent playback list and history")
    parser.add_argument(
        "command",
        choices=[
            "add",
            "add-url",
            "list",
            "ls",
            "show",
            "shuffle",
            "next",
            "skip",
            "prev",
            "previous",
            "play",
            "interrupt",
            "remove",
            "reset-history",
            "clear",
        ],
        help="Subcommand",
    )
    parser.add_argument("target", nargs="*", help="Arguments for subcommand (URL, query, index, etc.)")
    parser.add_argument("--json", action="store_true", help="Output list in JSON format")
    return parser


def build_playlist_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage persistent named playlists stored in SQLite")
    parser.add_argument(
        "command",
        choices=[
            "create",
            "new",
            "rename",
            "mv",
            "list",
            "ls",
            "show",
            "view",
            "add",
            "remove",
            "rm",
            "del-track",
            "delete",
            "drop",
            "play",
            "queue",
        ],
        help="Subcommand",
    )
    parser.add_argument("playlist", nargs="?", help="Playlist name or ID")
    parser.add_argument("target", nargs="*", help="Track URL, search query, or track index")
    parser.add_argument("-s", "--shuffle", action="store_true", help="Play/Queue in shuffle mode")
    parser.add_argument("-j", "--json", action="store_true", help="Output in JSON format")
    return parser


def build_volume_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Get or set master speaker volume")
    parser.add_argument("volume", nargs="?", help="Volume target (0-100, +N, -N, mute, unmute)")
    return parser


def build_loop_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Get or toggle loop repeat setting")
    parser.add_argument(
        "mode",
        nargs="?",
        choices=["repeat", "repeat-one", "off", "yes", "no", "one", "single", "all", "toggle", "status", "show"],
        default="status",
        help="Loop mode (repeat, repeat-one, off, toggle, status)",
    )
    return parser


def build_otp_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="One-Time Password (OTP) & Stream Security Manager")
    parser.add_argument(
        "command",
        choices=["show", "status", "new", "generate", "on", "off", "sessions"],
        default="show",
        nargs="?",
    )
    return parser


def build_status_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Show current player & stream server status")
    parser.add_argument("-j", "--json", action="store_true", help="JSON output for AI agents & tools")
    return parser


def build_stop_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Stop audio playback or shut down stream daemon")
    parser.add_argument("-a", "--all", action="store_true", help="Stop audio and kill stream server daemon")
    return parser


def build_stream_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage continuous HTTP stream server & broadcast station")
    parser.add_argument("command", nargs="?", choices=["status", "stop", "silent", "speaker", "mode", "public"], help="Action")
    parser.add_argument("--mode", choices=["silent", "speaker"], default="silent", help="Playback mode")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to listen on")
    parser.add_argument("--url", help="Initial YouTube URL to play immediately")
    parser.add_argument("--queue", action="store_true", help="Start playback from queue")
    parser.add_argument("-d", "--daemon", action="store_true", help="Run in background as daemon")
    parser.add_argument("--public", action="store_true", help="Start cloudflared public tunnel")
    return parser


# -----------------------------------------------------------------------------
# Command Execution Handlers
# -----------------------------------------------------------------------------


def handle_play(args: argparse.Namespace) -> int:
    url = args.url
    if not url:
        print("Usage: play.py <URL|query> [VOLUME 0-100] [LOOP yes|no]", file=sys.stderr)
        return 1

    if url == "stop":
        return handle_stop(argparse.Namespace(all=False))

    volume = args.volume
    loop = args.loop or "yes"

    if volume and (volume.lower() in ["yes", "no", "true", "false", "on", "off"]):
        loop = volume
        volume = None

    vol_int = get_alsa_volume()
    if volume:
        if volume.startswith("+"):
            vol_int = min(100, vol_int + int(volume[1:]))
        elif volume.startswith("-"):
            vol_int = max(0, vol_int - int(volume[1:]))
        elif volume.isdigit():
            vol_int = max(0, min(100, int(volume)))

    loop_clean = "repeat"
    if loop.lower() in ["no", "off", "0", "false", "none"]:
        loop_clean = "off"
    elif loop.lower() in ["repeat-one", "repeat_one", "one", "single"]:
        loop_clean = "repeat-one"
    elif loop.lower() in ["repeat", "all", "yes", "y", "true", "on", "1"]:
        loop_clean = "repeat"

    # Set ALSA Master volume
    set_alsa_volume(vol_int, unmute=True)
    db.set_setting("volume", str(vol_int))
    db.set_setting("loop", loop_clean)
    db.set_setting("state", "playing")

    # Resolve search query (checking local database first) or fetch title if direct URL
    resolved_title = None
    if not url.startswith("http://") and not url.startswith("https://"):
        local_matches = db.search_local_tracks(url, limit=1)
        if local_matches:
            lm = local_matches[0]
            url = lm["url"]
            resolved_title = lm["title"]
            print(f"Matched Local Library: {resolved_title} ({lm.get('source_label', 'Local')})")
        else:
            print(f"Searching Web: {url}")
            res = search_music(url, num=1)
            if not res.results:
                print(f"Error: no results for '{url}'", file=sys.stderr)
                return 2
            r = res.results[0]
            url = r.url
            resolved_title = r.title
            print(f"Found:    {resolved_title}")
    else:
        meta = fetch_track_metadata(url)
        if meta.get("title") and meta["title"] != url:
            resolved_title = meta["title"]

    # Ensure stream server daemon is running
    server_pid = is_server_running()
    if not server_pid:
        print("Starting stream server daemon in background (mode: silent)...")
        stream_script = ROOT_DIR / "stream.py"
        subprocess.Popen(
            [sys.executable, str(stream_script), "--daemon", "--mode", "silent", "--port", str(DEFAULT_PORT)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(1.2)

    # Update playback manager with title
    playback_mgr.mark_playing_url(url, resolved_title or url, auto_fetch=False)

    # Send synchronous IPC play command
    resp = send_ipc_command(
        {"action": "play", "url": url, "title": resolved_title or url, "volume": vol_int, "loop": loop_clean}
    )
    if not resp.get("success"):
        print(f"Warning: {resp.get('error')}", file=sys.stderr)

    lan_ip = get_lan_ip()
    cur_mode = db.get_setting("mode", "silent").upper()
    print(f"Started playback (Broadcast Mode: {cur_mode}):")
    print(f"  Title        : {resolved_title or url}")
    print(f"  URL          : {url}")
    print(f"  Volume       : {vol_int}%")
    print(f"  Loop         : {loop_clean}")
    print(f"  Stream URL   : http://{lan_ip}:{DEFAULT_PORT}/stream.mp3")
    print(f"  Web Player   : http://{lan_ip}:{DEFAULT_PORT}/")
    print("\nControls: pause.py | resume.py | volume.py | playback.py | loop.py | status.py | stop.py")
    return 0


def handle_search(args: argparse.Namespace) -> int:
    query = " ".join(args.query)
    num = args.num

    # Check if last query word is an integer
    if len(args.query) > 1 and args.query[-1].isdigit() and num == 5:
        num = int(args.query[-1])
        query = " ".join(args.query[:-1])

    mode = "text"
    select_idx = 0
    if args.json or os.environ.get("JSON") == "1":
        mode = "json"
    elif args.first:
        mode = "url"
        select_idx = 1
    elif args.url > 0:
        mode = "url"
        select_idx = args.url
    local_matches = db.search_local_tracks(query, limit=5)

    if args.json or os.environ.get("JSON") == "1":
        results = search_music(query, num=num, provider=args.provider)
        output_data = {
            "query": query,
            "local_count": len(local_matches),
            "local_matches": local_matches,
            "web_count": results.count,
            "web_results": [asdict(r) for r in results.results],
        }
        print(json.dumps(output_data, indent=2, ensure_ascii=False))
        return 0

    if not args.first and args.url == 0 and args.id == 0 and local_matches:
        exacts = [m for m in local_matches if m.get("is_exact_match") or m.get("match_score", 0) >= 0.90]
        similars = [m for m in local_matches if not (m.get("is_exact_match") or m.get("match_score", 0) >= 0.90)]

        print("═" * 60)
        print(f" 📚 LOCAL LIBRARY MATCHES ({len(local_matches)} found in Playlists & Queue)")
        print("═" * 60)
        idx_counter = 1
        if exacts:
            for lm in exacts:
                src = lm.get("source_label", "Local")
                print(f"  [{idx_counter}] 🎯 {lm['title']}")
                print(f"      Source: {src}  (Exact Match)")
                print(f"      URL:    {lm['url']}")
                idx_counter += 1
        if similars:
            if exacts:
                print("  ─" * 29)
                print("  🔍 Similar Local Titles:")
            for lm in similars:
                src = lm.get("source_label", "Local")
                pct = int(round(lm.get("match_score", 0) * 100))
                print(f"  [{idx_counter}] 🔹 {lm['title']}")
                print(f"      Source: {src}  ({pct}% Similar)")
                print(f"      URL:    {lm['url']}")
                idx_counter += 1
        print("═" * 60)
        print(" 🌐 WEB SEARCH RESULTS (Online)")
        print("═" * 60)

    results = search_music(query, num=num, provider=args.provider)
    if results.count == 0:
        if not local_matches:
            print(f"No results for: {query}", file=sys.stderr)
            return 2
        return 0

    try:
        formatted = format_search_results(results, mode=mode, select_index=select_idx)
        print(formatted)
        return 0
    except IndexError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


def handle_playback(args: argparse.Namespace) -> int:
    cmd = args.command
    targets = args.target

    if cmd == "add":
        if not targets:
            print("Usage: playback.py add <URL|query>", file=sys.stderr)
            return 1
        inp = " ".join(targets)
        if inp.startswith("http://") or inp.startswith("https://"):
            t = playback_mgr.add_track(inp)
            if t and t.get("already_exists"):
                print(f"⚠️ Track already exists in playback tracklist: {t['title']}")
            else:
                print(f"Added to playback list: {t['title']}")
        else:
            print(f"Searching: {inp}")
            res = search_music(inp, num=1)
            if not res.results:
                print(f"Error: no results for query '{inp}'", file=sys.stderr)
                return 2
            r = res.results[0]
            t = playback_mgr.add_track(r.url, r.title)
            if t and t.get("already_exists"):
                print(f"⚠️ Track already exists in playback tracklist: {t['title']}")
            else:
                print(f"Added to playback list: {t['title']}")
        send_ipc_command({"action": "playback_update"})
        return 0

    elif cmd == "add-url":
        if not targets:
            print("Usage: playback.py add-url <URL> [TITLE]", file=sys.stderr)
            return 1
        url = targets[0]
        title = " ".join(targets[1:]) if len(targets) > 1 else url
        t = playback_mgr.add_track(url, title)
        if t and t.get("already_exists"):
            print(f"⚠️ Track already exists in playback tracklist: {t['title']}")
        else:
            print(f"Added to playback list: {t['title']}")
        send_ipc_command({"action": "playback_update"})
        return 0

    elif cmd in ["list", "ls", "show"]:
        state = playback_mgr.get_state()
        if args.json:
            print(json.dumps(state, indent=2, ensure_ascii=False))
            return 0

        tracks = state.get("tracks", [])
        total = state.get("total_count", 0)
        played = state.get("played_count", 0)
        queued = state.get("queued_count", 0)
        mode = state.get("mode", "ordered").upper()

        print("═" * 60)
        print(f" 📋 PLAYBACK TRACKLIST — Total: {total} (Played: {played}, Upcoming: {queued}) | Mode: {mode}")
        print("═" * 60)

        if not tracks:
            print('  (Playback list is empty — add tracks with ./playback.py add "<query>")')
            print("═" * 60)
            return 0

        for idx, t in enumerate(tracks, 1):
            status = t.get("status", "queued")
            title = t.get("title", t.get("url", ""))
            url = t.get("url", "")

            if status == "playing":
                badge = "\033[1;32m▶ [PLAYING]\033[0m"
            elif status == "played":
                badge = "\033[1;30m✓ [PLAYED]\033[0m"
            else:
                badge = "\033[1;36m⏭ [QUEUED]\033[0m"

            print(f"  {idx:2d}. {badge} {title}")
            print(f"      {url}")

        print("═" * 60)
        return 0

    elif cmd == "shuffle":
        mode = playback_mgr.shuffle_unplayed_tracks()
        print(f"✓ Shuffled unplayed tracks (Mode: {mode.upper()}). Played history preserved.")
        send_ipc_command({"action": "playback_update"})
        return 0

    elif cmd in ["next", "skip"]:
        print("Skipping to next track...")
        send_ipc_command({"action": "skip"})
        return 0

    elif cmd in ["prev", "previous"]:
        print("Playing previous track...")
        send_ipc_command({"action": "prev"})
        return 0

    elif cmd == "play":
        if targets and targets[0].isdigit():
            idx = int(targets[0]) - 1
            t = playback_mgr.play_track_by_index(idx)
            if t:
                print(f"Playing #{targets[0]}: {t['title']}")
                send_ipc_command({"action": "interrupt", "index": idx})
        else:
            send_ipc_command({"action": "play"})
            print("Started playback from list.")
        return 0

    elif cmd == "interrupt":
        if not targets:
            print("Usage: playback.py interrupt <URL|query>", file=sys.stderr)
            return 1
        inp = " ".join(targets)
        if inp.startswith("http://") or inp.startswith("https://"):
            meta = fetch_track_metadata(inp)
            title = meta.get("title") or inp
            thumb = meta.get("thumbnail")
            playback_mgr.mark_playing_url(inp, title=title, thumbnail=thumb, auto_fetch=False)
            send_ipc_command({"action": "interrupt", "url": inp, "title": title, "thumbnail": thumb})
        else:
            res = search_music(inp, num=1)
            if not res.results:
                print(f"Error: no results for query '{inp}'", file=sys.stderr)
                return 2
            r = res.results[0]
            playback_mgr.mark_playing_url(r.url, r.title, auto_fetch=False)
            send_ipc_command({"action": "interrupt", "url": r.url, "title": r.title})
        print("Interrupted — playing now!")
        return 0

    elif cmd == "remove":
        if not targets:
            print("Usage: playback.py remove <N>", file=sys.stderr)
            return 1
        idx = int(targets[0]) - 1 if targets[0].isdigit() else targets[0]
        if playback_mgr.remove_track(idx):
            print(f"✓ Removed track #{targets[0]} from playback list")
            send_ipc_command({"action": "playback_update"})
        else:
            print(f"Error: track #{targets[0]} not found", file=sys.stderr)
            return 1
        return 0

    elif cmd == "reset-history":
        playback_mgr.reset_history()
        print("✓ Reset all played tracks to unplayed (ready for fresh replay cycle)")
        send_ipc_command({"action": "playback_update"})
        return 0

    elif cmd == "clear":
        playback_mgr.clear_all()
        print("✓ Cleared entire playback list.")
        send_ipc_command({"action": "playback_clear"})
        return 0

    return 0


def handle_playlist(args: argparse.Namespace) -> int:
    cmd = args.command
    pl_name = args.playlist
    targets = args.target

    if cmd in ["create", "new"]:
        if not pl_name:
            print("Usage: playlist.py create <NAME>", file=sys.stderr)
            return 1
        pl = playlist_mgr.create_playlist(pl_name)
        print(f"✓ Created playlist: {pl['name']}")
        send_ipc_command({"action": "playlist_update"})
        return 0

    elif cmd in ["rename", "mv"]:
        if not pl_name or not args.target:
            print("Usage: playlist.py rename <OLD_NAME> <NEW_NAME>", file=sys.stderr)
            return 1
        new_name = " ".join(args.target)
        res = playlist_mgr.rename_playlist(pl_name, new_name)
        if not res.get("success"):
            print(f"Error: {res.get('error')}", file=sys.stderr)
            return 1
        print(f"✓ Renamed playlist '{pl_name}' to '{new_name}'")
        send_ipc_command({"action": "playlist_update"})
        return 0

    elif cmd in ["list", "ls"]:
        pls = playlist_mgr.get_playlists()
        if args.json:
            print(json.dumps(pls, indent=2, ensure_ascii=False))
            return 0

        print("═" * 60)
        print(f" 📚 PLAYLIST LIBRARY — Total: {len(pls)} Playlist(s)")
        print("═" * 60)
        if not pls:
            print('  (No playlists found — create one with ./playlist.py create "<name>")')
            print("═" * 60)
            return 0

        for idx, p in enumerate(pls, 1):
            count = p.get("track_count", 0)
            print(f"  {idx:2d}. 🎵 \033[1;36m{p['name']}\033[0m ({count} tracks)")
        print("═" * 60)
        return 0

    elif cmd in ["show", "view"]:
        if not pl_name:
            print("Usage: playlist.py show <NAME>", file=sys.stderr)
            return 1
        pl = playlist_mgr.get_playlist(pl_name)
        if not pl:
            print(f"Error: playlist '{pl_name}' not found", file=sys.stderr)
            return 1
        if args.json:
            print(json.dumps(pl, indent=2, ensure_ascii=False))
            return 0

        tracks = pl.get("tracks", [])
        print("═" * 60)
        print(f" 🎵 PLAYLIST: {pl['name']} — Total: {len(tracks)} Track(s)")
        print("═" * 60)
        if not tracks:
            print('  (Playlist is empty — add tracks with ./playlist.py add "<playlist>" "<url|query>")')
            print("═" * 60)
            return 0

        for idx, t in enumerate(tracks, 1):
            print(f"  {idx:2d}. \033[1;32m{t['title']}\033[0m")
            print(f"      {t['url']}")
        print("═" * 60)
        return 0

    elif cmd == "add":
        if not pl_name or not targets:
            print("Usage: playlist.py add <NAME> <URL|query>", file=sys.stderr)
            return 1
        inp = " ".join(targets)
        try:
            print(f"Adding to playlist '{pl_name}': {inp}")
            t = playlist_mgr.add_track(pl_name, inp)
            if t and t.get("already_exists"):
                print(f"⚠️ Track already exists in playlist '{pl_name}': {t['title']}")
            else:
                print(f"✓ Added to '{pl_name}': {t['title']}")
            send_ipc_command({"action": "playlist_update"})
            return 0
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1

    elif cmd in ["remove", "rm", "del-track"]:
        if not pl_name or not targets:
            print("Usage: playlist.py remove <NAME> <INDEX|ID>", file=sys.stderr)
            return 1
        target_val = targets[0]
        idx = int(target_val) - 1 if target_val.isdigit() else target_val
        ok = playlist_mgr.remove_track(pl_name, idx)
        if ok:
            print(f"✓ Removed track from playlist '{pl_name}'")
            send_ipc_command({"action": "playlist_update"})
            return 0
        else:
            print(f"Error: track '{target_val}' not found in playlist '{pl_name}'", file=sys.stderr)
            return 1

    elif cmd in ["delete", "drop"]:
        if not pl_name:
            print("Usage: playlist.py delete <NAME>", file=sys.stderr)
            return 1
        ok = playlist_mgr.delete_playlist(pl_name)
        if ok:
            print(f"✓ Deleted playlist: {pl_name}")
            send_ipc_command({"action": "playlist_update"})
            return 0
        else:
            print(f"Error: playlist '{pl_name}' not found", file=sys.stderr)
            return 1

    elif cmd == "play":
        if not pl_name:
            print("Usage: playlist.py play <NAME> [--shuffle]", file=sys.stderr)
            return 1
        res = playlist_mgr.play_playlist(pl_name, shuffle=args.shuffle)
        if not res.get("success"):
            print(f"Error: {res.get('error')}", file=sys.stderr)
            return 1

        send_ipc_command({"action": "play"})
        print(f"▶ Started playback of playlist '{res['playlist']}' ({res['count']} tracks, Mode: {res['mode'].upper()})")
        return 0

    elif cmd == "queue":
        if not pl_name:
            print("Usage: playlist.py queue <NAME> [--shuffle]", file=sys.stderr)
            return 1
        res = playlist_mgr.queue_playlist(pl_name, shuffle=args.shuffle)
        if not res.get("success"):
            print(f"Error: {res.get('error')}", file=sys.stderr)
            return 1

        send_ipc_command({"action": "playback_update"})
        print(f"✓ Queued {res['added_count']} tracks from playlist '{res['playlist']}'")
        return 0

    return 0


def handle_pause(args: argparse.Namespace) -> int:
    state = db.get_setting("state", "unknown")
    if state == "paused":
        print("Already paused")
        return 0

    server_pid = is_server_running()
    if not server_pid:
        print("Error: no player or stream server running", file=sys.stderr)
        return 1

    send_ipc_command({"action": "pause"})
    subprocess.run(["amixer", "-q", "set", "Master", "mute"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    db.set_setting("state", "paused")
    print("Paused (use ./resume.py to continue)")
    return 0


def handle_resume(args: argparse.Namespace) -> int:
    state = db.get_setting("state", "unknown")
    if state == "playing":
        print("Already playing")
        return 0

    server_pid = is_server_running()
    if not server_pid:
        print("Error: no player or stream server running", file=sys.stderr)
        return 1

    vol = db.get_int_setting("volume", 80)
    set_alsa_volume(vol, unmute=True)
    send_ipc_command({"action": "resume"})
    db.set_setting("state", "playing")
    print(f"Resumed at {vol}%")
    return 0


def handle_prev(args: argparse.Namespace) -> int:
    server_pid = is_server_running()
    if not server_pid:
        print("Error: stream server is not running", file=sys.stderr)
        return 1
    print("Playing previous track...")
    send_ipc_command({"action": "prev"})
    return 0


def handle_skip(args: argparse.Namespace) -> int:
    server_pid = is_server_running()
    if not server_pid:
        print("Error: stream server is not running", file=sys.stderr)
        return 1
    print("Skipping to next track...")
    send_ipc_command({"action": "skip"})
    return 0


def handle_volume(args: argparse.Namespace) -> int:
    vol_arg = args.volume
    if not vol_arg:
        state = db.get_setting("state", "unknown")
        saved = db.get_int_setting("volume", 80)
        alsa = get_alsa_volume()
        print(f"State : {state}")
        print(f"Saved : {saved}%")
        print(f"ALSA  : {alsa}%")
        return 0

    if vol_arg == "mute":
        subprocess.run(["amixer", "-q", "set", "Master", "mute"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print("Muted")
        return 0

    if vol_arg == "unmute":
        vol = db.get_int_setting("volume", 80)
        set_alsa_volume(vol, unmute=True)
        send_ipc_command({"action": "set_volume", "volume": vol})
        print(f"Unmuted at {vol}% (synced to Master)")
        return 0

    cur = get_alsa_volume()
    if vol_arg.startswith("+"):
        target = min(100, cur + int(vol_arg[1:]))
    elif vol_arg.startswith("-"):
        target = max(0, cur - int(vol_arg[1:]))
    elif vol_arg.isdigit():
        target = max(0, min(100, int(vol_arg)))
    else:
        print(f"Error: volume must be 0-100, +/-N, mute, or unmute (got '{vol_arg}')", file=sys.stderr)
        return 1

    set_alsa_volume(target, unmute=True)
    db.set_setting("volume", str(target))
    send_ipc_command({"action": "set_volume", "volume": target})
    print(f"Volume set to {target}%")
    return 0


def handle_loop(args: argparse.Namespace) -> int:
    mode = (args.mode or "status").lower()
    current_loop = db.get_setting("loop", "repeat").lower()

    if mode in ["status", "show"]:
        server_pid = is_server_running()
        print(f"Loop    : {current_loop}")
        if current_loop in ["repeat-one", "one", "single"]:
            print("Mode    : repeat-one (repeats single current track continuously)")
        elif current_loop in ["repeat", "yes", "all"]:
            print("Mode    : repeat (loops entire tracklist from first by order/shuffle)")
        else:
            print("Mode    : off (plays until end of list and stops)")
        print(f"Player  : {'running (PID ' + str(server_pid) + ')' if server_pid else 'not running'}")
        return 0

    target = "repeat"
    if mode in ["repeat-one", "repeat_one", "one", "single"]:
        target = "repeat-one"
    elif mode in ["repeat", "all", "yes", "on", "1"]:
        target = "repeat"
    elif mode in ["off", "no", "0", "none"]:
        target = "off"
    elif mode == "toggle":
        if current_loop in ["repeat", "yes", "all"]:
            target = "repeat-one"
        elif current_loop in ["repeat-one", "one", "single"]:
            target = "off"
        else:
            target = "repeat"

    db.set_setting("loop", target)
    send_ipc_command({"action": "set_loop", "loop": target})
    if target == "repeat":
        print("Loop mode set to: REPEAT (loops entire tracklist from first by order/shuffle)")
    elif target == "repeat-one":
        print("Loop mode set to: REPEAT-ONE (repeats single current track continuously)")
    else:
        print("Loop mode set to: OFF (one-shot, stops after list ends)")
    return 0


def handle_otp(args: argparse.Namespace) -> int:
    cmd = args.command or "show"
    lan_ip = get_lan_ip()

    if cmd in ["show", "status"]:
        enabled = security.is_enabled()
        otp = security.get_current_otp()
        status_str = "🟢 ENABLED (Protected)" if enabled else "⚪ DISABLED (Public)"
        print("═" * 58)
        print(" 🔐 MUSIC STREAMER — One-Time Password (OTP) Security")
        print("═" * 58)
        print(f"  Security Status   : {status_str}")
        print(f"  Active OTP Code   : \033[1;36m{otp}\033[0m")
        print("─" * 58)
        print("  Direct Authenticated Access Links:")
        print(f"  Web Control Panel : http://{lan_ip}:{DEFAULT_PORT}/?otp={otp}")
        print(f"  Live Audio Stream : http://{lan_ip}:{DEFAULT_PORT}/stream.mp3?otp={otp}")
        print("═" * 58)
        print("  Commands: ./otp.py new (generate) | ./otp.py on/off (toggle)")
        print("═" * 58)
        return 0

    elif cmd in ["new", "generate"]:
        new_otp = security.generate_new_otp()
        print(f"✓ Generated new OTP Code: \033[1;32m{new_otp}\033[0m")
        return 0

    elif cmd in ["on", "enable"]:
        security.set_enabled(True)
        print("✓ OTP Security is now \033[1;32mENABLED\033[0m. Web panel and audio stream are protected.")
        return 0

    elif cmd in ["off", "disable"]:
        security.set_enabled(False)
        print("✓ OTP Security is now \033[1;33mDISABLED\033[0m. Web panel and audio stream are open.")
        return 0

    elif cmd == "sessions":
        sessions = security.get_sessions()
        print(f"Active Authenticated Sessions: {len(sessions)}")
        now = int(time.time())
        for tok, info in sessions.items():
            exp = info.get("expires_at", 0) - now
            print(f"  - Token: {tok[:8]}... | IP: {info.get('client_ip')} | Expires in: {exp}s")
        return 0

    return 0


def handle_status(args: argparse.Namespace) -> int:
    state = db.get_setting("state", "stopped")
    vol = db.get_setting("volume", "80")
    loop_val = db.get_setting("loop", "repeat")
    cur_url = db.get_setting("current_url", "")
    cur_title = db.get_setting("current_title", cur_url or "Nothing playing")
    mode = db.get_setting("mode", "silent")

    server_pid = is_server_running()
    lan_ip = get_lan_ip()
    stream_url = f"http://{lan_ip}:{DEFAULT_PORT}/stream.mp3"

    playback_state = playback_mgr.get_state()
    otp_code = security.get_current_otp()
    otp_enabled = security.is_enabled()

    if args.json or os.environ.get("JSON") == "1":
        output = {
            "state": state,
            "security": {"enabled": otp_enabled, "otp": otp_code},
            "now_playing": {"url": cur_url or None, "title": cur_title or None},
            "volume": {"saved": vol, "alsa": str(get_alsa_volume())},
            "loop": loop_val,
            "playback": playback_state,
            "queue": {
                "count": playback_state["queued_count"],
                "mode": playback_state["mode"],
                "tracks": playback_state["queued_tracks"],
            },
            "next": playback_state["next"],
            "stream_server": {
                "pid": server_pid if server_pid else "(not running)",
                "mode": mode,
                "clients_connected": 0,
                "stream_url": stream_url,
            },
            "pids": {"stream_server": server_pid if server_pid else "(not running)"},
        }
        print(json.dumps(output, indent=2, ensure_ascii=False))
        return 0

    state_icon = "▶" if state == "playing" else ("⏸" if state == "paused" else "■")
    print(f"{state_icon} State        : {state}")
    print(f"🎵 Now playing  : {cur_title}")
    if cur_url and cur_url != cur_title:
        print(f"   URL          : {cur_url}")
    print(f"🔊 Volume       : {vol}%")
    loop_desc = "repeat (full cycle)" if loop_val in ["repeat", "yes", "all"] else ("repeat-one (single song)" if loop_val in ["repeat-one", "one", "single"] else "off")
    print(f"🔁 Loop         : {loop_val} ({loop_desc})")

    total = playback_state.get("total_count", 0)
    played = playback_state.get("played_count", 0)
    queued = playback_state.get("queued_count", 0)
    qmode = playback_state.get("mode", "ordered").upper()
    icon = "🔀" if qmode == "SHUFFLED" else "📋"
    print(f"{icon} Playback List: {total} track(s) ({played} played, {queued} upcoming) | Mode: {qmode}")

    tracks = playback_state.get("tracks", [])
    if tracks:
        for idx, t in enumerate(tracks[:8], 1):
            st = t.get("status", "queued")
            title = t.get("title", t.get("url", ""))
            badge = (
                "\033[1;32m[PLAYING]\033[0m"
                if st == "playing"
                else ("\033[1;30m[PLAYED]\033[0m" if st == "played" else "\033[1;36m[NEXT]\033[0m")
            )
            print(f"   {idx}. {badge} {title}")
        if len(tracks) > 8:
            print(f"      ... and {len(tracks) - 8} more")
    else:
        print('   (empty — add with ./playback.py add "<query>")')

    otp_str = f"ENABLED (Code: \033[1;36m{otp_code}\033[0m)" if otp_enabled else "DISABLED (Public)"
    print(f"🔐 Security OTP : {otp_str}")
    srv_status = f"RUNNING (PID {server_pid}, mode: {mode})" if server_pid else "Not running"
    print(f"📡 Stream Server: {srv_status}")
    if server_pid:
        print(f"   Stream URL   : {stream_url}")
        pub_url = db.get_setting("public_url", "")
        if pub_url and is_tunnel_running():
            otp_param = f"?otp={otp_code}" if otp_enabled else ""
            print(f"🌐 Public Stream: {pub_url}/stream.mp3{otp_param}")
            print(f"   Public Player: {pub_url}/{otp_param}")

    return 0


def handle_stop(args: argparse.Namespace) -> int:
    all_stop = args.all
    server_pid = is_server_running()

    if server_pid:
        if all_stop:
            print("Stopping stream server daemon...")
            stop_tunnel()
            try:
                os.kill(server_pid, signal.SIGTERM)
                time.sleep(0.5)
                os.kill(server_pid, signal.SIGKILL)
            except OSError:
                pass
            PID_FILE.unlink(missing_ok=True)
            PLAYER_PID_FILE.unlink(missing_ok=True)
            if os.path.exists(SOCKET_PATH):
                try:
                    os.unlink(SOCKET_PATH)
                except Exception:
                    pass
            db.set_setting("server_pid", "0")
            db.set_setting("state", "stopped")
            db.set_setting("public_url", "")
            print("Stream server stopped.")
            return 0
        else:
            send_ipc_command({"action": "stop"})
            db.set_setting("state", "stopped")
            db.set_setting("current_url", "")
            db.set_setting("current_title", "")
            db.set_setting("current_thumbnail", "")
            print("Playback stopped.")
            print("Stream server is active in silence mode (clients stay connected).")
            print("Tip: Run './stop.py --all' or './stream.py stop' to completely kill the stream server daemon.")
            return 0

    stop_tunnel()
    db.set_setting("state", "stopped")
    db.set_setting("current_url", "")
    db.set_setting("current_title", "")
    db.set_setting("public_url", "")
    print("Nothing was running.")
    return 0


def handle_stream(args: argparse.Namespace) -> int:
    cmd = args.command
    if cmd == "status":
        pid = is_server_running()
        if pid:
            print(f"Stream server is RUNNING (PID {pid})")
            return handle_status(argparse.Namespace(json=False))
        else:
            print("Stream server is NOT running.")
            return 0

    elif cmd == "stop":
        return handle_stop(argparse.Namespace(all=True))

    elif cmd in ["silent", "speaker", "mode"]:
        target_mode = cmd
        if cmd == "mode":
            target_mode = args.mode
        db.set_setting("mode", target_mode)
        send_ipc_command({"action": "set_mode", "mode": target_mode})
        if target_mode == "silent":
            subprocess.run(["amixer", "-q", "set", "Master", "mute"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print("Switched to SILENT mode (server speaker muted, broadcast continues).")
        else:
            vol = db.get_int_setting("volume", 80)
            set_alsa_volume(vol, unmute=True)
            print("Switched to SPEAKER mode (server speaker unmuted and synced with broadcast).")
        return 0

    elif cmd == "public":
        server_pid = is_server_running()
        if not server_pid:
            print("Stream server is not running. Starting background stream server daemon...")
            args.daemon = True
            args.public = True
            # Proceed to start server and tunnel below
        else:
            print("Connecting persistent public Cloudflare Tunnel for live stream server...", flush=True)
            ok, res_url = start_tunnel(args.port)
            if ok:
                otp_str = f"?otp={security.get_current_otp()}" if security.is_enabled() else ""
                lan_ip = get_lan_ip()
                print("═" * 60)
                print(" 🌐 PUBLIC STREAM BROADCAST ACTIVE (Persistent Tunnel)")
                print("═" * 60)
                print(f"  Public Web Player : {res_url}/{otp_str}")
                print(f"  Public MP3 Stream : {res_url}/stream.mp3{otp_str}")
                print("─" * 60)
                print(f"  Local Web Player  : http://{lan_ip}:{args.port}/{otp_str}")
                print(f"  Local MP3 Stream  : http://{lan_ip}:{args.port}/stream.mp3{otp_str}")
                print("═" * 60)
                return 0
            else:
                print(f"Error starting public tunnel: {res_url}", file=sys.stderr)
                return 1

    # Start server
    server_pid = is_server_running()
    if server_pid:
        lan_ip = get_lan_ip()
        print(f"Stream server is already running (PID {server_pid}).")
        print(f"Stream URL: http://{lan_ip}:{args.port}/stream.mp3")
        pub_url = db.get_setting("public_url", "")
        if pub_url and is_tunnel_running():
            print(f"Public URL: {pub_url}/stream.mp3")
        print("Use './stream.py stop' to stop it, or './stream.py status' for details.")
        return 0

    server_script = ROOT_DIR / "stream.py"

    if args.daemon:
        print("Starting stream server in background (daemon mode)...")
        cmd_args = [
            sys.executable,
            str(server_script),
            "--mode",
            args.mode,
            "--port",
            str(args.port),
        ]
        if args.url:
            cmd_args.extend(["--url", args.url])
        if args.queue:
            cmd_args.append("--queue")

        log_file = open(SERVER_LOG_FILE, "a")
        proc = subprocess.Popen(
            cmd_args,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        time.sleep(1.0)
        if proc.poll() is None:
            lan_ip = get_lan_ip()
            PID_FILE.write_text(str(proc.pid))
            db.set_setting("server_pid", str(proc.pid))
            print(f"✓ Stream server started successfully (PID {proc.pid})")
            print(f"  Local Stream : http://{lan_ip}:{args.port}/stream.mp3")
            print(f"  Web Player   : http://{lan_ip}:{args.port}/")
            if args.public:
                print("Starting persistent public Cloudflare Tunnel...", flush=True)
                ok, res_url = start_tunnel(args.port)
                if ok:
                    otp_str = f"?otp={security.get_current_otp()}" if security.is_enabled() else ""
                    print(f"  Public Stream: {res_url}/stream.mp3{otp_str}")
                    print(f"  Public Player: {res_url}/{otp_str}")
                else:
                    print(f"  Warning: Failed to start public tunnel: {res_url}")
            print(f"  Logs         : {SERVER_LOG_FILE}")
            return 0
        else:
            print(f"Error starting stream server. Check {SERVER_LOG_FILE}", file=sys.stderr)
            return 1
    else:
        # Run in foreground
        from music_streamer.engine import AudioEngine, Broadcaster
        from music_streamer.server import StreamRequestHandler, ThreadedStreamServer, run_unix_socket_listener

        broadcaster = Broadcaster()
        engine = AudioEngine(db, broadcaster, mode=args.mode)
        engine.start()

        PID_FILE.write_text(str(os.getpid()))
        PLAYER_PID_FILE.write_text(str(os.getpid()))
        db.set_setting("server_pid", str(os.getpid()))
        db.set_setting("player_pid", str(os.getpid()))

        ipc_thread = threading.Thread(target=run_unix_socket_listener, args=(engine,), daemon=True)
        ipc_thread.start()

        lan_ip = get_lan_ip()
        print("=" * 60)
        print(" 🎵 MUSIC STREAMER — Continuous Broadcast & Synced Audio")
        print("=" * 60)
        print(f"  Local Stream URL : http://{lan_ip}:{args.port}/stream.mp3")
        print(f"  Local Web Player : http://{lan_ip}:{args.port}/")
        print(f"  Status JSON      : http://{lan_ip}:{args.port}/status")
        print(f"  Output Mode      : {args.mode.upper()}")
        if security.is_enabled():
            otp_code = security.get_current_otp()
            print(f"  🔐 Security Status : ENABLED (Active OTP: {otp_code})")
            print(f"  Direct Unlock Link: http://{lan_ip}:{args.port}/?otp={otp_code}")
        else:
            print("  🔓 Security Status : DISABLED (Public Access)")
        print("=" * 60)
        print("  ✓ Always-On Stream: continuous silence broadcast when idle/stopped.")
        print("  ✓ Synchronization: ALSA server speaker and HTTP clients in exact sync.")
        print("=" * 60, flush=True)

        if args.public:
            if any(os.path.exists(p) for p in ["/usr/local/bin/cloudflared", "/usr/bin/cloudflared"]):
                print("Starting public Cloudflare Tunnel...", flush=True)
                cf_cmd = ["cloudflared", "tunnel", "--url", f"http://localhost:{args.port}"]
                try:
                    cf = subprocess.Popen(cf_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

                    def monitor_cf():
                        for line in cf.stdout:
                            if "https://" in line and "trycloudflare.com" in line:
                                m = re.search(r"https://[^\s]+\.trycloudflare\.com", line)
                                if m:
                                    pub_url = m.group(0)
                                    db.set_setting("public_url", pub_url)
                                    print(f"\n🌐 PUBLIC URL: {pub_url}/stream.mp3", flush=True)
                                    print(f"   Web Player: {pub_url}/\n", flush=True)
                                    break

                    threading.Thread(target=monitor_cf, daemon=True).start()
                except Exception as e:
                    print(f"Failed to launch cloudflared: {e}", file=sys.stderr)

        if args.url:
            engine.post_command({"action": "play", "url": args.url})
        elif args.queue:
            engine.post_command({"action": "play"})

        def handle_sig(sig, frame):
            print("\nShutting down stream server...")
            engine.running = False
            engine._stop_decoder()
            engine._close_alsa_sink()
            PID_FILE.unlink(missing_ok=True)
            PLAYER_PID_FILE.unlink(missing_ok=True)
            db.set_setting("server_pid", "0")
            db.set_setting("state", "stopped")
            sys.exit(0)

        signal.signal(signal.SIGINT, handle_sig)
        signal.signal(signal.SIGTERM, handle_sig)

        httpd = ThreadedStreamServer(("0.0.0.0", args.port), StreamRequestHandler, engine, broadcaster, db)
        try:
            httpd.serve_forever()
        except Exception:
            pass
        finally:
            handle_sig(None, None)
        return 0


def main():
    """Top-level CLI router when invoked via python -m music_streamer.cli <command>."""
    parser = argparse.ArgumentParser(description="Music Streamer CLI Suite")
    subparsers = parser.add_subparsers(dest="subcommand", help="Command to run")

    subparsers.add_parser("play", parents=[build_play_parser()], add_help=False)
    subparsers.add_parser("search", parents=[build_search_parser()], add_help=False)
    subparsers.add_parser("playback", parents=[build_playback_parser()], add_help=False)
    subparsers.add_parser("playlist", parents=[build_playlist_parser()], add_help=False)
    subparsers.add_parser("pause", parents=[build_stop_parser()], add_help=False)
    subparsers.add_parser("resume", parents=[build_stop_parser()], add_help=False)
    subparsers.add_parser("volume", parents=[build_volume_parser()], add_help=False)
    subparsers.add_parser("loop", parents=[build_loop_parser()], add_help=False)
    subparsers.add_parser("otp", parents=[build_otp_parser()], add_help=False)
    subparsers.add_parser("status", parents=[build_status_parser()], add_help=False)
    subparsers.add_parser("stop", parents=[build_stop_parser()], add_help=False)
    subparsers.add_parser("stream", parents=[build_stream_parser()], add_help=False)

    if len(sys.argv) < 2:
        parser.print_help()
        sys.exit(0)

    args = parser.parse_args()
    dispatch = {
        "play": handle_play,
        "search": handle_search,
        "playback": handle_playback,
        "playlist": handle_playlist,
        "pause": handle_pause,
        "resume": handle_resume,
        "volume": handle_volume,
        "loop": handle_loop,
        "otp": handle_otp,
        "status": handle_status,
        "stop": handle_stop,
        "stream": handle_stream,
    }

    handler = dispatch.get(args.subcommand)
    if handler:
        sys.exit(handler(args))
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
