# Roadmap

This document describes direction, not a release schedule. Items are marked complete only when implemented and tested.

## Browser

- Current: tabs, sessions, bookmarks, history, private storage, downloads and a textual reader.
- 0.2: custom browser controls, restrained motion, reduced redundant UI updates and background-tab suspension requests.
- Next: tab groups, profile management, import/export and broader compatibility testing.

## Maré Shield

- 0.2: network filtering with Brave's Rust engine, bundled EasyList/EasyPrivacy, per-site exceptions and cosmetic CSS rules.
- Next: signed/reproducible filter updates, additional regional lists and compatibility reporting.
- Separate work: fingerprinting defenses, scriptlets, extension compatibility and a stronger permissions model. These are not implied by request blocking.

## Native apps

- 0.2: curated local catalog, Rust workers started on demand, bounded JSON-lines IPC, Notes and Calculator. App tabs retain their workers in the background until explicitly closed.
- 0.3: Spotify local link library with public metadata, local collections and explicit handoff to the installed client. Short tab-selection and control transitions.
- Next: versioned SDK, capability declarations, package signing, update verification and app-specific resource accounting.
- Before third-party distribution: isolation model, permissions UX, package review and recovery from failed updates.

## Music and Discord

- 0.3: Spotify metadata/library, native Windows local playback, queue/transport controls, on-demand Sunnify CLI integration and explicit cancellation.
- 0.3: optional read-only OAuth PKCE and local Discord Rich Presence implementations. Application registration and validation with real accounts remain outstanding.
- 0.3.3: official Discord web client in a persistent browser tab replaces the earlier larperCord adapter. Camera/microphone prompts are handled by the browser; real-account calls still need manual validation.
- 0.3.3: independent public music search, editable local playlists, complete shuffled queues and adjustable library/queue panels.
- Next: complete authorized account validation, improve metadata/local-file management and measure resource use with comparable workloads.

See [music](SPOTIFY.md) and [component provenance and licensing](COMPONENTS.md). Sunnify matches audio from YouTube rather than downloading Spotify audio streams. Spicetify customizes the official Spotify client. Neither component is described as a Rust port.

Resource comparisons must measure the complete process tree with the same workload, including the browser engine, decoder and any download helpers. A Rust backend alone does not establish lower total memory use.