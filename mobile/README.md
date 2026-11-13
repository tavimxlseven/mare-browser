# Noise Music mobile

Private, invitation-only music PWA focused on iPhone. Android users can use the [native playback APK](../android/README.md). The PWA remains available as a fallback. This is the mobile companion service. The Windows browser uses its existing implementation.

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
- Verified duration metadata is cached from imports and successful preparation, avoiding an extra metadata CLI invocation for each imported track. At most two workers claim distinct tracks in SQLite transactions and prefetch searches; a semaphore limits expensive extraction to one at a time on small VMs. Completed extraction information is kept in a private temporary file so network transfers can overlap without two simultaneous JavaScript extractors. Extractor caches use a private persistent directory. Authentication or source-rate refusals preserve and pause queued work.
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
- Each launch opens the library home independently of the saved playback queue and position. Track changes reuse the audio element without an explicit pause; online playback does not wait for IndexedDB and the next offline file is warmed in a bounded, account-scoped cache. Lock-screen progress is updated through Media Session. The PWA cannot assign itself Android process priority or continue after the browser is force-stopped. Background transitions still require verification on the target phone/browser.
- Invitation-only registration, hashed passwords, administrator-only single-use invitations valid for seven days, revocation, expiring sessions, login throttling and same-origin mutations. Only invitation hashes are stored.
- Playlists, favorites, library membership, preparation jobs and audio access are scoped to the authenticated account. Public song metadata and completed audio files may be reused internally between accounts. Removing a song from one library preserves other users’ copies.
- Browser storage uses a separate IndexedDB database for each account. Offline audio remains local to each device. Signing out clears that account’s local data.
- Per-track artwork is resolved through Spotify oEmbed, cached in the metadata database and gradually backfilled for previously imported songs.
- The full-screen player uses the current artwork as its backdrop, supports favorites, upcoming queue ordering, per-device playback history and offline library search.
- Optional account pairing synchronizes playlist metadata, order, favorites and library membership with the Windows app. Search and audio download on Windows remain local; newly added PC tracks/playlists also request server preparation. Existing audio files are retained. Offline audio stays on each device; playback and volume behavior remain subject to iOS controls.
- Song options include Play next (promotes an existing upcoming occurrence without duplication), append to queue and a searchable playlist chooser. Imported and created playlists are editable copies in Noise Music, independent of Spotify. Per-account manual additions survive reimporting the original source.
- Saving a search result or adding it to a playlist persists metadata without starting audio preparation. Download/preparation remains an explicit action; queueing an unavailable song requests preparation.
- Confirmations and preference pickers use app-owned dialogs. Cancellation, Escape and Android Back resolve a confirmation without performing the action. System installation and operating-system permissions still use the platform's required prompts.

## Verification

Administrators can open `/admin` in a desktop browser without installing the PWA. It uses the same authenticated session and administrator-only invite endpoints; the install requirement continues to apply to the normal app entry.

Run `python -m unittest discover -s tests` from this directory. Tests use a temporary database and mock provider responses, never production data or a user's library.

From the repository root, run `node scripts/music-background-check.cjs` to verify online/offline track handoffs, absence of an explicit transition pause and cancellation of superseded playback requests.

## Upgrading the shared-library version

Back up the persistent data directory before starting the new server. The migration assigns the old shared library, playlists, favorites and jobs to the administrator account. The previous password becomes that administrator's password. Legacy shared sessions are revoked so each person must sign in individually. New accounts start with an empty library.

As administrator, open **Settings → Invitations → Generate invitation**, copy the code shown once and share it privately. Your friend chooses **Create account**, enters a username, a password of at least ten characters and that code. Each code can create one account and can be revoked before use. The same account can sign in on multiple phones and access its own server library. Offline downloads and playback history stay on each phone.

Credentials, invitation codes, account records, cookies, host addresses, database backups and deployment environment files belong outside the source checkout. Publish only generic source and test fixtures.

## Connect Windows and mobile

On the phone, sign into the intended account and open **Settings → PC and mobile → Connect a PC**. In the Windows music app, open **Music settings → Connections → PC and mobile**, enter your own server HTTPS address and the eight-character code. The code expires after five minutes and can be claimed once. Pairing does not require a Spotify account or an application ID.

The Windows session is protected with Windows DPAPI. Device credentials can synchronize music and control that account's devices, but cannot manage invitations or accounts. Disconnecting the PC revokes its credential. No server address or credential is included in the public source.

Both apps must be open and online to receive playback controls or a handoff. The device list shows current playback; choose **Continue here** or **Listen on this device** to transfer the current track, position and upcoming queue. The target prepares missing audio through its own pipeline. An installed PWA cannot be remotely awakened when the operating system suspends it. Volume buttons are shown for native PC targets; phone volume remains under system control. The existing Wi-Fi-only remote panel remains available separately.

