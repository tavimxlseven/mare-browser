"""Prefer exact audio/lyric editions and preserve the original session file."""

from pathlib import Path
import re
import shutil
import tempfile

VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")


def normalized(value):
    return " ".join("".join(c if c.isalnum() else " " for c in value.lower()).split())


def contains(text, words):
    return f" {words} " in f" {text} "


def choose(entries, title, artists, duration):
    expected = normalized(title.split("(")[0])
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
            and artist not in name
            and artist not in channel
        ):
            continue
        if any(
            contains(name, marker) and not contains(normalized(title), marker)
            for marker in (
                "official video",
                "music video",
                "video oficial",
                "videoclipe",
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
        actual = float(entry.get("duration") or 0)
        difference = abs(actual - duration)
        if duration and (not actual or difference > max(12, duration * 0.06)):
            continue
        rank = (
            100
            if "official audio" in name
            else (
                90
                if "lyric" in name or "letra" in name
                else 85 if channel.endswith("topic") else 75 if "audio" in name else 0
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
        js_runtimes={"node": {"path": shutil.which("node") or "/opt/node/bin/node"}},
    )
    title = metadata["title"]
    artists = metadata.get("artists") or metadata.get("artist") or ""
    if isinstance(artists, list):
        artists = ", ".join(
            str(a.get("name", "") if isinstance(a, dict) else a) for a in artists
        )
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
        for hint in ("lyrics", "official audio"):
            with YoutubeDL(
                {**options, "extract_flat": True, "skip_download": True}
            ) as ydl:
                results = ydl.extract_info(
                    f"ytsearch8:{artists} {title} {hint}", download=False
                )
            selected = choose(
                (results or {}).get("entries") or [],
                title,
                artists,
                float(metadata.get("duration_ms") or 0) / 1000,
            )
            if selected:
                break
        if not selected:
            raise ValueError("No matching audio edition")
        with YoutubeDL(options) as ydl:
            ydl.download(["https://www.youtube.com/watch?v=" + selected["id"]])
    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError("Incomplete audio")
    return path
