## ADDED Requirements

### Requirement: Playlist-profile bootstrap from free signals and playlist text

The system SHALL be able to compute a usable destination playlist profile before any playlist-member LLM analysis exists.

This requirement defines a **description-assisted bootstrap mode** and SHALL NOT prevent future `playlist_only` or combined profiling modes.

#### Scenario: Free-signal backfill for destination playlist members
- **WHEN** the playlist profiling stage prepares a destination playlist
- **THEN** it SHALL backfill missing audio features for playlist-member songs using the existing audio features service
- **AND** it SHALL backfill missing genres for playlist-member songs using the existing genre enrichment service
- **AND** it SHALL NOT invoke song analysis or song embedding generation for playlist-member songs as part of this bootstrap path

#### Scenario: Description fallback embedding
- **WHEN** a destination playlist has no member-song embedding centroid
- **AND** the playlist has non-empty normalized `name + description` text
- **THEN** the profiling service SHALL embed that text using the existing text embedding helper with `prefix: "passage:"`
- **AND** it SHALL use that vector as the playlist profile embedding

#### Scenario: Song-derived centroid remains authoritative
- **WHEN** one or more member-song embeddings are available for the destination playlist
- **THEN** the playlist profile SHALL keep using the member-song embedding centroid
- **AND** description text SHALL only act as a fallback

#### Scenario: Bootstrap mode remains additive
- **WHEN** the profiling service supports additional modes in the future
- **THEN** this bootstrap behavior SHALL remain an additive mode rather than replacing the song-derived path
- **AND** future `playlist_only` or combined modes MAY choose different source-selection behavior explicitly

---

## MODIFIED Requirements

### Requirement: Playlist Profiling

The system SHALL compute aggregate profiles for destination playlists.

#### Scenario: Embedding centroid
- **WHEN** computing playlist profile
- **THEN** average all available song embeddings in the playlist

#### Scenario: Audio feature centroid
- **WHEN** computing playlist profile
- **THEN** average all available song audio features in the playlist
- **AND** the profiling stage SHALL first attempt to backfill missing free audio features for playlist-member songs

#### Scenario: Genre distribution
- **WHEN** computing playlist profile
- **THEN** compute genre frequency distribution across playlist songs
- **AND** the profiling stage SHALL first attempt to backfill missing genres for playlist-member songs

#### Scenario: Profile persistence
- **WHEN** profile is computed
- **THEN** store it in `playlist_profile`
- **AND** persist a `content_hash` derived from the actual inputs that shape the profile, not membership alone

---

### Requirement: Content Hashing

The system SHALL use content hashing for cache invalidation.

#### Scenario: Playlist profile hash includes bootstrap inputs
- **WHEN** computing a playlist profile cache key
- **THEN** it SHALL include normalized description text when playlist text shapes the stored profile
- **AND** it SHALL include the currently available aggregate signals that shape the stored profile
- **AND** a stale profile SHALL be recomputed when those inputs change even if playlist membership does not

#### Scenario: Profile algorithm version changes
- **WHEN** the playlist profile computation algorithm changes in a way that affects persisted profile semantics
- **THEN** the system SHALL bump `PLAYLIST_PROFILE_VERSION`
- **AND** existing cached playlist profiles SHALL naturally miss under the new version
