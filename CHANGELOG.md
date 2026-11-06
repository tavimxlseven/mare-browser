# Changelog

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
