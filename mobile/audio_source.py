"""Prefer exact audio/lyric editions and preserve the original session file."""

from pathlib import Path
import re
import shutil
import tempfile
import threading
import os
import unicodedata

VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")
EXTRACTION_SLOTS = threading.BoundedSemaphore(1)


class NoMatchingAudio(ValueError):
    pass


def normalized(value):
    value = "".join(
        c
        for c in unicodedata.normalize("NFKD", value.lower())
        if not unicodedata.combining(c)
    )
    return " ".join("".join(c if c.isalnum() else " " for c in value).split())


def contains(text, words):
    if any("\u3040" <= c <= "\u9fff" for c in words):
        return words in text
    return f" {words} " in f" {text} "


def choose(entries, title, artists, duration, fallback=False):
    expected = normalized(title.split("(")[0].strip() or title)
    artist = normalized(re.split("[,&]", artists)[0])
    candidates = []
    for entry in entries:
        if (
            not isinstance(entry, dict)
            or not VIDEO_ID.fullmatch(str(entry.get("id", "")))
            or entry.get("is_live")
        ):
            continue
        name = normalized(entry.get("title") or "")
        channel = normalized(entry.get("uploader") or entry.get("channel") or "")
        if (
            not expected
            or not contains(name, expected)
            or artist
            and not contains(name, artist)
            and not contains(channel, artist)
        ):
            continue
        if any(
            contains(name, marker) and not contains(normalized(title), marker)
            for marker in (
                "live",
                "cover",
                "remix",
                "slowed",
                "sped up",
                "karaoke",
                "instrumental",
            )
        ):
            continue
        if not fallback and any(
            contains(name, marker)
            for marker in (
                "official video",
                "music video",
                "video oficial",
                "videoclipe",
            )
        ):
            continue
        actual = float(entry.get("duration") or 0)
        difference = abs(actual - duration)
        tolerance = max(45, duration * 0.2) if fallback else max(12, duration * 0.06)
        if duration and (not actual or difference > tolerance):
            continue
        if fallback:
            return entry
        rank = (
            100
            if "official audio" in name
            else (
                90
                if any(marker in name for marker in ("lyric", "letra", "歌詞", "字幕"))
                else (
                    85
                    if channel.endswith("topic") or "visualizer" in name
                    else 75 if "audio" in name else 0
                )
            )
        )
        if rank:
            candidates.append((rank - min(difference, 60), entry))
    return max(candidates, key=lambda item: item[0])[1] if candidates else None


class QuietLogger:
    def debug(self, message):
        pass

    def info(self, message):
        pass

    def warning(self, message):
        pass

    def error(self, message):
        pass


def download(identifier, directory, metadata, session_file=""):
    from yt_dlp import YoutubeDL

    path = Path(directory) / f"{identifier}.m4a"
    cache = Path(os.getenv("MARE_DATA", directory)) / "private" / "extractor-cache"
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    options = dict(
        quiet=True,
        no_warnings=True,
        logger=QuietLogger(),
        noplaylist=True,
        socket_timeout=15,
        retries=1,
        fragment_retries=1,
        format="bestaudio[ext=m4a]/bestaudio[ext=mp4]",
        outtmpl=str(path),
        cachedir=str(cache),
        js_runtimes={"node": {"path": shutil.which("node") or "/opt/node/bin/node"}},
    )
    title = metadata["title"]
    artists = metadata.get("artists") or metadata.get("artist") or ""
    if isinstance(artists, list):
        artists = ", ".join(
            str(a.get("name", "") if isinstance(a, dict) else a) for a in artists
        )
    primary_artist = re.split("[,&]", artists)[0].strip()
    with tempfile.TemporaryDirectory(
        prefix="source-session-", dir=directory
    ) as private:
        if session_file:
            cookie = Path(session_file)
            if not cookie.is_file() or cookie.is_symlink():
                raise ValueError("Session unavailable")
            copy = Path(private) / "cookies.txt"
            shutil.copyfile(cookie, copy)
            copy.chmod(0o600)
            options["cookiefile"] = str(copy)
        selected = None
        native = any("\u3040" <= c <= "\u9fff" for c in title + artists)
        hints = (
            ("歌詞 フル", "official audio", "lyrics")
            if native
            else ("lyrics", "official audio")
        )
        candidates = []
        for hint in hints:
            with YoutubeDL(
                {**options, "extract_flat": True, "skip_download": True}
            ) as ydl:
                results = ydl.extract_info(
                    f"ytsearch12:{primary_artist} {title} {hint}", download=False
                )
            entries = (results or {}).get("entries") or []
            candidates.extend(entries)
            selected = choose(
                entries,
                title,
                artists,
                float(metadata.get("duration_ms") or 0) / 1000,
            )
            if selected:
                break
        if not selected:
            with YoutubeDL(
                {**options, "extract_flat": True, "skip_download": True}
            ) as ydl:
                plain = ydl.extract_info(
                    f"ytsearch12:{primary_artist} {title}", download=False
                )
            selected = choose(
                (plain or {}).get("entries") or [],
                title,
                artists,
                float(metadata.get("duration_ms") or 0) / 1000,
                fallback=True,
            )
            if not selected:
                selected = choose(
                    candidates,
                    title,
                    artists,
                    float(metadata.get("duration_ms") or 0) / 1000,
                    fallback=True,
                )
        if not selected:
            raise NoMatchingAudio("No matching audio edition")
        with EXTRACTION_SLOTS, YoutubeDL(options) as ydl:
            ydl.download(["https://www.youtube.com/watch?v=" + selected["id"]])
    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError("Incomplete audio")
    return path
