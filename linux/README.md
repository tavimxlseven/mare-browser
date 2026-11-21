# Compass Browser for Ubuntu

First Linux preview, for Ubuntu **24.04 or newer, amd64 (Intel/AMD 64-bit)**.

Download the `.deb` from the Ubuntu release and install it with:

```sh
sudo apt install ./compass-browser_0.6.4-1_amd64.deb
```

Open **Compass Browser** from the application menu, or run `compass-browser`.
The package includes Chromium and the native Noise Music Rust workers. Apt installs
system dependencies, including FFmpeg and the Secret Service tools. No WebView2,
Windows installation, disk D:, Node.js or Rust installation is needed by the user.

## Profiles and accounts

Browser history, bookmarks, settings, cookies and site logins belong to the current
Linux user, under `$XDG_CONFIG_HOME/compass-browser` (normally
`~/.config/compass-browser`). No profile is bundled or automatically copied from
other disks. The application directory is read-only and contains no account data.
Private tabs use separate in-memory Chromium sessions; their history, tabs and
download records are excluded from the saved profile. Downloaded files remain
where the user explicitly saved them.

Noise uses the existing account, library, playlists, playback queue, local audio,
streaming and listening-room backend. Log into the same Noise server/account to
access the phone library. Offline files remain local to this PC. Protected account
tokens use AES-GCM with a random key in the current user's Secret Service keyring.
Unlock the Ubuntu keyring if prompted; there is no plaintext token fallback.
Site passwords/cookies are managed separately by Chromium and the OS keyring.

## Current preview limitations

- Chrome Web Store extensions and Windows WebView2 integrations are not available.
- Updates are installed by downloading a newer `.deb`; the Windows automatic
  installer is never launched on Linux. Opening the update screen shows Ubuntu releases.
- The optional LAN pairing server is unavailable; account-based Noise device
  control is retained.
- Proprietary DRM/Widevine content is not bundled. This does not provide a Spotify
  Premium streaming client or circumvent site authentication.
- The first verified environment is Ubuntu 24.04 on X11/Xvfb. Native Wayland,
  Bluetooth device switching and real hardware audio still need user validation.

Chromium renderers run sandboxed, with context isolation and no Node.js or native
IPC in web pages. Only the local Compass interface has the allowlisted command
bridge. The package includes an application-scoped AppArmor rule for Ubuntu user
namespaces and the Chromium sandbox helper; it never disables system sandboxing.
Network filtering uses the same adblock-rust engine and EasyList/EasyPrivacy data.

## Building and testing

On a clean Ubuntu 24.04 amd64 machine:

```sh
sudo apt install build-essential pkg-config libasound2-dev libsecret-tools
cargo test --locked
cargo build --release --locked
python3 linux/package.py
sudo apt install ./dist/compass-browser_*_amd64.deb
dbus-run-session -- xvfb-run -a python3 linux/smoke.py
```

The packaging script downloads fixed, SHA-256-verified public releases of Electron,
Sunnify, yt-dlp and Deno. It builds only from repository source, never a development
profile. GitHub Actions tests the real installed package and publishes Ubuntu tags
separately from Windows. Ubuntu prereleases do not replace the latest Windows release.
