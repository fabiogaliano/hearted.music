## MODIFIED Requirements

### Requirement: Query Modules Replace Repositories

The system SHALL use functional query modules instead of repository classes.

#### Scenario: Data access pattern
- **WHEN** accessing database from services
- **THEN** import functions from `data/*.ts` modules (not repository classes)

#### Scenario: Module organization
- **WHEN** organizing data access code
- **THEN** create domain-focused modules: `songs.ts`, `playlists.ts`, `analysis.ts`, `vectors.ts`, `matching.ts`, `jobs.ts`, `accounts.ts`, `newness.ts`, `preferences.ts`

#### Scenario: Songs module provides complete song access
- **WHEN** services need to query or modify songs
- **THEN** use `data/songs.ts` functions: `getSongById`, `getSongBySpotifyId`, `getSongsBySpotifyIds`, `upsertSongs`

#### Scenario: Songs module provides liked song operations
- **WHEN** services need to manage user's liked songs
- **THEN** use `data/songs.ts` functions: `getLikedSongs`, `upsertLikedSongs`, `softDeleteLikedSong`, `getPendingLikedSongs`, `updateLikedSongStatus`

#### Scenario: All query functions return Result types
- **WHEN** implementing data layer functions
- **THEN** return `Result<T, DbError>` for single items and `Result<T[], DbError>` for collections
