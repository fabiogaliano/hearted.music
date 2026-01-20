## ADDED Requirements

### Requirement: Edge Runtime Compatibility

The matching pipeline SHALL run on Cloudflare Workers without Node.js-specific dependencies.

#### Scenario: Hashing uses Web Crypto API
- **WHEN** computing content hashes for cache keys
- **THEN** use Web Crypto API (`crypto.subtle.digest`) instead of Node.js `crypto` module

#### Scenario: No Node.js imports
- **WHEN** building the matching pipeline services
- **THEN** all imports SHALL be Edge-compatible (no `fs`, `crypto`, `path`, etc.)

#### Scenario: Async hashing
- **WHEN** computing hashes
- **THEN** hash functions return `Promise<string>` due to Web Crypto API async nature

---

### Requirement: Graceful Degradation

The matching pipeline SHALL continue to function when optional external services are unavailable.

#### Scenario: Missing Last.fm API key
- **WHEN** `LASTFM_API_KEY` environment variable is not set
- **THEN** create `LastFmService` as `null`
- **AND** `GenreEnrichmentService` returns empty genre arrays
- **AND** matching proceeds using LLM-derived genres from song analysis

#### Scenario: Last.fm API failure
- **WHEN** Last.fm API returns an error or rate limits
- **THEN** log the error at `warn` level
- **AND** return empty genres for affected songs
- **AND** do not throw or halt the matching pipeline

#### Scenario: Missing genres for matching
- **WHEN** a song has no genres (empty `song.genres`)
- **THEN** genre score component contributes 0 to the weighted score
- **AND** other score components (vector, semantic, audio) determine the match

#### Scenario: Missing audio features
- **WHEN** a song has no audio features in its analysis
- **THEN** audio score component contributes 0 to the weighted score
- **AND** other score components determine the match

#### Scenario: Missing playlist profile
- **WHEN** matching against a playlist with no computed profile
- **THEN** compute profile on-demand before matching
- **AND** cache the computed profile for subsequent matches
