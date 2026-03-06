# Chrome Web Store listing

## Extension name
everything you ever hearted.

## Short description
reads your library from Spotify. sends them to hearted. nothing else.

## Full description

everything you ever hearted.

a small bridge between Spotify and your hearted. account.

───

how it works

open Spotify in your browser. the extension reads the songs
you've liked and your playlists, then sends them to hearted.

that's it. no setup. no configuration. one button.

───

what it can see
  · your liked songs
  · your playlists

what it can't see
  · your password or login
  · your payment details
  · your private messages
  · anything outside your saved library

───

your data goes to your hearted. account. nowhere else.
not sold. not shared. not stored beyond what's needed to sync.

───

requires a hearted. account at hearted.app
free to start.

---

## Developer Dashboard: single-purpose statement
Reads the signed-in user's saved Spotify tracks and playlists from the
Spotify web player and syncs them to the user's own hearted. account.

## Developer Dashboard: permission justifications

**cookies**
Detects whether the user is logged into Spotify by checking for the
presence of a session cookie on open.spotify.com. The cookie value is
never read or transmitted. Used only to determine UI state (logged in
vs. not logged in).

**storage**
Stores the user's last sync timestamp, sync status, and hearted.
authentication token locally. No Spotify data is persisted in storage.

**host_permissions: *.spotify.com**
Reads saved track metadata and playlists from the Spotify web player.
The extension never writes to Spotify, never modifies the user's
library, and never accesses authentication credentials.

**host_permissions: hearted.app**
Transmits the user's liked song data to their own hearted. account via
an authenticated API endpoint.

## Reviewer notes (if flagged for world: MAIN content script)
The extension's content script runs in MAIN world to observe the Spotify
web player's own internal fetch() calls. This is necessary because
Spotify does not expose a public API for reading a user's full liked-songs
library. The script reads one token field from outgoing requests, used to
make read-only calls to fetch the user's saved tracks. No credentials,
payment data, or private information are accessed. The token is not stored
persistently and is not transmitted to any party other than Spotify's own
API endpoints and the user's authenticated hearted. account.
