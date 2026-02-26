# hearted. Chrome Extension — Spotify Bridge

## Why

Spotify's Feb 2026 API restrictions (Premium required, 5-user limit, batch endpoints removed) will kill the current OAuth-based integration by March 9, 2026. No alternative platform offers equivalent API access today.

This extension reads the user's Spotify session from the web player and bridges data to the hearted. backend — bypassing the developer API entirely. The web player's internal API returns full data (ISRC, popularity, all fields) with no developer restrictions.

## Architecture

```
Content Script (open.spotify.com)     Background Service Worker          hearted. Backend
  │                                     │                                  │
  ├─ fetch /get_access_token ──────────→│                                  │
  │  (same-origin, includes cookies)    │                                  │
  │                                     ├─ GET /v1/me/tracks (paginated)   │
  │                                     ├─ GET /v1/me/playlists            │
  │                                     ├─ GET /v1/playlists/{id}/items    │
  │                                     │                                  │
  │                                     ├─ chrome.cookies.get(session_id)  │
  │                                     ├─ POST /api/extension/sync ──────→├─ importLikedTracks()
  │                                     │                                  ├─ incrementalSync()
  │                                     │                                  ├─ playlist sync
  │                                     │←── { ok, total, added, removed } │
  │                                     │                                  │
Popup (React)                           │                                  │
  ├─ sendMessage(GET_STATUS) ──────────→│                                  │
  ├─ sendMessage(TRIGGER_SYNC) ────────→│                                  │
  └─ storage.onChanged (live progress)  │                                  │
```

## What the Extension Replaces

| Current Flow (OAuth API) | Extension Replacement |
|---|---|
| `GET /me/tracks` via SpotifyService | Background worker fetches with session token |
| `GET /me/playlists` via SpotifyService | Background worker fetches with session token |
| `GET /playlists/{id}/tracks` via SpotifyService | Background worker fetches with session token |
| `POST /playlists/{id}/items` (add track) | Background worker writes with session token |
| `POST /me/playlists` (create playlist) | Background worker writes with session token |
| `GET /tracks?ids=` (batch, for artist images) | Background worker fetches individually |
| `GET /artists?ids=` (batch, for images) | Background worker fetches individually |
| Token refresh via `POST /api/token` | Content script re-extracts from web player session |

## File Structure

```
extension/
├── package.json
├── tsconfig.json
├── scripts/
│   └── build.ts                          # esbuild: 3 entry points → dist/
├── src/
│   ├── manifest.json
│   ├── icons/                            # 16, 48, 128px
│   ├── background/
│   │   └── service-worker.ts             # Token mgmt, Spotify fetch, backend POST
│   ├── content/
│   │   └── spotify-token.ts              # Token extraction via /get_access_token
│   ├── popup/
│   │   ├── index.html                    # Dark theme shell (inline CSS)
│   │   ├── main.tsx                      # React entry
│   │   └── App.tsx                       # Status display + sync button
│   └── shared/
│       ├── types.ts                      # SpotifyTrackDTO, SyncState, messages
│       ├── constants.ts                  # URLs
│       └── storage.ts                    # Typed chrome.storage.local wrapper
```

Backend additions (existing app):
```
src/routes/api/extension/
├── sync.tsx                              # POST - receives liked songs + playlists
└── status.tsx                            # GET - returns sync state for popup
```

## Existing Code to Reuse

| Function | Location | Purpose |
|---|---|---|
| `importLikedTracks(accountId, tracks)` | `src/lib/capabilities/sync/sync-helpers.ts` | Transform → upsert songs → link liked_songs |
| `incrementalSync(accountId, data)` | `src/lib/capabilities/sync/sync-helpers.ts` | Diff: toAdd/toRemove, soft-deletes unliked |
| `getAccountById(accountId)` | `src/lib/data/accounts.ts` | Validate accountId from extension |
| `likedSongsData.getAll(accountId)` | `src/lib/data/liked-song.ts` | Existing liked songs for diff |
| `likedSongsData.getCount(accountId)` | `src/lib/data/liked-song.ts` | Track count for status |
| Session cookie: `"session_id"` | `src/lib/auth/cookies.ts:9` | Extension reads via chrome.cookies.get() |
| API route pattern | `src/routes/api/artist-images-for-tracks.tsx` | createFileRoute + server.handlers + Zod |
| Playlist sync service | `src/lib/capabilities/sync/playlist-sync.ts` | Playlist + playlist track upsert logic |

---

## Implementation Checklist

### Milestone 1: Extension skeleton (build + load in Chrome)

- [ ] Create `extension/package.json` (react, react-dom, @types/chrome, esbuild, typescript)
- [ ] Create `extension/tsconfig.json` (strict, ESNext, chrome types)
- [ ] Create `extension/scripts/build.ts` (esbuild: content=IIFE, background=ESM, popup=ESM → dist/)
- [ ] Create `extension/src/manifest.json` (MV3, permissions, host_permissions, content_scripts)
- [ ] Create placeholder icon PNGs (16, 48, 128)
- [ ] Create stub `extension/src/content/spotify-token.ts` (console.log on load)
- [ ] Create stub `extension/src/background/service-worker.ts` (onInstalled log)
- [ ] Create stub `extension/src/popup/index.html` + `main.tsx` + `App.tsx` (static "hearted." text)
- [ ] Run `bun install && bun run build`
- [ ] Load unpacked in chrome://extensions — verify no errors

**Test**: Extension icon appears, popup opens with text, content script logs on spotify.com, background console shows install message.

---

### Milestone 2: Token extraction (content script → background)

