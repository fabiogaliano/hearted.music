## MODIFIED Requirements

### Requirement: Query Modules Replace Repositories

The system SHALL use functional query modules instead of repository classes.

#### Scenario: Data access pattern
- **WHEN** accessing database from services
- **THEN** import functions from `data/*.ts` modules (not repository classes)

#### Scenario: Module organization
- **WHEN** organizing data access code
- **THEN** create domain-focused modules: `songs.ts`, `playlists.ts`, `analysis.ts`, `vectors.ts`, `matching.ts`, `jobs.ts`, `accounts.ts`, `newness.ts`, `preferences.ts`

#### Scenario: Analysis module provides song and playlist analysis access
- **WHEN** services need to read or write LLM analysis data
- **THEN** import from `data/analysis.ts` with functions: `getSongAnalysis` (latest, single or batch), `insertSongAnalysis`, `getSongAudioFeatures`, `upsertSongAudioFeatures`, `getPlaylistAnalysis`, `insertPlaylistAnalysis`

#### Scenario: Vectors module provides embedding and profile access
- **WHEN** services need to read or write vector embeddings
- **THEN** import from `data/vectors.ts` with functions: `getSongEmbedding`, `upsertSongEmbedding`, `getPlaylistProfile`, `upsertPlaylistProfile`

#### Scenario: Matching module provides match context and result access
- **WHEN** services need to read or write matching data
- **THEN** import from `data/matching.ts` with functions: `getMatchContext`, `createMatchContext`, `getMatchResults`, `getMatchResultsForSong`, `insertMatchResults`, `getTopMatchesPerPlaylist`

#### Scenario: Newness module provides item status tracking
- **WHEN** services need to track new/viewed/actioned items
- **THEN** import from `data/newness.ts` with functions: `getNewCounts`, `getNewItemIds`, `markItemsNew`, `markSeen`, `markAllSeen`

#### Scenario: Preferences module provides user preferences access
- **WHEN** services need to read or write user preferences
- **THEN** import from `data/preferences.ts` with functions: `getPreferences`, `updateTheme`, `getOnboardingStep`, `updateOnboardingStep`, `completeOnboarding`

#### Scenario: All query modules return Result types
- **WHEN** any query module function is called
- **THEN** return `Result<T, DbError>` for composable error handling using `better-result`

#### Scenario: Query modules use service role client
- **WHEN** query modules access Supabase
- **THEN** use `createAdminSupabaseClient()` to bypass RLS (custom auth pattern)
