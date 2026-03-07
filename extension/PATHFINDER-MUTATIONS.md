# Spotify Internal API Reference — Complete SDK Replacement

> Reverse-engineered from live Spotify Web Player (open.spotify.com).
> First captured 2026-03-06, updated 2026-03-06.
> All payloads captured via fetch interception in Chrome DevTools.

## Purpose

This document maps **every Spotify operation** needed by hearted. to replace the official SDK (`@fostertheweb/spotify-web-sdk`) and App Auth (Client Credentials) with Spotify's internal APIs. Spotify is cutting public API access — these internal endpoints are the migration path.

---

## Architecture: Two Distinct APIs

Spotify's web player uses **two separate API systems**:

| API | Base URL | Protocol | Used For |
|-----|----------|----------|----------|
| **Pathfinder** (GraphQL) | `api-partner.spotify.com/pathfinder/v2/query` | Persisted GraphQL queries | Reads (tracks, playlists, artists, library) + track-level mutations (add/remove) |
| **Playlist v2** (Delta) | `spclient.wg.spotify.com/playlist/v2/` | JSON delta operations | Playlist-level ops (create, delete, update, reorder) |

Both use the **same Bearer token** intercepted from the web player's `Authorization` header.

---

## SDK → Pathfinder Migration Map

| Official SDK Method | Pathfinder Replacement | Status |
|---|---|---|
| `sdk.currentUser.tracks.savedTracks()` | `fetchLibraryTracks` (Pathfinder) | ✅ Implemented in extension |
| `sdk.currentUser.tracks.savedTracks(1,0)` (count only) | First page of `fetchLibraryTracks` → `totalCount` | ✅ Derivable |
| `sdk.playlists.getUsersPlaylists()` | `libraryV3` (Pathfinder) | ✅ Implemented in extension |
| `sdk.playlists.getPlaylistItems()` | `fetchPlaylistContents` (Pathfinder) | ✅ Implemented in extension |
| `sdk.currentUser.profile()` | `profileAttributes` (Pathfinder) | ✅ Implemented in extension |
| `sdk.tracks.get(ids)` (album art) | Already in `fetchLibraryTracks` / `fetchPlaylistContents` response (`albumOfTrack.coverArt.sources`) | ✅ No extra call needed |
| `sdk.artists.get(ids)` (artist images) | `queryArtistOverview` (Pathfinder) | ✅ Captured — see §6 |
| `sdk.playlists.getPlaylist()` (cover image) | Already in `libraryV3` response (`images.items[].sources`) or `fetchPlaylist` | ✅ No extra call needed |
| `sdk.playlists.createPlaylist()` | Playlist v2: create + rootlist ADD | ✅ Captured — see §3 |
| `sdk.playlists.changePlaylistDetails()` | Playlist v2: `UPDATE_LIST_ATTRIBUTES` on `/playlist/{id}/changes` | ✅ Captured — see §5 |
| `sdk.playlists.addItemsToPlaylist()` | `addToPlaylist` (Pathfinder) | ✅ Captured — see §1 |
| `sdk.playlists.removePlaylistItems()` | `removeFromPlaylist` (Pathfinder) | ✅ Captured — see §2 |
| App Auth `GET /v1/artists?ids=` | `queryArtistOverview` (Pathfinder) | ✅ Captured — see §6 |
| App Auth `GET /v1/tracks?ids=` | Not needed — track data comes with library/playlist fetches | ✅ No extra call needed |

**Result: 100% SDK coverage. No official API dependency remains.**

---

## 1. addToPlaylist (Pathfinder)

**Adds one or more tracks to an existing playlist.**

### Request

```
POST https://api-partner.spotify.com/pathfinder/v2/query
Content-Type: application/json
Authorization: Bearer {token}
```

```json
{
  "operationName": "addToPlaylist",
  "variables": {
    "playlistItemUris": [
      "spotify:track:7tFiyTwD0nx5a1eklYtX2J"
    ],
    "playlistUri": "spotify:playlist:7ABBak3CF7imXugNUXHmd4",
    "newPosition": {
      "moveType": "BOTTOM_OF_PLAYLIST",
      "fromUid": null
    }
  },
  "extensions": {
    "persistedQuery": {
      "version": 1,
      "sha256Hash": "47b2a1234b17748d332dd0431534f22450e9ecbb3d5ddcdacbd83368636a0990"
    }
  }
}
```

### Variables

