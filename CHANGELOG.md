# Changelog

## 0.3.6 — 2026-11-07

- Redesign the music library with a top player, softer panels, adjustable artwork and light/dark themes.
- Organize music settings into appearance, backgrounds, playback, connections and downloads.
- Add private local wallpaper import, built-in backgrounds, fit controls and panel opacity.
- Persist playback volume, paused position, playlist context and queue order across worker restarts without autoplay.
- Coalesce volume gestures, add mute restoration and use a finer low-volume gain curve.
- Rename the app catalog to Apps and present its real entries in an App Store-inspired shelf.

## 0.3.5 — 2026-11-06

- Integrate the music workspace redesign while keeping library, queue, download and native playback contracts.
- Search Spotify track metadata through XWolf without account credentials; preserve canonical artist/title/artwork through local playback and Rich Presence.
- Add opt-in Wi-Fi playback control with expiring pairing codes, session revocation, request limits and a restricted command set.
- Keep remote control disabled on startup and stop its listener when the music app closes.
- Isolate music CSS from browser controls and preserve compact mode and panel resizing.

## 0.3.4 — 2026-11-06

- Preserve memberships in existing local playlists when adding a track to another playlist after upgrading from the legacy library format.

## 0.3.3 — 2026-11-06

- Search music and artists inside the app without a Spotify account; show public YouTube results and add or download a selected recording.
- Add complete playback queues, shuffle without replacement, repeat modes, drag reordering and a sleep timer.
- Resize library/queue panels, persist appearance preferences and expose track context menus and editable local playlists.
- Replace the larperCord adapter with the official Discord web client in a persistent browser tab; request device permissions explicitly.
- Include original yt-dlp and Deno helpers in the installer and link the Windows C++ runtime statically.
- Keep Spotify account login deferred. Rich Presence continues to use the shared application ID and the desktop Discord IPC connection.

## 0.3.2 — 2026-11-06

- Install compatible Manifest V3 extensions from Chrome Web Store URLs, verify CRX3 publisher/developer signatures and review permissions before installation.
- Preserve active media across tab switches, delay idle-tab suspension and coalesce profile writes outside the UI thread.
- Add a performance button beside Shield and persistent extension management.
- Delete downloaded music safely while retaining playlist metadata; refresh per-track artwork and refine the music workspace.
- Correct Windows profile paths used by embedded Discord login persistence.
- Document upgrade/login persistence and shared Discord application IDs. Defer Spotify account login in this release.

- Add a Windows installer with runtime detection, Microsoft WebView2 setup and shortcuts.
- Ask for a download destination, retain original names, and expose byte progress, errors and transfer controls.
- Replace MCI playback with native Rust decoding, a dedicated WASAPI thread and multimedia scheduling.
- Add real playlist track pages, a standalone-music collection and compact download activity with completed-file availability.
- Add artist status display and cover assets to Discord activity.
- Refine native window composition, taskbar resources and website icons.
- Add YouTube-specific response filtering with per-site/global Shield controls.

## 0.3.1 — 2026-11-06

- Explicitly resize chrome and content controllers after child WebView destruction and while layout events are pending.
- Keep the selected web document visible under native app tabs so media continues playing.
- Add an on-demand process monitor for host, WebView2, app workers and their helper processes, with private RAM, committed memory and CPU.
- Unify downloaded music and Spotify links, prevent repeated downloads, and start requested playback only after the downloader exits and files are indexed.
- Smooth the playback timeline, reuse real cover art, remove app implementation bars and add icon launch transitions.
- Register the Maré Discord Application ID and correct cleared-activity status reporting.
- Launch larperCord hidden, restrict demo mode to debug QA profiles, ignore inherited QA/token variables, and allow time for graceful profile shutdown.

## 0.3.0 — 2026-11-06

- Start the independent Spotify library app with a Rust worker, public link metadata, local favorites and collections.
- Add native Windows local audio playback, queue/transport controls and the headless Sunnify CLI download adapter.
- Add optional read-only Spotify PKCE account import and local Discord Rich Presence; real-account validation awaits application registration.
- Host the original larperCord native window in its own app tab, with an isolated profile and explicit process shutdown.
- Keep the native web page visible behind toolbar popups instead of revealing a loading placeholder.
- Add dedicated Spotify/Discord app icons and a music workspace based on the desktop Spotify layout.
- Add tab selection motion and refine interactive feedback with reduced-motion support.

## 0.2.0 — 2026-11-05

- Add native content blocking with the Brave Rust engine and bundled filter lists.
- Add per-site protection controls and request counters.
- Add the curated app catalog, on-demand Rust workers, Notes and Calculator.
- Keep apps alive in their own tabs when switching between apps and websites.
- Request suspension of background browser tabs while preserving their documents.
- Refine browser controls, custom selection lists, transitions and scrollbars.
- Restructure project documentation and contribution templates.

## 0.1.0 — 2026-11-05

- Initial Windows release with native web navigation, tabs, sessions, bookmarks, history, private tabs, downloads and reader mode.
