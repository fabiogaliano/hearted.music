## MODIFIED Requirements

### Requirement: Lyrics Retrieval Service

The system SHALL retrieve lyrics for songs using ordered external providers based
on artist and title metadata, and SHALL return a typed outcome distinguishing
lyrics found, a confirmed instrumental, and not found — rather than collapsing
the latter two into a single failure.

#### Scenario: Fetch lyrics for a song
- **WHEN** a song without lyrics enters the analysis pipeline
- **THEN** the service queries the providers in order and returns one of:
  `{ kind: "lyrics", text, source }`, `{ kind: "instrumental", source }`, or
  `{ kind: "not_found" }`

#### Scenario: Query normalization
- **WHEN** the initial search yields no acceptable match
- **THEN** the service tries normalized query variants before moving to the next
  provider or returning `not_found`

#### Scenario: Provider order
- **WHEN** lyrics are requested for a song
- **THEN** the service tries LRCLIB first
- **AND** only falls back to Genius when LRCLIB returns no record for the track

## ADDED Requirements

### Requirement: LRCLIB Provider

The system SHALL integrate LRCLIB as a lyrics provider that returns an
authoritative `instrumental` flag alongside any lyrics, without requiring an API
key.

#### Scenario: LRCLIB reports an instrumental track
- **WHEN** LRCLIB returns a record with `instrumental: true`
- **THEN** the service returns `{ kind: "instrumental", source: "lrclib" }`
- **AND** does not fall through to Genius for that track

#### Scenario: LRCLIB returns lyrics
- **WHEN** LRCLIB returns non-empty `plainLyrics` for the matched track
- **THEN** the service returns `{ kind: "lyrics", source: "lrclib" }` with the
  lyric text

#### Scenario: LRCLIB has no record
- **WHEN** LRCLIB returns no match for the track
- **THEN** the service falls back to Genius

### Requirement: Instrumental Flag Overrides a Low-Confidence Match

The system SHALL let an LRCLIB `instrumental: true` flag override a Genius lyric
match whose similarity confidence is below the accepted floor, so a spurious
title match does not route an instrumental down the lyrical path.

#### Scenario: Spurious Genius match on an instrumental
- **WHEN** Genius returns lyrics for a track below the match-confidence floor
- **AND** LRCLIB reports the same track as `instrumental: true`
- **THEN** the resolved outcome is `instrumental`, not `lyrics`

#### Scenario: High-confidence lyric match is preserved
- **WHEN** a provider returns a lyric match at or above the confidence floor
- **THEN** the outcome stays `lyrics` even if another provider reports
  `instrumental`

### Requirement: Fetch Outcome Persistence

The system SHALL persist the lyrics-fetch outcome per song so that a confirmed
instrumental and a genuine fetch gap are distinguishable later, and so that an
unattempted song is distinguishable from one resolved as not found.

#### Scenario: Outcome recorded after a fetch attempt
- **WHEN** the service resolves a fetch attempt
- **THEN** a record is written capturing the outcome (`lyrics` / `instrumental` /
  `not_found`) and the deciding `source`

#### Scenario: Not found is representable
- **WHEN** all providers return no record for a song
- **THEN** the persisted outcome is `not_found`
- **AND** this state is distinguishable from a song that was never attempted