| Field | Type | Description |
|-------|------|-------------|
| `playlistItemUris` | `string[]` | Array of Spotify track/episode URIs to add |
| `playlistUri` | `string` | Target playlist URI |
| `newPosition.moveType` | `string` | `"BOTTOM_OF_PLAYLIST"` or `"TOP_OF_PLAYLIST"` |
| `newPosition.fromUid` | `string \| null` | Insert after this item UID (null = use moveType) |

### Response

```json
{
  "data": {
    "addItemsToPlaylist": {
      "__typename": "AddItemsToPlaylistPayload"
    }
  }
}
```

---

## 2. removeFromPlaylist (Pathfinder)

**Removes tracks from a playlist by their internal UIDs.**

### Request

```json
{
  "operationName": "removeFromPlaylist",
  "variables": {
    "playlistUri": "spotify:playlist:7ABBak3CF7imXugNUXHmd4",
    "uids": [
      "c5ae3d2ed8280180"
    ]
  },
  "extensions": {
    "persistedQuery": {
      "version": 1,
      "sha256Hash": "47b2a1234b17748d332dd0431534f22450e9ecbb3d5ddcdacbd83368636a0990"
    }
  }
}
```

### Variables

| Field | Type | Description |
|-------|------|-------------|
| `playlistUri` | `string` | Target playlist URI |
| `uids` | `string[]` | Internal playlist item UIDs (NOT track URIs!) |

> **IMPORTANT**: UIDs are obtained from `fetchPlaylistContents` response.
> Each item in the playlist has a unique `uid` field (hex string like `c5ae3d2ed8280180`).
> This means you must fetch the playlist contents first to get UIDs before removing.

### Response

```json
{
  "data": {
    "removeItemsFromPlaylist": {
      "__typename": "RemoveItemsFromPlaylistPayload"
    }
  }
}
```

### Shared Hash

Both `addToPlaylist` and `removeFromPlaylist` share the **same SHA256 hash**:
`47b2a1234b17748d332dd0431534f22450e9ecbb3d5ddcdacbd83368636a0990`

Spotify routes to the correct resolver based on `operationName`.

---

## 3. Create Playlist (Playlist v2 API)

**Two-step process: create the playlist, then add it to the user's library.**

### Step 1: Create the playlist

```
POST https://spclient.wg.spotify.com/playlist/v2/playlist
Content-Type: application/json
Authorization: Bearer {token}
```

```json
{
  "ops": [
    {
      "kind": "UPDATE_LIST_ATTRIBUTES",
      "updateListAttributes": {
        "newAttributes": {
          "values": {
            "name": "My New Playlist"
          }
        }
      }
    }
  ]
}
```

#### Response

```json
{
  "uri": "spotify:playlist:6weIESFCoYteXN325kMnCo",
  "revision": "AAAAAdsnIyh6Tw3c1aT2z2jH6BV5+RJo"
}
```

### Step 2: Add to user's rootlist (library)

```
POST https://spclient.wg.spotify.com/playlist/v2/user/{userId}/rootlist/changes
Content-Type: application/json
Authorization: Bearer {token}
```

```json
{
  "deltas": [
    {
      "ops": [
        {
          "kind": "ADD",
          "add": {
            "items": [
              {
                "uri": "spotify:playlist:6weIESFCoYteXN325kMnCo",
                "attributes": {
                  "timestamp": "1772838532934"
                }
              }
            ],
            "addFirst": true
          }
        }
      ],
      "info": {
        "source": {
          "client": "WEBPLAYER"
        }
      }
    }
  ]
}
```

#### Response

```json
{
  "revision": "AAAAd6c3T5sD++EfxxbCw0OQ2Ok7YV4K",
  "syncResult": {
    "fromRevision": "...",
    "toRevision": "..."
  },
  "resultingRevisions": ["..."],
  "multipleHeads": false,
  "changesRequireResync": false
}
```

---

## 4. Delete Playlist (Playlist v2 API)

**Removes a playlist from the user's rootlist.**

```
POST https://spclient.wg.spotify.com/playlist/v2/user/{userId}/rootlist/changes
Content-Type: application/json
Authorization: Bearer {token}
```

```json
{
  "deltas": [
    {
      "ops": [
        {
          "kind": "REM",
          "rem": {
            "items": [
              {
                "uri": "spotify:playlist:6pehRDruMU0Cawj5hdQHyx"
              }
            ],
            "itemsAsKey": true
          }
        }
      ],
      "info": {
        "source": {
          "client": "WEBPLAYER"
        }
      }
    }
  ]
}
```

