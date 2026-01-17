# Tasks: Add Analysis Schema Tables

## 1. Extensions

- [x] 1.1 Create `20260117000000_enable_vector.sql` to enable pgvector extension

## 2. Song Extension Tables (Tier 2)

- [x] 2.1 Create `20260117000001_create_song_audio_feature.sql`
- [x] 2.2 Create `20260117000002_create_song_analysis.sql`
- [x] 2.3 Create `20260117000003_create_song_embedding.sql` (with vector column + HNSW index)
- [x] 2.4 Create `20260117000004_create_song_genre.sql`

## 3. Playlist Extension Tables (Tier 3)

- [x] 3.1 Create `20260117000005_create_playlist_analysis.sql`
- [x] 3.2 Create `20260117000006_create_playlist_profile.sql` (with vector column + HNSW index)

## 4. Job Extension Tables (Tier 3)

- [x] 4.1 Create `20260117000007_create_job_failure.sql`

## 5. Matching Tables (Tier 3-4)

- [x] 5.1 Create `20260117000008_create_match_context.sql`
- [x] 5.2 Create `20260117000009_create_match_result.sql`

## 6. User Tables (Tier 3)

- [x] 6.1 Create `20260117000010_create_item_status.sql`
- [x] 6.2 Create `20260117000011_create_user_preferences.sql`

## 7. RLS Policies

- [x] 7.1 Create `20260117000012_add_analysis_rls_policies.sql`

## 8. Verification

- [x] 8.1 Run `supabase db reset` - migrations apply cleanly ✓
- [x] 8.2 Run `bun run gen:types` - regenerate TypeScript types ✓
- [x] 8.3 Run `bun tsc --noEmit` - no errors with new types ✓
