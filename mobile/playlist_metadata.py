"""Small, account-owned playlist covers. No remote URL fetching or SVG uploads."""
import base64
import binascii
import re
from flask import abort


def artwork(value):
    if not isinstance(value, str) or len(value) > 32768:
        abort(400)
    if not value:
        return ""
    if re.fullmatch(r"https://(?:i\.scdn\.co|mosaic\.scdn\.co|i\.ytimg\.com|image-cdn-(?:ak|fa)\.spotifycdn\.com)/[^\s<>\"']{1,500}", value):
        return value
    match = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)", value)
    if not match:
        abort(400)
    try:
        raw = base64.b64decode(match[2], validate=True)
    except (ValueError, binascii.Error):
        abort(400)
    valid = {"jpeg": raw.startswith(b"\xff\xd8\xff"), "png": raw.startswith(b"\x89PNG\r\n\x1a\n"),
             "webp": raw.startswith(b"RIFF") and raw[8:12] == b"WEBP"}
    if not valid[match[1]]:
        abort(400)
    return value


def update(con, owner, identifier, payload):
    row = con.execute("SELECT * FROM playlists WHERE owner=? AND id=?", (owner, identifier)).fetchone()
    if not row:
        abort(404)
    name = str(payload.get("name", row["custom_name"] or row["name"])).strip()
    if not 1 <= len(name) <= 100:
        abort(400)
    cover = artwork(payload["art"]) if "art" in payload else row["custom_art"]
    total = con.execute("SELECT coalesce(sum(length(custom_art)),0) FROM playlists WHERE owner=? AND id<>?", (owner, identifier)).fetchone()[0]
    if total + len(cover) > 524288:
        abort(413)
    con.execute("UPDATE playlists SET custom_name=?,custom_art=? WHERE owner=? AND id=?", (name, cover, owner, identifier))


def decorate(con, owner, playlist):
    playlist["name"] = playlist.pop("custom_name", "") or playlist["name"]
    playlist["art"] = playlist.pop("custom_art", "") or playlist.get("art", "")
    if not playlist["art"]:
        import json
        ids = playlist["tracks"] if isinstance(playlist["tracks"], list) else json.loads(playlist["tracks"])
        # Preserve a useful cover for old imports without reimporting or preparing audio.
        for identifier in ids[:20]:
            track = con.execute("SELECT t.art FROM tracks t JOIN user_tracks u ON u.track_id=t.id WHERE u.owner=? AND t.id=?", (owner, identifier)).fetchone()
            if track and track[0]:
                playlist["art"] = track[0]
                break
    return playlist
