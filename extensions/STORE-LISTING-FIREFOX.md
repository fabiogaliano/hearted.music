# Firefox Add-ons (AMO) listing

User-facing copy is identical to the Chrome Web Store listing
(`STORE-LISTING.md`); only the back-office fields differ to match AMO's form
(Summary/Description, manifest-driven data-collection consent, reviewer notes).
Build/source-submission mechanics live in `AMO-SUBMISSION.md`.

## Add-on name
everything you ever hearted.

## Summary
reads your library from Spotify. sends them to hearted. nothing else.

## Description

everything you ever hearted.

a small bridge between Spotify and your hearted. account.

───

how it works

open Spotify in your browser. the extension reads the songs
you've liked and your playlists, then sends them to hearted.
from hearted, you can also manage your Spotify playlists.

that's it. no setup. no configuration.

───

what it can see
  · your liked songs
  · your playlists

what it can't see
  · your password or login
  · your payment details
  · your private messages

───

your data goes to your hearted. account. nowhere else.
not sold. not shared. not stored beyond what's needed to sync.

───

requires a hearted. account at hearted.music
free to start.

---

## Single-purpose statement
Syncs the signed-in user's Spotify library (liked songs and playlists) to
their hearted. account, and relays playlist management actions from hearted
back to Spotify.

## Data collection (matches manifest `data_collection_permissions`)
Firefox shows the user a built-in consent screen generated from the manifest.
The declared categories and what they mean:

**authenticationInfo**
The extension captures the signed-in user's own Spotify access token from
their authenticated session on open.spotify.com, used solely to read and
manage their library via Spotify's own API.

**websiteContent**
The user's liked songs and playlists are transmitted to their own hearted.
account. Nothing else is collected; not sold, not shared.

## Permission justifications

**cookies**
Detects whether the user is logged into Spotify by checking for the
presence of a session cookie on open.spotify.com. The cookie value is
never read or transmitted.

**storage**
Stores the Spotify access token, the hearted. API token, and the last sync timestamp.

**scripting**
Re-injects content scripts into already-open Spotify tabs when the
extension is installed or updated, so token interception resumes without
requiring the user to manually refresh the page.

**host_permissions: *.spotify.com**
Reads the user's liked songs, playlists, and playlist tracks from the
Spotify web player. Also carries playlist management actions (create,
rename, add/remove tracks, delete) initiated by the user in hearted back
to Spotify via the same authenticated session.

**host_permissions: hearted.music**
Transmits the user's Spotify library to their own hearted. account via an
authenticated API endpoint, and receives playlist management commands
issued by the user in hearted. On Firefox a content script is injected on
this origin (the page⇄extension bridge) because Firefox does not implement
`externally_connectable`; it relays the same commands Chrome sends directly.

**host_permissions: localhost / 127.0.0.1**
Used during local development to connect the extension to a locally-running
instance of the hearted. backend. Not active in normal use. (Stripped from
store builds via `ext:store:firefox`.)

## Notes to reviewer
The extension's content script runs in MAIN world to observe the Spotify
web player's own internal fetch() calls. This is necessary because
Spotify does not expose a public API for reading a user's full liked-songs
library. The script reads one token field from outgoing requests, used to
authenticate calls that fetch and manage the user's saved tracks and
playlists. No credentials, payment data, or private information are
accessed. The token is used solely to make calls to Spotify's own API
endpoints on behalf of the signed-in user, and to transmit library data
to the user's own authenticated hearted. account.

Using Spotify's private/Pathfinder API with the user's own session is
disclosed here deliberately (policy §6.1 / §6.2.2.1 — "no surprises"); the
add-on is single-purpose and its data use is self-evident from the name and
description. Reproducible build instructions and the source-submission
package are in `AMO-SUBMISSION.md`.
