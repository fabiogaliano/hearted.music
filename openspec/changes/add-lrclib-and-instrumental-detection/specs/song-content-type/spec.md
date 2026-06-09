## ADDED Requirements

### Requirement: Content-Type Classification Precedence

The system SHALL classify every analyzed song as exactly one of `lyrical`,
`instrumental`, or `unknown`, decided by a fixed precedence of trustworthy
signals where the first matching rule wins.

Precedence:
1. LRCLIB reports the track `instrumental` → `instrumental`
2. Real lyrics are in hand (at or above the match-confidence/word floor) →
   `lyrical`
3. The song's genres intersect the curated instrumental keyword set →
   `instrumental`
4. Spotify `instrumentalness` ≥ 0.9 → `instrumental`
5. Otherwise → `unknown`

#### Scenario: Authoritative instrumental flag wins
- **WHEN** the lyrics fetch resolves to `instrumental` (LRCLIB)
- **THEN** the song is classified `instrumental`
- **AND** no lower-precedence rule can override it

#### Scenario: Lyrics present beats audio heuristics
- **WHEN** the song has real lyrics in hand
- **AND** Spotify `instrumentalness` is high (e.g. 0.70)
- **THEN** the song is classified `lyrical` (e.g. Hot Chip "Need You Now")

#### Scenario: Genre keyword catches a mislabeled instrumental
- **WHEN** the song has no lyrics
- **AND** its genres include an instrumental keyword (e.g. `instrumental hip-hop`)
- **AND** Spotify `instrumentalness` is low (e.g. 0.03)
- **THEN** the song is classified `instrumental` (e.g. Saib tracks)

#### Scenario: High-extreme instrumentalness as the last positive signal
- **WHEN** the song has no lyrics and no instrumental genre keyword
- **AND** Spotify `instrumentalness` ≥ 0.9
- **THEN** the song is classified `instrumental` (e.g. Daft Punk "Veridis Quo")

#### Scenario: No trustworthy signal resolves to unknown
- **WHEN** the song has no lyrics, no instrumental genre keyword, and
  `instrumentalness` is absent or below 0.9
- **THEN** the song is classified `unknown` (e.g. Laurence Guy "Saw You for the
  First Time")

### Requirement: Instrumentalness Is Not a Low/Mid Signal

The system SHALL NOT use Spotify `instrumentalness` below 0.9 as evidence for or
against an instrumental classification.

#### Scenario: Mid instrumentalness does not imply instrumental
- **WHEN** a song's `instrumentalness` is between 0.5 and 0.9 with no other
  instrumental signal
- **THEN** the song is not classified `instrumental` on that basis

#### Scenario: Low instrumentalness does not imply lyrical
- **WHEN** a song's `instrumentalness` is near 0 but the lyrics fetch resolved
  `instrumental` or a genre keyword matched
- **THEN** the song is still classified `instrumental`

### Requirement: Curated Instrumental Genre Keywords

The system SHALL match genres against a curated instrumental keyword set that
excludes generic electronic genres, which contain too many vocal tracks to gate
on.

#### Scenario: Curated keyword matches
- **WHEN** a song's genres include `instrumental`, `instrumental hip-hop`,
  `neoclassical`, `contemporary classical`, `classical`, `ambient`, or
  `post-rock`
- **THEN** the genre rule treats the song as instrumental

#### Scenario: Generic electronic genres do not gate
- **WHEN** a song's genres are limited to generic tags such as `house`,
  `techno`, `deep house`, or `electronic`
- **THEN** the genre rule does not classify the song as instrumental

### Requirement: Persisted Content Type With Unknown Representable

The system SHALL persist a song's resolved content type with provenance such that
`unknown` is a representable state, distinct from "never analyzed."

#### Scenario: Unknown persisted distinctly
- **WHEN** a song resolves to `unknown`
- **THEN** that state is recorded
- **AND** is distinguishable from a song that has not been analyzed

#### Scenario: Re-resolution on better data
- **WHEN** a previously `unknown` song later resolves to `lyrical` or
  `instrumental` (e.g. a new LRCLIB hit)
- **THEN** the song is re-analyzed down the corresponding path

### Requirement: State-Specific Presentation

The song-detail panel SHALL present each content type honestly: a lyrical read,
a sound-first instrumental read, or an explicit lyrics-unavailable state — and
SHALL NOT show the lyrics-unavailable copy for a confirmed instrumental.

#### Scenario: Instrumental read rendered
- **WHEN** a song is classified `instrumental` and has a stored instrumental
  analysis
- **THEN** the panel renders the instrumental read (`headline`,
  `compound_mood`, `sonic_texture`, `mood_description`)
- **AND** does not show "We couldn't find enough about this one"

#### Scenario: Lyrics-unavailable state
- **WHEN** a song is classified `unknown`
- **THEN** the panel shows a distinct, honest "lyrics unavailable" message
- **AND** the song is flagged internally as a retry candidate

#### Scenario: Analyzing versus resolved
- **WHEN** analysis is still in flight for a selected song
- **THEN** the panel shows the "Listening" state
- **AND** once analysis resolves, the panel shows the read or the
  lyrics-unavailable state rather than remaining in "Listening"
