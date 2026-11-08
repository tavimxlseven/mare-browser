"""Public catalog metadata and on-demand, unmodified Sunnify CLI."""
import json
import os
from pathlib import Path
import re
import signal
import subprocess
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class PreparationError(Exception):
    """A safe, actionable error for the player."""


ID = re.compile(r"[a-zA-Z0-9]{22}")
LINK = re.compile(r"(?:https://open\.spotify\.com/(?:intl-[a-zA-Z-]+/)?(track|playlist|album)/|spotify:(track|playlist|album):)([A-Za-z0-9]{22})(?:\?[^\s]*)?")


def track(raw):
    identifier = raw.get("id", "")
    title = raw.get("title")
    if not isinstance(identifier, str) or not ID.fullmatch(identifier) or not isinstance(title, str) or not title.strip():
        return None
    artists = raw.get("artists") or raw.get("artist", "")
    if isinstance(artists, list):
        artists = ", ".join(str(a.get("name", "") if isinstance(a, dict) else a) for a in artists[:10])
    art = str(raw.get("thumbnail", ""))
    if not art.startswith(("https://i.scdn.co/", "https://image-cdn-ak.spotifycdn.com/")):
        art = ""
    return dict(id=identifier, title=title.strip()[:300], artist=str(artists)[:300], art=art)


def search(query):
    url = "https://spotify.xwolf.space/api/search?" + urlencode(dict(q=query, type="track", limit=25))
    with urlopen(Request(url, headers={"User-Agent": "MareMusic/1", "Accept": "application/json"}), timeout=12) as response:
        raw = json.loads(response.read(1_048_577))
    if raw.get("success") is not True or not isinstance(raw.get("results"), list):
        raise ValueError("catalog")
    return [t for item in raw["results"][:25] if isinstance(item,dict) and (t := track(item))]


def cli(args, timeout):
    env = {k: v for k, v in os.environ.items() if not k.startswith("MARE_")}
    env.update(QT_QPA_PLATFORM="offscreen", PYTHONIOENCODING="utf-8")
    child = subprocess.Popen([os.getenv("SUNNIFY_BIN", "sunnify"), *args], env=env,
                             stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             start_new_session=os.name == "posix")
    try:
        output, _ = child.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        if os.name == "posix":
            os.killpg(child.pid, signal.SIGKILL)
        else:
            child.kill()
        child.communicate()
        raise
    if b"prove it isn" in output or b"bot" in output.lower() and b"refused" in output.lower():
        raise PreparationError("A fonte de áudio bloqueou a rede da VM. A música ainda não está disponível.")
    if child.returncode or len(output) > 5_000_000:
        raise ValueError("Sunnify")
    return output


def collection(link):
    match = LINK.fullmatch(link)
    if not match:
        raise ValueError("link")
    kind, uri_kind, identifier = match.groups()
    kind = kind or uri_kind
    data = json.loads(cli(["info", f"https://open.spotify.com/{kind}/{identifier}", "--json"], 90))
    raw = [data] if kind == "track" else data["tracks"]
    if not isinstance(raw, list) or len(raw) > 2000:
        raise ValueError("collection")
    tracks = [t for entry in raw if isinstance(entry, dict) and (t := track(entry))]
    if not tracks:
        raise ValueError("empty")
    return kind, identifier, str(data.get("name", ""))[:200], tracks


def download(identifier, directory):
    if not ID.fullmatch(identifier):
        raise ValueError("track id")
    args = ["download", f"https://open.spotify.com/track/{identifier}", "--out", str(directory),
            "--format", "m4a", "--quality", "192", "--no-loose-match", "--json"]
    cookies = os.getenv("SUNNIFY_COOKIES_FILE", "").strip()
    if cookies:
        path = Path(cookies)
        if not path.is_file() or path.is_symlink():
            raise PreparationError("A sessão da fonte de áudio está indisponível. Verifique a configuração privada.")
        args.extend(["--cookies", str(path)])
    cli(args, 420)
    files = [p for p in Path(directory).rglob("*.m4a") if p.is_file() and not p.is_symlink() and p.stat().st_size]
    if len(files) != 1:
        raise ValueError("audio")
    return files[0]
