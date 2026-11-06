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
- Next: versioned SDK, capability declarations, package signing, update verification and app-specific resource accounting.
- Before third-party distribution: isolation model, permissions UX, package review and recovery from failed updates.

## Spotify and Discord

The goal is independent Rust clients integrated into Maré as app tabs. No Spotify or Discord client is shipped at this stage. Spotify and Discord in the catalog are proposals, without an install action.

The first integration decision is whether to control an existing Spotify Connect device or play audio locally. The official [Web API](https://developer.spotify.com/documentation/web-api) provides metadata and playback control; the [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk) is a JavaScript playback library, not a Rust audio SDK.

An implementation needs a registered developer application, an OAuth flow and a playback approach supported by Spotify. Account requirements, quotas, [developer policy](https://developer.spotify.com/policy) and supported platforms must be checked before implementation. No credentials are included in Maré.

Resource comparisons must measure the complete process tree with the same workload, including the browser engine and audio components. A Rust backend alone does not establish lower total memory use.

A Discord client needs its own assessment of documented authorization, API access, voice/video support and supported client behavior. A WebView shortcut to the website is not treated as an implemented Rust port.
