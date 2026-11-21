#!/usr/bin/env python3
"""Build the Ubuntu 24.04+ amd64 .deb from public, checksum-pinned components."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tomllib
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
VERSION = tomllib.loads((ROOT / "Cargo.toml").read_text())["package"]["version"]
STAGE = DIST / "ubuntu-package"
LIB = STAGE / "usr/lib/compass-browser"
ASSETS = [
    ("electron/electron", "v45.4.1", "electron-v45.4.1-linux-x64.zip", "e1d077c7a087d7e344350ea0c5cd2b7dc5af3d9bf7979474f38e0fc1a560b875", None),
    ("sunnypatell/sunnify-spotify-downloader", "v2.6.0", "Sunnify-Linux", "698bbb531dec0912dbd26583ecbba1715545288573bc3318c2871015af35a50d", "components/sunnify/Sunnify"),
    ("yt-dlp/yt-dlp", "2026.10.26", "yt-dlp_linux", "767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795", "components/music/yt-dlp"),
    ("denoland/deno", "v2.9.8", "deno-x86_64-unknown-linux-gnu.zip", "e890975bc2549807bbcc0b584ffafda72cc7c93349dd99c80483dd784f6c4609", "components/music/deno"),
]

def save(relative, content, mode=0o644):
    path = STAGE / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    path.chmod(mode)

def download(url, destination):
    request = urllib.request.Request(url, headers={"User-Agent": "Compass-Ubuntu-Release"})
    with urllib.request.urlopen(request, timeout=180) as response, destination.open("wb") as target:
        shutil.copyfileobj(response, target)

def main():
    if os.name != "posix" or os.uname().machine != "x86_64":
        raise SystemExit("Build this package on Ubuntu 24.04 amd64.")
    # This directory is generated exclusively by this script, never a user profile.
    if STAGE.exists():
        shutil.rmtree(STAGE)
    LIB.mkdir(parents=True)
    cache = DIST / "linux-components"
    cache.mkdir(exist_ok=True)
    for repo, tag, name, digest, target in ASSETS:
        asset = cache / name
        if not asset.exists():
            download(f"https://github.com/{repo}/releases/download/{tag}/{name}", asset)
        if hashlib.sha256(asset.read_bytes()).hexdigest() != digest:
            raise SystemExit(f"Checksum mismatch for {name}")
        if target is None:
            with zipfile.ZipFile(asset) as archive:
                archive.extractall(LIB)
            (LIB / "electron").rename(LIB / "compass-browser")
        else:
            executable = LIB / target
            executable.parent.mkdir(parents=True, exist_ok=True)
            if name.endswith(".zip"):
                with zipfile.ZipFile(asset) as archive:
                    executable.write_bytes(archive.read("deno"))
            else:
                shutil.copyfile(asset, executable)
            executable.chmod(0o755)
    for name in ["compass-browser", "chrome_crashpad_handler", "chrome-sandbox"]:
        (LIB / name).chmod(0o755)
    (LIB / "chrome-sandbox").chmod(0o4755)
    for executable, args in [("components/sunnify/Sunnify", ["--help"]), ("components/music/yt-dlp", ["--version"]), ("components/music/deno", ["--version"])]:
        subprocess.run([str(LIB / executable), *args], check=True, timeout=30, stdout=subprocess.DEVNULL)
    rust = ROOT / "target/release/mare-browser"
    shutil.copyfile(rust, LIB / "noise-worker")
    (LIB / "noise-worker").chmod(0o755)
    # Electron auto-loads resources/app/package.json. Native helpers live beside the app.
    application = LIB / "resources/app"
    application.mkdir(parents=True, exist_ok=True)
    for name in ["host.cjs", "model.cjs", "bridge.cjs", "preload.cjs", "smoke-harness.cjs", "package.json"]:
        shutil.copyfile(ROOT / "linux" / name, application / name)
    # Fixed root is the installation directory, not a runtime or source directory.
    for name in ["noise-worker", "components"]:
        (application / name).symlink_to(Path("../..") / name)
    html = subprocess.check_output([rust, "--dump-interface"], text=True)
    html = html.replace("</head>", "<style>#titlebar{-webkit-app-region:drag}#titlebar button,#titlebar input,#titlebar form{-webkit-app-region:no-drag}</style></head>")
    html = html.replace("Detalhes WebView2", "Detalhes do Chromium")
    (application / "index.html").write_text(html)
    shutil.copyfile(ROOT / "src/reader.js", application / "reader.js")
    protection = (ROOT / "src/protection.rs").read_text()
    candidates = protection.split('pub const COSMETIC_CANDIDATES_SCRIPT: &str = r#"', 1)[1].split('"#;', 1)[0]
    (application / "cosmetic-candidates.js").write_text(candidates)
    # PNG produced from the existing 256px source icon, with no redesign or external assets.
    import struct
    import zlib
    rgba = (ROOT / "assets/compass-256.rgba").read_bytes()
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 256, 256, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"".join(b"\0" + rgba[y*1024:(y+1)*1024] for y in range(256)))) + chunk(b"IEND", b"")
    (application / "compass.png").write_bytes(png)
    icon = STAGE / "usr/share/icons/hicolor/256x256/apps/compass-browser.png"
    icon.parent.mkdir(parents=True, exist_ok=True)
    icon.write_bytes(png)
    license_dir = STAGE / "usr/share/doc/compass-browser"
    license_dir.mkdir(parents=True, exist_ok=True)
    for source, name in [("LICENSE", "copyright"), ("linux/README.md", "README.md"), ("linux/RELEASE.md", "RELEASE.md")]:
        shutil.copyfile(ROOT / source, license_dir / name)
    for repo, tag, filename, target in [
        ("sunnypatell/sunnify-spotify-downloader", "v2.6.0", "LICENSE", "Sunnify-LICENSE"),
        ("yt-dlp/yt-dlp", "2026.10.26", "LICENSE", "yt-dlp-LICENSE"),
        ("yt-dlp/yt-dlp", "2026.10.26", "THIRD_PARTY_LICENSES.txt", "yt-dlp-THIRD-PARTY-LICENSES"),
        ("denoland/deno", "v2.9.8", "LICENSE.md", "deno-LICENSE"),
    ]:
        download(f"https://raw.githubusercontent.com/{repo}/{tag}/{filename}", license_dir / target)
    for source in ["adblock-MPL-2.0.txt", "CC-BY-SA-3.0.txt", "README.md", "provenance.json"]:
        shutil.copyfile(ROOT / "assets/filters" / source, license_dir / ("filters-" + source))
    save("DEBIAN/control", f"""Package: compass-browser
