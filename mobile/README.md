# Maré Música mobile

Private, invitation-only music PWA for Android and iPhone. This is the mobile companion service. The Windows browser uses its existing implementation.

On iPhone, install through Safari's **Share → Add to Home Screen**. On Android, use Chrome's **Install app** or **Add to Home screen**, then open its icon. The browser landing page requires Home Screen installation before showing the player. Authentication protects the API independently of this installation screen.

## Runtime

Python 3.12+, requirements.txt, SQLite, an unmodified Sunnify CLI and FFmpeg. Run a single server process behind an HTTPS reverse proxy. A background worker serializes preparation, persists the queue in SQLite and retries interrupted preparations when the service restarts. Finished media supports HTTP byte ranges for streaming and seeking. There is no dependency on the desktop browser.

Sunnify by Sunny Patel is separately licensed for unmodified, noncommercial use. Install it from its original source. This project invokes its CLI and does not include its code. Reviewed revision is `0138cbf107395057bac7e33d820a28837cbe8522`. Read [upstream license](https://github.com/sunnypatell/sunnify-spotify-downloader/blob/main/LICENSE) and use permitted audio.

## Configuration

Create a private environment file outside the checkout, readable only by root and the service account.

- `MARE_ORIGIN` is the exact HTTPS origin of the deployment, without a trailing slash.
- `MARE_DATA` is a persistent writable directory outside the application checkout.
- `MARE_PASSWORD_HASH` is the initial administrator password hash, used only when creating that account. Generate it with `werkzeug.security.generate_password_hash`. Existing accounts retain their stored hashes.
- `MARE_ADMIN_USERNAME` optionally sets the first administrator username. The default is `admin`.
- `SUNNIFY_BIN` is the absolute path to the installed Sunnify executable.
- Optional `SUNNIFY_COOKIES_FILE` points to a private Netscape-format YouTube session file. Keep it outside the checkout and public files, readable only by the service account. A supported Node.js 22+ or Deno runtime must be on the service PATH.
- `PORT` defaults to 8787 and binds only to loopback.

Install requirements in a virtual environment and run `python server.py`. The service template assumes `/srv/mare-music/app`, `/srv/mare-music/venv`, and a dedicated `mare-music` account. Configure the reverse proxy to preserve request Origin, forward to 127.0.0.1:8787 and allow at least 100 seconds for public playlist imports. Use a trusted HTTPS certificate. Expose only HTTPS and administration ports.

Never publish environment files, SSH keys, passwords, the SQLite database, session keys or downloaded media. Back up the complete persistent data directory before updates. Keep the same directory and session key through deployment to preserve the library and existing logins.

## Features and current limits

- Spotify metadata search through XWolf, public track/playlist/album link import, private playlists, favorites, library deletion. Imports return a persisted job immediately. Metadata is collected in the worker and imported tracks automatically enter the VPS preparation queue.
- Dynamic Island activity follows the server job across navigation and reopening. Track counts reflect completed files. The expanded view includes the active track, failures and an action to save ready audio to the phone.
- Canonical link normalization and transactional enqueueing deduplicate repeated import taps. Large playlists are prepared by ID without sending all metadata back in one request.
- SQLite stores imports, track state and progress. Interrupted imports restart, incomplete preparation retries, and atomically promoted audio is reconciled after a crash. Work directories are cleaned on startup. Data lives outside the source checkout.
- Audio preparation depends on upstream availability. Datacenter IP addresses may be refused by the source. Preparation failures are shown explicitly, and failed tracks cannot be streamed. A source refusal pauses the persisted queue until the user explicitly retries from Settings. See the [upstream session setup](https://github.com/sunnypatell/sunnify-spotify-downloader/blob/main/docs/CLI.md#youtube-cookies) for authenticated access. A session may expire and authentication does not guarantee that the source accepts the network.
- Prepared tracks stream from the server with range support. Queue, shuffle and repeat run locally.
- Verified duration metadata is cached from imports and successful preparation, avoiding an extra metadata CLI invocation for each imported track. At most two workers claim distinct tracks in SQLite transactions and prefetch searches; a semaphore limits expensive extraction/download to one at a time on small VMs. Extractor caches use a private persistent directory. Authentication or source-rate refusals preserve and pause queued work.
- Japanese song titles need no artificial word boundaries, native subtitle labels and accented titles are recognized, and searches use the primary artist to avoid overlong collaborator queries. Failures expose a safe per-track explanation.
- New Spotify preparations prefer audio/lyric editions and compare song title, artist and duration. When no preferred edition is available, the webapp uses the first compatible result from a plain song search. This fallback can include the audio of a music video, including its introduction. Unrequested covers and alternate editions are rejected. Existing files are retained. Source metadata cannot guarantee an exact recording.
- Completed/failed activities leave the island automatically after about 15 seconds. Settings can clear old finished activities immediately. Archiving activity never removes songs or running tasks; an explicit retry can reactivate the same task. Prepare requests deduplicate across import/prepare jobs, reordered lists and already-ready songs.
- Android Back closes the current sheet or activity panel before unwinding views. A same-origin home entry protects the root screen from accidental exit. Leaving Search clears its field/results, aborts pending requests and rejects stale responses. Physical Android/iOS gesture behavior still needs device verification.
- Playlists can be renamed or deleted without deleting their songs from the library. Shuffle exposes its resulting queue; repeat supports off, playlist and single-track modes. Automatic playback skips songs not yet prepared. Playback context is isolated per account and device.
- Offline audio is committed to IndexedDB only after transfer completes. Pending device saves persist and resume when the PWA returns to the foreground.
- The worker continues on the VM when iOS suspends the app. Saving files onto the phone depends on foreground execution. Safari controls storage quotas and can evict local files.
- Wi-Fi confirmation is the default. iOS exposes no reliable Wi-Fi-only transfer API. The user chooses whether to proceed and may enable mobile data in settings.
- Home Screen shell caches locally. First login, search, imports and new server preparations need internet.
- Media Session and Audio Session APIs are used when available. Playback, lock-screen controls and offline storage must also be verified on a physical iPhone.
- Invitation-only registration, hashed passwords, administrator-only single-use invitations valid for seven days, revocation, expiring sessions, login throttling and same-origin mutations. Only invitation hashes are stored.
- Playlists, favorites, library membership, preparation jobs and audio access are scoped to the authenticated account. Public song metadata and completed audio files may be reused internally between accounts. Removing a song from one library preserves other users’ copies.
- Browser storage uses a separate IndexedDB database for each account. Offline audio remains local to each device. Signing out clears that account’s local data.
- Per-track artwork is resolved through Spotify oEmbed, cached in the metadata database and gradually backfilled for previously imported songs.
- The full-screen player uses the current artwork as its backdrop, supports favorites, upcoming queue ordering, per-device playback history and offline library search.
- This first mobile version has separate library data from the Windows app. Playback and volume behavior are subject to iOS controls.
- Song options include Play next (promotes an existing upcoming occurrence without duplication), append to queue and a searchable playlist chooser. Imported and created playlists are editable copies in Maré, independent of Spotify. Per-account manual additions survive reimporting the original source.
- Saving a search result or adding it to a playlist persists metadata without starting audio preparation. Download/preparation remains an explicit action; queueing an unavailable song requests preparation.
- Confirmations and preference pickers use app-owned dialogs. Cancellation, Escape and Android Back resolve a confirmation without performing the action. System installation and operating-system permissions still use the platform's required prompts.

## Verification

Run `python -m unittest discover -s tests` from this directory. Tests use a temporary database and mock provider responses, never production data or a user's library.

## Upgrading the shared-library version

Back up the persistent data directory before starting the new server. The migration assigns the old shared library, playlists, favorites and jobs to the administrator account. The previous password becomes that administrator's password. Legacy shared sessions are revoked so each person must sign in individually. New accounts start with an empty library.

As administrator, open **Settings → Invitations → Generate invitation**, copy the code shown once and share it privately. Your friend chooses **Create account**, enters a username, a password of at least ten characters and that code. Each code can create one account and can be revoked before use. The same account can sign in on multiple phones and access its own server library. Offline downloads and playback history stay on each phone.

Credentials, invitation codes, account records, cookies, host addresses, database backups and deployment environment files belong outside the source checkout. Publish only generic source and test fixtures.
