"""On-demand browser in a separate OS account; no passwords, frames or cookies logged."""
import json
import os
from pathlib import Path
import signal
import socketserver
import subprocess
import threading
import time
import sys
from urllib.request import urlopen


class Browser:
    def __init__(self, root):
        self.root = Path(root)
        self.profile = self.root / "profile"
        self.profile.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = threading.RLock()
        self.processes = []
        self.connection = None
        self.counter = 0
        self.lease = None
        self.deadline = 0

    def stop(self):
        if self.connection:
            self.connection.close()
        self.connection = None
        for process in reversed(self.processes):
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=4)
        self.processes = []
        self.lease = None
        self.deadline = 0

    def command(self, method, params=None):
        self.counter += 1
        identifier = self.counter
        self.connection.send(json.dumps(dict(id=identifier, method=method, params=params or {})))
        while True:
            response = json.loads(self.connection.recv())
            if response.get("id") == identifier:
                if "error" in response:
                    raise ValueError("Browser command failed")
                return response.get("result", {})

    def start(self, lease=None):
        if self.processes:
            if self.lease and self.lease != lease:
                return False
            if lease:
                self.lease = lease
                self.deadline = time.monotonic() + 600
            return True
        active = self.profile / "DevToolsActivePort"
        active.unlink(missing_ok=True)
        display = os.getenv("NOISE_SOURCE_DISPLAY", ":97")
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(self.root),
               "DISPLAY": display, "LANG": "en_US.UTF-8", "XDG_CONFIG_HOME": str(self.root / "config"),
               "XDG_CACHE_HOME": str(self.root / "cache")}
        commands = [
            ["/usr/bin/Xvfb", display, "-screen", "0", "1200x900x24", "-nolisten", "tcp"],
            [os.getenv("NOISE_SOURCE_CHROME", "/usr/bin/google-chrome"),
             "--user-data-dir=" + str(self.profile), "--remote-debugging-port=0",
             "--remote-debugging-address=127.0.0.1", "--no-first-run", "--no-default-browser-check",
             "--disable-background-networking", "--disable-extensions", "--disable-sync",
             "--disable-dev-shm-usage", "--disable-gpu", "--window-size=1200,900",
             "about:blank"]]
        try:
            for command in commands:
                self.processes.append(subprocess.Popen(command, env=env, stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True))
                time.sleep(.5)
            for _ in range(200):
                if self.processes[-1].poll() is not None:
                    raise OSError("Browser unavailable")
                if active.is_file():
                    break
                time.sleep(.15)
            port = int(active.read_text().splitlines()[0])
            with urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5) as response:
                pages = json.load(response)
            page = next(p for p in pages if p.get("type") == "page")
            import websocket
            self.connection = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=15,
                                                          suppress_origin=True)
            self.lease = lease
            self.deadline = time.monotonic() + (600 if lease else 45)
            if lease:
                self.command("Page.navigate", {"url": "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F"})
            return True
        except Exception:
            self.stop()
            raise

    def cookies(self):
        cookies = self.command("Storage.getCookies").get("cookies", [])
        lines = ["# Netscape HTTP Cookie File"]
        for cookie in cookies:
            domain = cookie.get("domain", "")
            if domain.lstrip(".") not in ("youtube.com", "www.youtube.com", "google.com", "accounts.google.com"):
                continue
            values = [domain, "TRUE" if domain.startswith(".") else "FALSE", cookie.get("path", "/"),
                      "TRUE" if cookie.get("secure") else "FALSE", str(int(cookie["expires"])) if cookie.get("expires", 0) > 0 else "",
                      cookie.get("name", ""), cookie.get("value", "")]
            if not any("\n" in value or "\t" in value or "\r" in value for value in values):
                lines.append("\t".join(values))
        return "\n".join(lines) + "\n"

    def handle(self, payload):
        with self.lock:
            action = payload.get("action")
            lease = payload.get("lease")
            if action == "status":
                return dict(ok=True, running=bool(self.processes), interactive=bool(self.lease))
            if action == "refresh":
                if self.lease:
                    return dict(ok=False, error="interactive")
                try:
                    self.start()
                    self.command("Page.navigate", {"url": "https://www.youtube.com/"})
                    time.sleep(4)
                    return dict(ok=True, cookies=self.cookies())
                finally:
                    self.stop()
            if action == "start":
                if not isinstance(lease, str) or len(lease) != 64:
                    return dict(ok=False, error="forbidden")
                return dict(ok=True) if self.start(lease) else dict(ok=False, error="busy")
            if not self.lease or self.lease != lease or not self.connection:
                return dict(ok=False, error="forbidden")
            if action == "stop":
                self.stop()
                return dict(ok=True)
            if action == "extract":
                return dict(ok=True, cookies=self.cookies())
            if action == "frame":
                return dict(ok=True, image=self.command("Page.captureScreenshot", {
                    "format": "jpeg", "quality": 65, "captureBeyondViewport": False})["data"])
            if action == "click":
                x, y = payload.get("x"), payload.get("y")
                if type(x) is not int or type(y) is not int or not 0 <= x <= 1200 or not 0 <= y <= 900:
                    return dict(ok=False, error="invalid")
                for kind in ("mousePressed", "mouseReleased"):
                    self.command("Input.dispatchMouseEvent", dict(type=kind, x=x, y=y, button="left", clickCount=1))
                return dict(ok=True)
            if action == "text":
                text = payload.get("text")
                if not isinstance(text, str) or not 1 <= len(text) <= 1024:
                    return dict(ok=False, error="invalid")
                self.command("Input.insertText", {"text": text})
                return dict(ok=True)
            if action == "key":
                key = payload.get("key")
                keys = {"Enter": 13, "Tab": 9, "Backspace": 8, "Escape": 27,
                        "ArrowLeft": 37, "ArrowUp": 38, "ArrowRight": 39, "ArrowDown": 40,
                        "Delete": 46, "Home": 36, "End": 35, "PageUp": 33, "PageDown": 34}
                if key not in keys:
                    return dict(ok=False, error="invalid")
                for kind in ("keyDown", "keyUp"):
                    self.command("Input.dispatchKeyEvent", dict(type=kind, key=key, windowsVirtualKeyCode=keys[key]))
                return dict(ok=True)
            return dict(ok=False, error="invalid")


def main():
    browser = Browser(os.getenv("NOISE_SOURCE_BROWSER_HOME", "/var/lib/noise-source"))
    path = Path(os.getenv("NOISE_SOURCE_BROWSER_SOCKET", "/run/noise-source/control.sock"))
    path.unlink(missing_ok=True)

    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            try:
                raw = self.rfile.readline(8193)
                payload = json.loads(raw) if len(raw) <= 8192 else {}
                result = browser.handle(payload)
            except Exception as error:
                print("Source browser operation failed: " + type(error).__name__, file=sys.stderr, flush=True)
                result = dict(ok=False, error="unavailable")
            self.wfile.write(json.dumps(result).encode() + b"\n")

    class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
        daemon_threads = True

    def expire():
        while True:
            time.sleep(2)
            with browser.lock:
                if browser.deadline and time.monotonic() > browser.deadline:
                    browser.stop()

    threading.Thread(target=expire, daemon=True).start()
    with Server(str(path), Handler) as server:
        os.chmod(path, 0o660)
        server.serve_forever()


if __name__ == "__main__":
    main()