- [ ] Create `extension/src/shared/types.ts` (ExtensionMessage union, SpotifyTokenPayload)
- [ ] Create `extension/src/shared/constants.ts` (BACKEND_URL, SPOTIFY_API_BASE)
- [ ] Implement content script: fetch `/get_access_token`, send SPOTIFY_TOKEN message
- [ ] Implement background message listener for SPOTIFY_TOKEN (store in memory)
- [ ] Add visibility change + interval re-extraction in content script

**Test**: Open spotify.com logged in → background service worker console shows received token. Token re-extracted when switching tabs back to Spotify.

---

### Milestone 3: Fetch liked songs from Spotify (background worker)

- [ ] Implement `fetchAllLikedTracks(token, onProgress)` in service worker
  - Paginated GET /v1/me/tracks?limit=50&offset=N
  - 429 retry with Retry-After header
  - Filter null tracks
  - Progress callback
- [ ] Create `extension/src/shared/storage.ts` (SyncState getter/setter)
- [ ] Add TRIGGER_SYNC message handler that calls fetchAllLikedTracks
- [ ] Store fetched tracks in chrome.storage.local temporarily
- [ ] Log results to console

**Test**: Send TRIGGER_SYNC from background console → tracks fetched and logged. Progress updates visible in storage.

---

### Milestone 4: Backend import API (receive liked songs)

- [ ] Create `src/routes/api/extension/sync.tsx`
  - POST handler
  - Validate X-Extension-Session header (accountId UUID)
  - Verify account exists via getAccountById()
  - Zod validate SpotifyTrackDTO[] payload
  - Determine initial vs incremental sync
  - Call importLikedTracks() or incrementalSync()
  - Return { ok, total, added, removed }
- [ ] Create `src/routes/api/extension/status.tsx`
  - GET handler
  - Validate session header
  - Return { authenticated, displayName, trackCount }
- [ ] Run `bunx tsr generate`
- [ ] Test with curl

**Test**: `curl -X POST .../api/extension/sync -H "X-Extension-Session: <uuid>" -d '{"tracks":[...]}'` → returns sync result. Tracks appear in DB.

---

### Milestone 5: End-to-end liked songs sync (extension → backend)

- [ ] Background worker reads session_id cookie via chrome.cookies.get()
- [ ] After fetching liked tracks, POST to /api/extension/sync with session header
- [ ] Handle response, update SyncState in storage
- [ ] Wire up GET_STATUS message handler

**Test**: Open spotify.com → open hearted. in another tab (logged in) → trigger sync from background console → liked songs appear in hearted. UI.

---

### Milestone 6: Popup UI

- [ ] Build popup index.html with dark theme (inline CSS matching hearted. aesthetic)
- [ ] Build App.tsx with: status dot, track count, sync button, progress, last sync time, errors
- [ ] Wire up GET_STATUS on mount, TRIGGER_SYNC on button click
- [ ] Wire up chrome.storage.local.onChanged for live progress during sync

**Test**: Click extension icon → popup shows status → click "Sync Now" → progress updates live → shows "✓ 2,340 tracks synced".

---

### Milestone 7: Playlist sync

- [ ] Add `fetchUserPlaylists(token)` to service worker
  - GET /v1/me/playlists (paginated)
  - Filter to owned playlists only
- [ ] Add `fetchPlaylistTracks(token, playlistId)` to service worker
  - GET /v1/playlists/{id}/items (paginated)
- [ ] Extend /api/extension/sync payload to accept playlists + playlist tracks
- [ ] Wire up backend to reuse existing playlist sync logic from orchestrator
- [ ] Update popup to show playlist sync progress

**Test**: Trigger full sync → liked songs AND playlists with tracks appear in hearted.

---

### Milestone 8: Write operations (create playlist, add to playlist)

- [ ] Add `createPlaylist(token, name, description)` to service worker
  - POST /v1/me/playlists
- [ ] Add `addTrackToPlaylist(token, playlistId, trackUri)` to service worker
  - POST /v1/playlists/{id}/items
- [ ] Create backend endpoints or messages for write-through:
  - hearted. UI action → backend → extension message → Spotify write
  - OR: extension exposes these as message handlers the popup/backend can trigger
- [ ] Update the existing addSongToPlaylist server function to route through extension

**Test**: From hearted. liked songs view → add track to playlist → track appears in Spotify playlist.

---

### Milestone 9: Polish & reliability

- [ ] Auto-sync via chrome.alarms (every 30 min when Spotify tab is open)
- [ ] Badge text on extension icon (track count or sync indicator)
- [ ] Handle large libraries (>10k tracks) — chunked POST to backend
- [ ] Handle token expiry mid-sync (re-extract and retry)
- [ ] Error recovery (partial sync resume)
- [ ] Production backend URL support (configurable in popup settings)

---

## Key Technical Notes

### Token Extraction
The Spotify web player exposes `https://open.spotify.com/get_access_token` which returns the current session's OAuth token. Content script runs on spotify.com origin, so this is a same-origin fetch with cookies included automatically. Returns `{ accessToken, accessTokenExpirationTimestampMs, isAnonymous }`.

### Session Cookie
hearted. stores session as HTTP-only `session_id` cookie containing raw accountId UUID. In dev: not Secure, SameSite=Lax. Extension reads it via `chrome.cookies.get({ url: BACKEND_URL, name: "session_id" })` (requires `cookies` permission + host_permissions for backend URL).

### Build
esbuild with 3 entry points:
- Content script → IIFE (Chrome requirement, no ESM in content scripts)
- Background service worker → ESM (MV3 supports `"type": "module"`)
- Popup → ESM (loaded via `<script type="module">`)

### MV3 Service Worker Lifecycle
Service workers are ephemeral — Chrome kills them when idle. Use `chrome.alarms` for periodic work, not `setInterval`. Store all state in `chrome.storage.local`, not in-memory variables (except ephemeral token cache).
