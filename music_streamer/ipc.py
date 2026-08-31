"""
Synchronous Unix Domain Socket & REST API IPC client for CLI tools.
"""

import json
import socket
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

from music_streamer.config import DEFAULT_PORT, SOCKET_PATH


def send_ipc_command(
    payload: Dict[str, Any],
    socket_path: str = SOCKET_PATH,
    timeout: float = 3.0,
    fallback_port: int = DEFAULT_PORT,
) -> Dict[str, Any]:
    """
    Sends a command synchronously to the stream server daemon.
    Tries Unix domain socket first, falls back to HTTP REST API if socket is unavailable.
    Returns: {"success": bool, "data": dict, "error": str}
    """
    # 1. Try Unix Domain Socket
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect(socket_path)
        raw_msg = json.dumps(payload).encode("utf-8")
        sock.sendall(raw_msg)

        raw_resp = sock.recv(4096).decode("utf-8")
        sock.close()
        if raw_resp:
            try:
                resp_data = json.loads(raw_resp.strip())
                return {"success": True, "data": resp_data}
            except Exception:
                return {"success": True, "data": {"raw": raw_resp.strip()}}
        return {"success": True, "data": {"status": "ok"}}
    except (FileNotFoundError, ConnectionRefusedError, socket.timeout, OSError):
        pass

    # 2. Try HTTP REST API fallback
    try:
        action = payload.get("action", "")
        endpoint = f"http://localhost:{fallback_port}/api/{action}" if action else f"http://localhost:{fallback_port}/status"
        req = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as response:
            resp_body = response.read().decode("utf-8")
            return {"success": True, "data": json.loads(resp_body) if resp_body else {"status": "ok"}}
    except Exception:
        pass

    return {
        "success": False,
        "error": "Stream server is not running. Start with: ./stream.py --daemon --mode speaker --port 8000",
    }
