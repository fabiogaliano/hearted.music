# lyrics Specification

## Purpose
TBD - created by archiving change add-lyrics-fetching. Update Purpose after archive.
## Requirements
### Requirement: Lyrics Retrieval Service
The system SHALL retrieve lyrics for songs using an external provider based on artist and title metadata.

#### Scenario: Fetch lyrics for a song
- **WHEN** a song without lyrics enters the analysis pipeline
- **THEN** the service requests lyrics from the provider and returns the lyrics text or a `NoLyricsError`

#### Scenario: Query normalization
- **WHEN** the initial search yields no acceptable match
- **THEN** the service tries normalized query variants before failing

### Requirement: Analysis Pipeline Prefetch
The system SHALL prefetch lyrics for songs that require analysis before calling `SongAnalysisService`.

#### Scenario: Analysis pipeline has lyrics
- **WHEN** the pipeline prepares songs for analysis
- **THEN** each song passed to `analyzeSong` includes non-empty lyrics or is skipped with a logged `NoLyricsError`

### Requirement: Rate Limited Requests
The system SHALL limit concurrent lyrics requests to respect provider rate limits.

#### Scenario: Batch prefetch
- **WHEN** multiple songs are prefetched
- **THEN** the service enforces a maximum concurrency and spacing between requests