Version: {VERSION}-1
Architecture: amd64
Maintainer: Compass Browser <opensource@compass.invalid>
Depends: libc6 (>= 2.39), libasound2t64, libatk-bridge2.0-0t64, libatk1.0-0t64, libatspi2.0-0t64, libcairo2, libcups2t64, libdbus-1-3, libdrm2, libexpat1, libgbm1, libglib2.0-0t64, libgtk-3-0t64, libnspr4, libnss3, libpango-1.0-0, libsecret-tools, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2, xdg-utils, ca-certificates, ffmpeg
Recommends: gnome-keyring
Section: web
Priority: optional
Homepage: https://github.com/tavimxlseven/mare-browser
Description: Compass Browser with Noise Music (Ubuntu preview)
 Chromium browser with isolated per-user profiles and native Rust music apps.
 For Ubuntu 24.04 or newer on Intel/AMD 64-bit PCs.
""")
    save("usr/bin/compass-browser", '#!/bin/sh\nexec /usr/lib/compass-browser/compass-browser "$@"\n', 0o755)
    save("usr/share/applications/compass-browser.desktop", """[Desktop Entry]
Name=Compass Browser
GenericName=Web Browser
Comment=Browse the web and listen with Noise Music
Exec=compass-browser %U
Terminal=false
Type=Application
Icon=compass-browser
Categories=Network;WebBrowser;
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
StartupNotify=true
StartupWMClass=compass-browser
""")
    # Ubuntu restricts unprivileged user namespaces. Allow the packaged sandbox,
    # rather than disabling Chromium sandboxing or changing global kernel settings.
    save("etc/apparmor.d/compass-browser", """abi <abi/4.0>,
include <tunables/global>
profile compass-browser /usr/lib/compass-browser/compass-browser flags=(unconfined) {
  userns,
}
""")
    save("DEBIAN/postinst", """#!/bin/sh
set -e
chown root:root /usr/lib/compass-browser/chrome-sandbox
chmod 4755 /usr/lib/compass-browser/chrome-sandbox
if command -v apparmor_parser >/dev/null 2>&1 && [ -d /sys/kernel/security/apparmor ]; then
  apparmor_parser -r /etc/apparmor.d/compass-browser || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q || true; fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true; fi
""", 0o755)
    save("DEBIAN/postrm", """#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q || true; fi
""", 0o755)
    package = DIST / f"compass-browser_{VERSION}-1_amd64.deb"
    subprocess.run(["dpkg-deb", "--root-owner-group", "--build", str(STAGE), str(package)], check=True)
    digest = hashlib.sha256(package.read_bytes()).hexdigest()
    (DIST / "SHA256SUMS").write_text(f"{digest}  {package.name}\n")
    print(json.dumps({"package": package.name, "sha256": digest}))

if __name__ == "__main__":
    main()
