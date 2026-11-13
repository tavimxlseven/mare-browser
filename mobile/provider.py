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


class TrackPreparationError(ValueError):
    """A safe per-song error that does not pause unrelated songs."""


ID = re.compile(r"[a-zA-Z0-9]{22}")
LINK = re.compile(
    r"(?:https://open\.spotify\.com/(?:intl-[a-zA-Z-]+/)?(track|playlist|album)/|spotify:(track|playlist|album):)([A-Za-z0-9]{22})(?:\?[^\s]*)?"
)


def track(raw):
    identifier = raw.get("id", "")
    title = raw.get("title")
    if (
        not isinstance(identifier, str)
        or not ID.fullmatch(identifier)
        or not isinstance(title, str)
        or not title.strip()
    ):
        return None
    artists = raw.get("artists") or raw.get("artist", "")
    if isinstance(artists, list):
        artists = ", ".join(
            str(a.get("name", "") if isinstance(a, dict) else a) for a in artists[:10]
        )
    art = str(raw.get("thumbnail", ""))
    if not art.startswith(
        ("https://i.scdn.co/", "https://image-cdn-ak.spotifycdn.com/")
    ):
        art = ""
    duration = raw.get("duration_ms", 0)
    duration = (
        int(duration)
        if isinstance(duration, (int, float)) and 0 < duration <= 86_400_000
        else 0
    )
    return dict(
        id=identifier,
        title=title.strip()[:300],
        artist=str(artists)[:300],
        art=art,
        duration_ms=duration,
    )


def search(query):
    url = "https://spotify.xwolf.space/api/search?" + urlencode(
        dict(q=query, type="track", limit=25)
    )
    with urlopen(
        Request(
            url, headers={"User-Agent": "MareMusic/1", "Accept": "application/json"}
        ),
        timeout=12,
    ) as response:
        raw = json.loads(response.read(1_048_577))
    if raw.get("success") is not True or not isinstance(raw.get("results"), list):
        raise ValueError("catalog")
    return [
        t
        for item in raw["results"][:25]
        if isinstance(item, dict) and (t := track(item))
    ]


def artwork(identifier):
    """Resolve the cover of this exact track, independent of its playlist cover."""
    if not ID.fullmatch(identifier):
        raise ValueError("track id")
    endpoint = "https://open.spotify.com/oembed?" + urlencode(
        {"url": f"https://open.spotify.com/track/{identifier}"}
    )
    with urlopen(
        Request(endpoint, headers={"User-Agent": "MareMusic/1"}), timeout=6
    ) as response:
        metadata = json.loads(response.read(1_048_577))
    cover = str(metadata.get("thumbnail_url", ""))
    if cover.startswith(("https://i.scdn.co/", "https://image-cdn-ak.spotifycdn.com/")):
        return cover
    return ""


def cli(args, timeout):
    from audio_source import EXTRACTION_SLOTS

    with EXTRACTION_SLOTS:
        return _cli(args, timeout)


def _cli(args, timeout):
    env = {k: v for k, v in os.environ.items() if not k.startswith("MARE_")}
    env.update(QT_QPA_PLATFORM="offscreen", PYTHONIOENCODING="utf-8")
    child = subprocess.Popen(
        [os.getenv("SUNNIFY_BIN", "sunnify"), *args],
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        start_new_session=os.name == "posix",
    )
    try:
        output, _ = child.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        if os.name == "posix":
            os.killpg(child.pid, signal.SIGKILL)
        else:
            child.kill()
        child.communicate()
        raise
    if (
        b"prove it isn" in output
        or b"bot" in output.lower()
        and b"refused" in output.lower()
    ):
        raise PreparationError(
            "A fonte de áudio bloqueou a rede da VM. A música ainda não está disponível."
        )
    if child.returncode or len(output) > 5_000_000:
        raise ValueError("Sunnify")
    return output


def normalize_link(link):
    match = LINK.fullmatch(link)
    if not match:
        raise ValueError("link")
    kind, uri_kind, identifier = match.groups()
    kind = kind or uri_kind
    return kind, identifier, f"https://open.spotify.com/{kind}/{identifier}"


class Collection(tuple):
    def __new__(cls, kind, identifier, name, tracks, art):
        value=super().__new__(cls,(kind,identifier,name,tracks))
        value.art=art
        return value


def collection(link):
    kind, identifier, _ = normalize_link(link)
    data = json.loads(
        cli(["info", f"https://open.spotify.com/{kind}/{identifier}", "--json"], 90)
    )
    raw = [data] if kind == "track" else data["tracks"]
    if not isinstance(raw, list) or len(raw) > 2000:
        raise ValueError("collection")
    tracks = [t for entry in raw if isinstance(entry, dict) and (t := track(entry))]
    if not tracks:
        raise ValueError("empty")
    art=str(data.get("thumbnail") or data.get("thumbnail_url") or "")
    if not art.startswith(("https://i.scdn.co/","https://mosaic.scdn.co/","https://image-cdn-ak.spotifycdn.com/")) or len(art)>600:
        art=""
    return Collection(kind, identifier, str(data.get("name", ""))[:200], tracks, art)


def download(identifier, directory, metadata=None):
    if not ID.fullmatch(identifier):
        raise ValueError("track id")
    from audio_source import download as audio_download, NoMatchingAudio
    from source_session import session_path

    if not metadata or not metadata.get("duration_ms"):
        resolved = json.loads(
            cli(["info", f"https://open.spotify.com/track/{identifier}", "--json"], 90)
        )
        if not track(resolved) or resolved["id"] != identifier:
            raise TrackPreparationError(
                "Não foi possível confirmar os dados desta música."
            )
        if metadata is not None:
            metadata.clear()
            metadata.update(resolved)
        else:
            metadata = resolved
    try:
        return audio_download(
            identifier,
            directory,
            metadata,
            str(session_path(Path(os.getenv("MARE_DATA", directory))))
            if session_path(Path(os.getenv("MARE_DATA", directory))).is_file() else "",
        )
    except Exception as error:
        if isinstance(error, NoMatchingAudio):
            raise TrackPreparationError(
                "Não encontramos um resultado compatível com esta gravação."
            ) from None
        message = str(error).lower()
        if any(
            marker in message
            for marker in (
                "not a bot",
                "sign in to confirm",
                "session unavailable",
                "http error 429",
                "too many requests",
            )
        ):
            raise PreparationError(
                "A fonte de áudio pediu uma nova autenticação. A fila foi preservada."
            ) from None
        if "requested format" in message:
            raise TrackPreparationError(
                "Esta fonte não disponibilizou áudio compatível. Tente novamente mais tarde."
            ) from None
        raise TrackPreparationError(
            "A fonte de áudio não concluiu a transferência. Toque em tentar novamente."
        ) from None
