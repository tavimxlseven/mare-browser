# Streaming and shared listening on Windows

Noise Music can play tracks prepared on your private music server without saving them to the PC's offline library. Sign into the same Noise account used on your phone under **Music settings → Connections**. Your synchronized playlists stay in the library. Press Play to stream; use Download when you want an offline copy.

An existing local download takes precedence. If a requested online track is not prepared yet, Noise asks the server to prepare it and shows a waiting state. Repeated requests reuse the same preparation job. Server source authentication and availability still apply. Streaming requires an internet connection; it does not make the PC an offline client unless you download the track.

## Listen with a friend

Both participants need Compass Browser 0.6.0 or later, separate Noise accounts on the same updated server, and an internet connection.

1. Open **Listen together** in the music toolbar and choose **Create a room**.
2. Copy the invitation code and send it to your friend yourself.
3. Your friend opens **Listen together**, enters the code and joins.
4. The room creator controls tracks, play/pause and seeking. Each listener controls their own volume.
5. Leaving stops the participant's shared playback. Closing the room ends the shared session without stopping the creator's own music.

The player periodically corrects drift. This is coordinated playback on separate devices, rather than a sample-accurate audio broadcast; network buffering and device latency can affect alignment. A disconnected creator pauses the shared session until the connection returns. Invitations expire after 24 hours and rooms support up to eight accounts. The feature currently targets the Windows client.

## Server deployment

Deploy `mobile/listening.py` together with the updated `server.py` and `devices.py`, back up the SQLite database, and restart the service. New room tables are created automatically; existing accounts, playlists and media are preserved. Old clients keep their existing API routes.

The reverse proxy must forward `/stream/` to the application, including Range/If-Range headers, and disable access logging for this path. Use HTTPS. The application returns `private, no-store` for stream responses; the client does not add streamed files to its downloaded index.

Stream URLs carry a signed grant limited to one track, one account and one registered device, expiring after one hour. They do not contain the account's login token or password. Each media request checks that the device still exists and the account owns the track or is a member of the current listening room. Leaving a room or revoking a device prevents further unauthorized media requests. A participant cannot browse the creator's library through the room API.

Do not publish invitation codes, stream URLs, credentials, session files, database backups or deployment configuration. Room invitations are stored as hashes. Media and account tokens remain on the private server or protected user profile.
