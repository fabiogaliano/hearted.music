# Migration v2: Decision Log

> Fresh Supabase schema with clean naming and end-to-end type safety.

---

## Principles

1. **Domain language** — Name things by what they ARE, not implementation details
2. **User terminology** — Use words normal humans say
3. **Translate at boundaries** — Spotify API uses "track," we use "song"

---

## Decided

| # | Topic | Decision | Reasoning |
|---|-------|----------|-----------|
| 001 | Core entity | `song` not `track` | Users say "liked songs" not "liked tracks" |
| 002 | User's likes | `liked_song` | Matches Spotify's "Liked Songs" feature name |
| 003 | Sorting targets | `is_destination` | Clear: songs get sorted *into* these playlists |
| 004 | User identity | `account` | Our app's identity; add `connection` table later for multi-platform |
| 005 | Matching tables | Keep `match_context` / `match_result` | Already accurate—represents the context (config + inputs) for a cached match computation |
| 006 | Jobs | Unified `job` + `job_failure` | Simpler than separate tables per job type; sync status moves from inline to job table |
| 007 | Primary keys | UUID with platform IDs as unique indexed columns | Platform independence; Supabase RLS patterns work naturally with UUIDs |
| 008 | Audio features | Separate `song_audio_feature` table | Different source (Spotify API) and lifecycle; keeps `song` lean; missing features = missing row, not NULLs |
| 009 | Song lifecycle | Global catalog, never deleted | Songs exist independently of users; other users may reference same song |
| 010 | Liked song deletion | Soft delete with `unliked_at` timestamp | Preserves timeline for archival; `NULL` = active; re-like history deferred |
| 011 | LLM provider | App-level config, not user choice | Simplifies UX; one less settings page |
| 012 | API keys | App provides keys, no BYOK | Removes `provider_keys` table; less infrastructure |
| 013 | Sync mode | Always automatic (cron + manual trigger) | No per-user sync_mode setting needed |
| 014 | Batch size | App-level config | Consistent behavior across users |
| 015 | Theme storage | ~~Column on `account`~~ → `user_preferences.theme` | Moved to separate table (#044) |
| 016 | `provider_keys` table | Dropped | No longer needed with app-provided keys |
| 017 | `user_preferences` table | ~~Dropped~~ → NEW separate table | Reinstated (#044): clean separation from account; stores theme + onboarding_step |
| 018 | Playlist song count | Denormalized `song_count` column | High reads, low writes; updated during sync batch |
| 019 | Playlist unique constraint | `UNIQUE(account_id, spotify_id)` | Same Spotify playlist can exist for different accounts |
| 020 | `playlist_song.account_id` | Dropped | Redundant; account accessible via playlist join |
| 021 | Job system | Unified `job` table for all job types | Single query for "what's running?"; type column distinguishes sync vs analysis |
| 022 | Job progress | JSONB `progress` column | Flexible structure; avoids adding columns for every metric |
| 023 | Job failures | Separate `job_failure` table | Tracks per-item failures for retry; linked to parent job |
| 024 | Analysis versioning | Inline metadata (model, tokens, prompt_ver, cost_cents) | Simple; store both tokens AND cost for historical accuracy |
| 025 | Analysis history | No UNIQUE constraint; query current by `created_at DESC LIMIT 1` | Preserves history; simple query pattern |
| 026 | Cache invalidation | Keep content hash strategy | Enables surgical invalidation; avoids expensive full recomputes |
| 027 | Match context versioning | Keep multi-model versioning (embedding, reranker, emotion) | All three model types active; independent version tracking needed |
| 028 | Vector dimensions | 1024 (E5-large) | Current embedding model; kept for schema |
| 029 | Query architecture | Query functions only (defer RPCs) | Fresh UI = unknown data needs. Start simple, add RPCs when performance data justifies it. YAGNI. |
| 030 | Data access layer | 7 query modules, no repository classes | Domain-organized functions with inferred types. Replaces 13 repository classes. |
| 031 | Query library | Supabase JS client (no ORM) | RLS works automatically; RR7 provides frontend type safety; avoids Drizzle/Kysely schema sync overhead |
| 032 | Spotify services | Keep `SpotifyService` as API client; delete `TrackService`; split `PlaylistService` | SpotifyService is correctly scoped as pure API client. TrackService is thin DB wrapper (→ query module). PlaylistService mixes concerns (split: DB → query module, sync logic → stays). |
| 033 | Analysis pipeline | Merge batch+prefetch+progress → `pipeline.ts`; keep retry/rate-limiter separate | Batch/prefetch/progress are tightly coupled orchestration. Retry and rate-limiting are cross-cutting concerns used elsewhere. |
| 034 | Factory pattern | Delete all factory files, use direct imports | Query modules are pure functions. Remaining services are singletons. RR7 loaders/actions provide composition root. |
| 035 | Real-time updates | SSE replaces Supabase Realtime (WebSocket) | Aligns with DATA-FLOW-PATTERNS.md decision. One-way progress updates don't need bidirectional WebSocket. SSE is simpler, auto-reconnects, integrates with TanStack Start. |
| 036 | Server functions | `createServerFn` for data mutations | TanStack Start provides type-safe server functions via `createServerFn()`. Validators via Zod, automatic serialization. Colocated with routes or in `lib/server/`. |
| 037 | Schema organization | Per-domain (`playlist.schema.ts`) | Matches query module boundaries. Schemas reusable across routes. Fewer files, less duplication. |
| 038 | Validation error handling | Both: `parseFormData` (throws) + `safeParseFormData` (returns) | Throw for API routes (unexpected errors). Return errors for forms (inline validation display). Different contexts need different patterns. |
| 039 | `account.display_name` | Add column | Available from Spotify OAuth, useful for UI greetings. |
| 040 | `song` artists storage | Keep as TEXT (primary artist only) | Simpler. Spotify returns array but we only display first. |
| 041 | `song.isrc` | Add column | ISRC enables future cross-platform matching (Apple Music, Tidal). |
| 042 | `song.image_url` | Add column | Store album art URL to avoid extra API calls during render. |
| 043 | `liked_song.status` | Add column (NULL/matched/ignored) | Filter matching algorithm: exclude already-processed songs. |
| 044 | User preferences | Separate `user_preferences` table | Clean separation from account identity; easier to extend |
| 045 | Theme storage | `user_preferences.theme` (color palette) | 4 palettes: blue/green/rose/lavender; `theme_mode` (dark/light) added later |
| 046 | Onboarding state | `user_preferences.onboarding_step` | Tracks progress through onboarding flow |
| 047 | View count tracking | Skip `view_count`, use `viewed_at` timestamp only | Simpler; we clear newness on first view, don't need count |
| 048 | Monetization tables | Defer to later migration | Keep v2 schema lean; add `user_credits` + `credit_transactions` when needed |
| 049 | RLS on junction tables | Subquery to check parent ownership | Safety net; `playlist_song` checks `playlist.account_id` via EXISTS |
| 050 | Service role pattern | Service role for backend writes, explicit `account_id` | Backend bypasses RLS but still tracks user attribution |
| 051 | Frontend hosting | Cloudflare Workers | Free tier (100K req/day), global edge, native React Router 7 SSR support |
| 052 | Database hosting | Supabase Cloud Free | Free tier with ping to prevent pause; upgrade to Pro when needed |
| 053 | Embeddings API | DeepInfra (`intfloat/multilingual-e5-large-instruct`) | Same model as local, no reindexing; cheaper than self-hosting |
| 054 | Reranker API | DeepInfra (`Qwen/Qwen3-Reranker-0.6B`) | Same model as local, consistent scoring |
| 055 | Emotion detection | Drop `go_emotions` model, use LLM | LLM song analysis already extracts emotional data |
| 056 | Python vectorization service | Delete entirely | Replaced by DeepInfra API calls from RR7 backend |

---

## Schema Mapping

| Old (v0) | New (v2) |
|----------|----------|
| `tracks` | `song` |
| `audio_features` | `song_audio_feature` |
| `saved_tracks` | `liked_song` |
| `playlist_tracks` | `playlist_song` |
| `track_analyses` | `song_analysis` |
| `playlist_analyses` | `playlist_analysis` |
| `track_embeddings` | `song_embedding` |
| `track_genres` | `song_genre` |
| `playlist_profiles` | `playlist_profile` |
| `playlists.is_flagged` | `playlist.is_destination` |
| `users` | `account` |
| `user_preferences` | `user_preferences` (NEW table) |
| `provider_keys` | **Dropped** |
| `match_contexts` | `match_context` (no change) |
| `match_results` | `match_result` (no change) |
| `analysis_jobs` | `job` (unified) |
| `track_analysis_attempts` | `job_failure` |
| `users.songs_sync_status` | Moves to `job` table |
| `playlists.tracks_sync_status` | Moves to `job` table |

---

*Last updated: January 2026*
