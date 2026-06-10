# Spotify Undocumented Internal API

Findings from reverse-engineering the Spotify Web Player (`open.spotify.com`) during hearted. extension development.

> **Last verified**: 2026-02-26 against the live web player.

---

## Token Types

Spotify uses **two distinct token scopes**:

| Token | Source | Works With |
|-------|--------|------------|
| **Public OAuth** | `accounts.spotify.com/api/token` | `api.spotify.com/v1/*` (public REST API) |
| **Internal client** | Intercepted from web player fetch calls | `api-partner.spotify.com/pathfinder/*`, `spclient.wg.spotify.com/*` |

The web player uses an **internal client token** that is NOT a standard OAuth token. It cannot be used against public REST API endpoints (`api.spotify.com`) — those return 429 immediately. Conversely, public OAuth tokens don't work against internal endpoints.

### Token Interception

The `/get_access_token` endpoint that older tools relied on now returns **403** (Varnish/WAF error 54113). The only reliable way to obtain the internal token is to intercept it from the web player's own outgoing `fetch()` calls by monkey-patching `window.fetch` in a MAIN-world content script.

The token appears in the `Authorization: Bearer <token>` header on requests to `*.spotify.com` domains. It expires after ~3600s (the web player refreshes it transparently).

---

## Pathfinder GraphQL API

**Endpoint**: `POST https://api-partner.spotify.com/pathfinder/v2/query`

Spotify's internal GraphQL API uses **persisted queries** — pre-registered queries identified by a sha256 hash rather than sending the full GraphQL query string.

### Request Format

```json
{
  "variables": { ... },
  "operationName": "operationNameHere",
  "extensions": {
    "persistedQuery": {
      "version": 1,
      "sha256Hash": "<64-char hex hash>"
    }
  }
}
```

**Headers**:
```
Authorization: Bearer <internal-token>
Content-Type: application/json
```

### Rate Limiting

Pathfinder is significantly more generous than the public REST API. During testing, 15 sequential requests with 200ms delays completed in ~3s with zero rate limits. When rate-limited, the response includes a `Retry-After` header (seconds).

---

## Discovered Operations

### `fetchLibraryTracks`

Returns the user's liked (hearted) songs with full metadata.

- **Hash**: `087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240`
- **Variables**: `{ offset: number, limit: number }` (max limit observed: 50)

**Response structure**:
```
data.me.library.tracks
├── totalCount: number
├── pagingInfo: { offset, limit }
└── items[]
    ├── addedAt.isoString: string (ISO 8601)
    └── track
        ├── _uri: string ("spotify:track:<id>")
        └── data
            ├── name: string
            ├── uri: string
            ├── duration.totalMilliseconds: number
            ├── contentRating.label: string
            ├── discNumber: number
            ├── trackNumber: number
            ├── playability.playable: boolean
            ├── artists.items[].uri: string
            ├── artists.items[].profile.name: string
            └── albumOfTrack
                ├── uri: string
                ├── name: string
                ├── coverArt.sources[].url: string
                └── coverArt.sources[].width/height: number
```

### `libraryV3`

Returns the user's library structure (playlists, folders, collections) — NOT individual tracks.

- **Hash**: `9f4da031f81274d572cfedaf6fc57a737c84b43d572952200b2c36aaa8fec1c6`
- **Variables**: `{ offset, limit, filters[] }` and more

Returns items typed as `PseudoPlaylist` with `_uri`, `name`, `count`, `image` etc. The "Liked Songs" entry appears as a PseudoPlaylist with `_uri: "spotify:collection:tracks"` and the total liked song count.

### Other Operations Observed

These were logged from the web player during normal browsing (hashes may rotate with deployments):

| Operation | Purpose |
|-----------|---------|
| `fetchExtractedColors` | Album art dominant colors for UI theming |
| `queryArtistOverview` | Artist page data |
| `searchDesktop` | Search results |
| `getAlbum` | Album tracks and metadata |
| `queryTrackArtists` | Track credit details |

---

## Discovering New Operations

The extension includes a pathfinder request logger in `intercept-token.ts`. While browsing Spotify, all pathfinder requests are captured to `window.__pfLog`:

```js
// In the Spotify tab's console:
__pfLog
// → [{ op: "fetchLibraryTracks", hash: "087278...", vars: "{\"offset\":0,\"limit\":50}" }, ...]
```

This is useful for discovering new operation names and their corresponding hashes when Spotify's web player makes requests during normal use.

---

## CSP Constraints

Spotify's Content Security Policy blocks inline `<script>` injection:

```
script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' ...
```

This means you **cannot** inject JavaScript via `script.textContent = "..."` from a content script. The workaround is Chrome MV3's `"world": "MAIN"` directive in the manifest, which runs the content script file directly in the page's JS context (bypassing CSP since it's loaded as a file, not inline).

---

## Stability Notes

- **Hashes may change** when Spotify deploys new versions of their web player. If fetches start returning errors, re-capture hashes using the pathfinder logger.
- The pathfinder API has been stable in structure for years (persisted query format, endpoint URL), but individual operation hashes are tied to specific query shapes.
- Token lifetime is ~3600s. The web player auto-refreshes; the extension should re-intercept the refreshed token.
