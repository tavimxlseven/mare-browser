"""Private Unix-socket client. Browser cookies never leave the server-side bridge."""
import json
import os
import socket


def call(action, **payload):
    path = os.getenv("NOISE_SOURCE_BROWSER_SOCKET", "/run/noise-source/control.sock")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as channel:
        channel.settimeout(60)
        channel.connect(path)
        channel.sendall(json.dumps(dict(action=action, **payload)).encode() + b"\n")
        with channel.makefile("rb") as stream:
            raw = stream.readline(2_000_001)
        if len(raw) > 2_000_000 or not raw.endswith(b"\n"):
            raise ValueError("Invalid private browser response")
        response = json.loads(raw)
        if not isinstance(response, dict):
            raise ValueError("Invalid private browser response")
        return response