---

## 5. Update Playlist (Playlist v2 API)

**Updates a playlist's name and/or description.**

Replaces: `sdk.playlists.changePlaylistDetails()`

### Request

```
POST https://spclient.wg.spotify.com/playlist/v2/playlist/{playlistId}/changes
Content-Type: application/json
Authorization: Bearer {token}
```

```json
{
  "deltas": [
    {
      "ops": [
        {
          "kind": "UPDATE_LIST_ATTRIBUTES",
          "updateListAttributes": {
            "newAttributes": {
              "values": {
                "name": "hello",
                "description": "AI: make it make sense bestie"
              }
            }
          }
        }
      ],
      "info": {
        "source": {
          "client": "WEBPLAYER"
        }
      }
    }
  ]
}
```

### Variables

| Field | Type | Description |
|-------|------|-------------|
| `values.name` | `string` | New playlist name (omit to leave unchanged) |
| `values.description` | `string` | New playlist description (omit to leave unchanged) |

> **Note**: Only include fields you want to change. Spotify merges the `values` object — omitted fields remain unchanged. Both fields can be updated in a single request.

### Response

```json
{
  "revision": "AAAABHThjuKj6iOZ1Z3w4DB/roTlx7iX",
  "syncResult": {
    "fromRevision": "...",
    "toRevision": "..."
  },
  "resultingRevisions": ["..."],
  "multipleHeads": false
}
```

### Difference from Create

| | Create (§3) | Update (§5) |
|---|---|---|
| Endpoint | `POST /playlist/v2/playlist` (no ID) | `POST /playlist/v2/playlist/{playlistId}/changes` |
| Body wrapper | `{ "ops": [...] }` | `{ "deltas": [{ "ops": [...] }] }` |
| Has `info.source` | No | Yes |

---

## 6. queryArtistOverview (Pathfinder)

**Gets artist profile, images, stats, top tracks, and discography.**

Replaces: `sdk.artists.get(ids)` and App Auth `GET /v1/artists?ids=`

### Request

```
POST https://api-partner.spotify.com/pathfinder/v2/query
Content-Type: application/json
Authorization: Bearer {token}
```

```json
{
  "operationName": "queryArtistOverview",
  "variables": {
    "uri": "spotify:artist:246dkjvS1zLTtiykXe5h60",
    "locale": "intl-pt"
  },
  "extensions": {
    "persistedQuery": {
      "version": 1,
      "sha256Hash": "dd14c6043d8127b56c5acbe534f6b3c58714f0c26bc6ad41776079ed52833a8f"
    }
  }
}
```

### Variables

| Field | Type | Description |
|-------|------|-------------|
| `uri` | `string` | Spotify artist URI (`spotify:artist:{id}`) |
| `locale` | `string` | Locale string (e.g., `"intl-pt"`, `"en"`) |

### Response (key fields)

```json
{
  "data": {
    "artistUnion": {
      "__typename": "Artist",
      "uri": "spotify:artist:246dkjvS1zLTtiykXe5h60",
      "id": "246dkjvS1zLTtiykXe5h60",
      "profile": {
        "name": "Post Malone",
        "biography": { "text": "Diamond-certified American hitmaker..." },
        "externalLinks": { "items": [...] }
      },
      "visuals": {
        "avatarImage": {
          "sources": [
            { "url": "https://i.scdn.co/image/ab6761610000e5eb...", "width": 640, "height": 640 },
            { "url": "https://i.scdn.co/image/ab6761610000f178...", "width": 160, "height": 160 },
            { "url": "https://i.scdn.co/image/ab67616100005174...", "width": 320, "height": 320 }
          ]
        },
        "gallery": {
          "items": [
            { "sources": [{ "url": "https://i.scdn.co/image/...", "width": 640, "height": 640 }] }
          ]
        }
      },
      "headerImage": {
        "sources": [{ "url": "...", "width": ..., "height": ... }]
      },
      "stats": {
        "monthlyListeners": 63921614,
        "followers": 48337721,
        "worldRank": 29
      },
      "discography": {
        "topTracks": { "items": [...] }
      }
    }
  }
}
```

### Image Extraction

| Image Type | Path | Sizes | Use Case |
|---|---|---|---|
| **Avatar** (square) | `artistUnion.visuals.avatarImage.sources` | 640, 320, 160 | Artist profile picture in song cards |
| **Header** (banner) | `artistUnion.headerImage.sources` | varies | Large background banner |
| **Gallery** | `artistUnion.visuals.gallery.items[].sources` | 640+ | Additional promo photos |