Playlist drag handles support pointer/touch and Arrow Up/Down/Home/End. The server validates complete account-owned permutations and preserves manual order through reimports. A stale list is refreshed rather than silently dropping tracks.


Na versão 0.4.1, o PC também pode entrar diretamente com o usuário e senha da mesma conta do celular, em **Ajustes de música → Conexões**. Use o endereço HTTPS da sua instalação. O código temporário continua disponível por compatibilidade, mas não é necessário para o login direto. A senha não é persistida; somente a credencial revogável do dispositivo é protegida pelo DPAPI. Segurar uma faixa e arrastar muda sua posição; segurar e soltar abre as opções.

## Noise Music: compatible rename and Spotify refresh

The product names are now Compass Browser and Noise Music. Existing executable names, profile directories, APK application ID, server paths, environment variables and account/device storage keys remain compatible so an upgrade retains accounts, sessions, history, libraries and downloaded media. The service worker cleans only obsolete shell caches, never offline audio or IndexedDB account data.

Public Spotify playlists refresh from Spotify to Noise every 30 minutes while the server is running. Open a playlist's editor to disable automatic refresh or request a refresh now. Changes are read-only: custom Noise names/covers and manual additions/order remain intact, and removed Spotify tracks remain in the user's general library. Existing downloaded files are reused. A failed refresh retains the previous copy and waits for the next interval; it does not flood the activity island. Private Spotify playlists and writing back to Spotify require a separate official authorization flow and are not enabled here.

Activity cards with finished/errors expire even if another track has paused the source. Redundant cards are archived and any visible card can be dismissed without canceling preparation. Dismissing a paused notice dismisses the paused notices together. Explicitly requesting preparation can reactivate its card.

Administrators can replace a Netscape YouTube cookies file from **Settings → Audio source**. The authenticated same-origin endpoint validates the file, atomically replaces it with private permissions outside the checkout and retries the blocked track. Ordinary accounts and device bearer tokens cannot read or replace it. The API never returns cookies, account secrets or paths. Cookie expiry timestamps are only a local check: YouTube may invalidate a session before that date or refuse the server network. yt-dlp does not support automatically renewing YouTube OAuth login. Never publish the exported file.

## Source maintenance panel

An optional isolated Chrome session can refresh the source cookie file on demand. Authentication failures queue one maintenance attempt; repeated failures within ten minutes request manual reconnection instead of looping. HTTP 429 responses wait ten minutes without repeatedly opening Chrome. Manual refresh requests are deduplicated and throttled. A copied session is reported as confirmed only after an audio preparation actually succeeds. Existing valid files and queued music are retained when refresh fails.

Install Google Chrome stable, Xvfb and Python venv support, then run `sudo sh mobile/deploy/install-source-browser.sh /srv/mare-music/app` with the deployed source directory. The helper creates a separate `noise-source` account, a private persistent browser profile, a Unix control socket and the `noise-source-browser` service. The application account receives only access to that control socket. No browser-debugging TCP port is exposed publicly. Chrome's normal sandbox remains enabled. The helper disables password saving, Chrome account sync and browser extensions through managed policy. Budget extra memory or swap on small VMs; browser processes run on demand and interactive sessions expire after ten minutes.

As administrator, open **Settings → Audio source → Connect Google**. Start the connection, interact with Google's page in the private remote viewport, and click **Finish connection** after returning to YouTube. The optional masked typing field relays text to the selected remote field and immediately clears its value. Input travels over the authenticated same-origin HTTPS API and private Unix bridge; the app never persists or logs typed text. Use a dedicated Google account. Account passwords, multifactor prompts and human verification are handled by the administrator; these are never automated. Avoid request-body logging at any proxy.

Browser frames are account-session-bound and served with no-store headers. Other accounts and desktop bearer credentials cannot view frames, send input or start maintenance. Cookies pass only between the isolated helper and the server, are filtered to Google/YouTube domains, and are never sent to the panel. The session/profile, cookie file, socket, SQLite database and any diagnostics remain outside the source checkout and public assets. A source refusal can persist even after reconnecting; maintenance cannot guarantee that YouTube will accept the server network.

Google can reject the remote browser with “This browser or app may not be secure.” Report this with **Google refused** on the connection page; it closes the current window and switches maintenance to manual file import without repeating login attempts. That same page accepts a Netscape cookies file exported from a supported browser on the administrator's own computer. Imported files remain manual: the server cannot renew that separate computer's session through an empty VPS browser profile. A successful import retries the blocked track but does not guarantee that YouTube accepts the VPS network. No browser-identity spoofing or changes to Google account protections are used.
