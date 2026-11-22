#!/usr/bin/env python3
"""Package the standalone Noise Music app for the current Mac."""
import hashlib
import json
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist" / "macos"
MANIFEST = ROOT / "macos/package.json"
VERSION = json.loads(MANIFEST.read_text())["version"]
ARCH = {"x86_64": "x64", "arm64": "arm64"}.get(platform.machine())
PINS = {
    "x64": (
        "1c80d2ccf71b02c8fd9940fd09cafe88090a48c1bab0193c79b597b08d890e79",
        "536a93155c7c7467946c0b47b76ec7781540630477ffd6037bc68025e2028f63",
        "4b2f5edd2639b7470f034238b321d7002d8dfb4726d8558f52c17afac370eb2c",
    ),
    "arm64": (
        "d080c3b05a01bd16137f2c12ab9ebf083c577757fe846844ba325bafa8e8bdf4",
        "ad8b9ed0c82d142757f866f407ecc311e8a6bf91d953871f902862a3bb79e805",
        "9f0bf660393da2eaff044cdc7444cb08c73f235849b61d224d825a194ce7c98e",
    ),
}
SUNNIFY = "sunnypatell/sunnify-spotify-downloader"


def run(*args):
    subprocess.run(args, check=True)


def download(url, destination, digest=None):
    request = urllib.request.Request(url, headers={"User-Agent": "Compass-macOS-Release"})
    with urllib.request.urlopen(request, timeout=180) as source, destination.open("wb") as output:
        shutil.copyfileobj(source, output)
    if digest and checksum(destination) != digest:
        raise SystemExit(f"Checksum mismatch: {destination.name}")


def checksum(path):
    with path.open("rb") as handle:
        digest = hashlib.sha256()
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
        return digest.hexdigest()


def release_asset(directory, repo, tag, name, digest):
    destination = directory / name
    download(f"https://github.com/{repo}/releases/download/{tag}/{name}", destination, digest)
    return destination


def main():
    if platform.system() != "Darwin" or ARCH not in PINS:
        raise SystemExit("Build this package on an Intel or Apple Silicon Mac.")
    binary = ROOT / "target/release/mare-browser"
    if not binary.is_file():
        raise SystemExit("Run cargo build --release --locked first.")
    electron_pin, sunnify_pin, deno_pin = PINS[ARCH]
    with tempfile.TemporaryDirectory(prefix="compass-macos-") as temp:
        stage = Path(temp)
        electron = release_asset(stage, "electron/electron", "v45.4.1",
                                 f"electron-v45.4.1-darwin-{ARCH}.zip", electron_pin)
        run("ditto", "-x", "-k", electron, stage)
        bundle = stage / "Noise Music.app"
        (stage / "Electron.app").rename(bundle)
        contents = bundle / "Contents"
        resources = contents / "Resources"
        app = resources / "app"
        app.mkdir()
        music = app / "components/music"
        music.mkdir(parents=True)
        sunnify = release_asset(stage, SUNNIFY, "v2.6.0",
                                "Sunnify-macOS-Intel.zip" if ARCH == "x64" else "Sunnify-macOS.zip",
                                sunnify_pin)
        run("ditto", "-x", "-k", sunnify, app / "components/sunnify")
        deno = release_asset(stage, "denoland/deno", "v2.9.8",
                             f"deno-{'x86_64' if ARCH == 'x64' else 'aarch64'}-apple-darwin.zip",
                             deno_pin)
        run("ditto", "-x", "-k", deno, music)
        yt_dlp = release_asset(stage, "yt-dlp/yt-dlp", "2026.10.26", "yt-dlp_macos",
                               "0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa")
        shutil.move(yt_dlp, music / "yt-dlp")
        (music / "yt-dlp").chmod(0o755)
        shutil.copy2(binary, app / "noise-worker")
        for name in ("bridge.cjs", "updates.cjs", "preload.cjs"):
            shutil.copy2(ROOT / "linux" / name, app)
        for name in ("host.cjs", "index.html", "renderer.js", "standalone.css", "smoke.cjs"):
            shutil.copy2(ROOT / "macos" / name, app)
        for name in ("icons.js", "spotify.css", "spotify.js", "music-layout.js", "music-queue.js",
                     "music-listening.js", "music-streaming.js", "music-tools.js"):
            shutil.copy2(ROOT / "ui" / name, app)
        for name in ("sortable.js", "devices-ui.js", "music-polish.css"):
            shutil.copy2(ROOT / "mobile/public" / name, app)
        shutil.copy2(MANIFEST, app)
        png = (ROOT / "mobile/public/music-icon-512.png").read_bytes()
        (resources / "noise.icns").write_bytes(
            b"icns" + (len(png) + 16).to_bytes(4, "big") + b"ic09"
            + (len(png) + 8).to_bytes(4, "big") + png
        )
        info = contents / "Info.plist"
        plist = plistlib.loads(info.read_bytes())
        plist.update(CFBundleIdentifier="com.compassbrowser.noise-music",
                     CFBundleName="Noise Music", CFBundleDisplayName="Noise Music",
                     CFBundleShortVersionString=VERSION, CFBundleVersion=VERSION,
                     CFBundleIconFile="noise.icns",
                     NSLocalNetworkUsageDescription="Controle a reprodução do Noise Music pela rede local.")
        info.write_bytes(plistlib.dumps(plist))
        licenses = resources / "licenses"
        licenses.mkdir()
        for name in ("LICENSE", "THIRD_PARTY_LICENSES.txt", "THIRD_PARTY_NOTICES.md"):
            shutil.copy2(ROOT / name, licenses)
        for repo, tag, source, name in [
            (SUNNIFY, "v2.6.0", "LICENSE", "Sunnify-LICENSE"),
            ("yt-dlp/yt-dlp", "2026.10.26", "LICENSE", "yt-dlp-LICENSE"),
            ("yt-dlp/yt-dlp", "2026.10.26", "THIRD_PARTY_LICENSES.txt", "yt-dlp-THIRD-PARTY-LICENSES"),
            ("denoland/deno", "v2.9.8", "LICENSE.md", "deno-LICENSE"),
        ]:
            download(f"https://raw.githubusercontent.com/{repo}/{tag}/{source}", licenses / name)
        for name in ("LICENSE", "LICENSES.chromium.html"):
            shutil.copy2(stage / name, licenses / ("Electron-" + name))
        run("codesign", "--force", "--deep", "--sign", "-", "--preserve-metadata=entitlements", bundle)
        run("codesign", "--verify", "--deep", "--strict", bundle)
        run(app / "components/sunnify/Sunnify.app/Contents/MacOS/Sunnify", "--help")
        run(music / "yt-dlp", "--version")
        run(music / "deno", "--version")
        DIST.mkdir(parents=True, exist_ok=True)
        archive = DIST / f"Noise-Music-{VERSION}-macos-{ARCH}.zip"
        run("ditto", "-c", "-k", "--keepParent", bundle, archive)
        (DIST / f"SHA256SUMS-{ARCH}").write_text(f"{checksum(archive)}  {archive.name}\n")
        print(archive)


if __name__ == "__main__":
    main()