> **Note**: `headerImage` can be null for some artists. Always fall back to `avatarImage`.

---

## 7. All Discovered Operations & Hashes

### Pathfinder Operations

| Operation | Hash | Type | Purpose | Shared Hash Group |
|-----------|------|------|---------|-------------------|
| `fetchLibraryTracks` | `087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240` | Query | Liked songs with pagination | — |
| `libraryV3` | `9f4da031f81274d572cfedaf6fc57a737c84b43d572952200b2c36aaa8fec1c6` | Query | User library (playlists) | — |
| `fetchPlaylistContents` | `9c53fb83f35c6a177be88bf1b67cb080b853e86b576ed174216faa8f9164fc8f` | Query | Playlist items with UIDs | A |
| `fetchPlaylistMetadata` | `9c53fb83f35c6a177be88bf1b67cb080b853e86b576ed174216faa8f9164fc8f` | Query | Playlist metadata | A |
| `fetchPlaylist` | `9c53fb83f35c6a177be88bf1b67cb080b853e86b576ed174216faa8f9164fc8f` | Query | Full playlist data | A |
| `profileAttributes` | `53bcb064f6cd18c23f752bc324a791194d20df612d8e1239c735144ab0399ced` | Query | User profile (name, avatar) | — |
| `queryArtistOverview` | `dd14c6043d8127b56c5acbe534f6b3c58714f0c26bc6ad41776079ed52833a8f` | Query | Artist profile, images, stats | — |
| `addToPlaylist` | `47b2a1234b17748d332dd0431534f22450e9ecbb3d5ddcdacbd83368636a0990` | Mutation | Add tracks to playlist | B |
| `removeFromPlaylist` | `47b2a1234b17748d332dd0431534f22450e9ecbb3d5ddcdacbd83368636a0990` | Mutation | Remove tracks from playlist | B |
| `playlistPermissions` | `f4c99a92059b896b9e4e567403abebe666c0625a36286f9c2bb93961374a75c6` | Query | Check edit capabilities | — |
| `areEntitiesInLibrary` | `134337999233cc6fdd6b1e6dbf94841409f04a946c5c7b744b09ba0dfe5a85ed` | Query | Check if tracks are saved | — |
| `isCurated` | (observed, hash not captured) | Query | Check if playlist is curated | — |

### Playlist v2 Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/playlist/v2/playlist` | POST | Create new playlist |
| `/playlist/v2/playlist/{playlistId}/changes` | POST | Update playlist attributes (name, description) |
| `/playlist/v2/user/{userId}/rootlist/changes` | POST | Add/remove playlists from user library |

### Hash Groups

Operations sharing the same hash are routed by `operationName`:
- **Group A**: `fetchPlaylistContents`, `fetchPlaylistMetadata`, `fetchPlaylist` → `9c53fb83...`
- **Group B**: `addToPlaylist`, `removeFromPlaylist` → `47b2a123...`

---

## 8. Auth Requirements

- **Same Bearer token** works for ALL operations (reads, mutations, artist queries)
- Token is intercepted from the web player's `Authorization: Bearer` header
- Token comes from Spotify's internal OAuth flow (not the public API)
- Token has ~1 hour expiry (3600s, we assume 55min for safety)
- No additional headers required beyond `Authorization` and `Content-Type: application/json`
- **No Client Credentials / App Auth needed** — the web player token covers everything including artist images

---

## 9. Reorder Tracks (Not Yet Captured)

Track reordering was **not tested** in this session. Based on the delta-based architecture:
- It likely uses `POST /playlist/v2/playlist/{playlistId}/changes` (same as update)
- Operation kind would be `"MOV"` (move) with `fromIndex`/`toIndex` or similar
- Alternatively, it could be a Pathfinder mutation with a different operationName

**To capture**: Drag-and-drop reorder a track within a playlist while the interceptor is active.

---

## 10. Risks & Gotchas

### Hash Rotation
- SHA256 hashes can change when Spotify deploys new client versions
- Our extension already handles this with the `hash-registry.ts` 3-tier lookup
- The interceptor auto-discovers new hashes from live traffic

### Rate Limits
- Pathfinder API returns 429 with `Retry-After` header
- Our `pathfinder.ts` already handles exponential backoff (max 3 retries)
- Bulk operations should add delays between requests (~200ms)

### UID Requirement for Removes
- Cannot remove by track URI — must first fetch playlist to get item UIDs
- UIDs are unique per playlist item (same track added twice = different UIDs)

### spclient Domain Variation
- Create/delete/update use `spclient.wg.spotify.com` (varies by region)
- Some requests route through `gew1-spclient.spotify.com` (EU region)
- The extension should handle domain variation

### Artist Query is Heavy
- `queryArtistOverview` returns full artist data (discography, top tracks, related artists)
- For our use case (just images), most of the response is wasted
- Consider caching artist images aggressively in the database
- A lighter alternative may exist but hasn't been discovered yet

### Detection Risk
- Using internal APIs violates Spotify's ToS
- No known active detection for normal usage patterns
- Avoid burst operations (many mutations in short time)
- Set `source.client` to `"WEBPLAYER"` to blend in

---

## 11. Viability Assessment

**For our use case (auto-sorting liked songs into playlists):**

| Operation | Viability | Notes |
|-----------|-----------|-------|
| Add tracks to playlist | ✅ High | Simple, well-tested, same hash as reads |
| Remove tracks from playlist | ✅ High | Requires UID lookup first |
| Create playlist | ✅ High | Two-step but straightforward |
| Delete playlist | ✅ High | Single rootlist/changes call |
| Update playlist | ✅ High | Same delta pattern as create |
| Get artist images | ✅ High | Response is heavy but images are there |
| Reorder tracks | ⚠️ Unknown | Not yet captured, likely delta-based |

**Overall**: Full SDK replacement is viable. Every official SDK operation has a confirmed Pathfinder/Playlist v2 equivalent. The same Bearer token works for everything, and our existing extension architecture (fetch interception → hash registry → pathfinder query wrapper) covers the entire surface area.

---

## Command Protocol (Web App ↔ Extension)

### Protocol Overview

The web app communicates with the extension via `chrome.runtime.sendMessage` using the `externally_connectable` manifest entry. Each message uses a `SPOTIFY_COMMAND` type wrapper:

- The web app generates a `commandId` (UUID) per request for correlation
- An optional `protocolVersion` field enables future breaking changes
- The extension routes commands to the appropriate client module (Pathfinder or Playlist v2) and returns a `CommandResponse<T>` envelope

### Supported Operations

| Command | Payload Type | Result Type | API Backend |
|---------|-------------|-------------|-------------|
| `addToPlaylist` | `{playlistUri, trackUris[], position?}` | `{typename}` | Pathfinder |
| `removeFromPlaylist` | `{playlistUri, uids[]}` | `{typename}` | Pathfinder |
| `createPlaylist` | `{name, userId}` | `{uri, revision}` | Playlist v2 |
| `updatePlaylist` | `{playlistId, name?, description?}` | `{revision}` | Playlist v2 |
| `deletePlaylist` | `{playlistUri, userId}` | `{revision}` | Playlist v2 |
| `queryArtistOverview` | `{artistUri, locale?}` | `{id, name, avatarImages[]}` | Pathfinder |

### Response Envelope

```typescript
// Success
{ ok: true, data: T, commandId: string }

// Error
{ ok: false, errorCode: SpotifyErrorCode, message: string, retryable: boolean, commandId: string }
```

### Error Codes

| Code | Description | Retryable |
|------|-------------|-----------|
| `AUTH_REQUIRED` | No Spotify token available | No |
| `TOKEN_EXPIRED` | Bearer token has expired | Yes (after re-intercept) |
| `RATE_LIMITED` | Spotify returned 429 | Yes (with backoff) |
| `NOT_FOUND` | Playlist/track/artist not found | No |
| `INVALID_PARAMS` | Malformed or missing command payload fields | No |
| `UNSUPPORTED_OPERATION` | Command name not recognized | No |
| `UPSTREAM_ERROR` | Spotify returned a non-retryable error | No |
| `UNKNOWN_HASH` | Persisted query hash rejected by Spotify | Yes (after hash refresh) |
| `NETWORK_ERROR` | Request failed at the network level | Yes |

### Out-of-Scope Operations

The following operations are explicitly **not supported** by this protocol:

- **Track reorder within playlists** — MOV delta not yet captured (see §9)
- **Playlist folder management** — rootlist folder ops not investigated
- **Social features** — follow/unfollow artists or users
- **Playback control** — play, pause, skip, seek, volume
- **Search** — Spotify search queries via Pathfinder
