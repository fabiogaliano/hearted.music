# Analysis Schema Specification

## Purpose

Define the LLM output schema for song analysis, covering both lyrical and instrumental variants, the embedding text composition derived from analysis fields, and the brand voice constraints that govern all generated content. This capability is the contract between what the LLM produces and what downstream systems (UI, embedding, matching) consume.

---

## Requirements

### Requirement: Lyrical Song Analysis Schema

The LLM SHALL produce exactly 8 fields for songs with lyrics, each field serving display, embedding, or both.

Fields:
- `headline` (string): 1-2 sentence punchy essence of the song
- `compound_mood` (string): Two-word emotional label capturing tension (e.g. "Anxious Nostalgia")
- `mood_description` (string): 1-2 sentence evocative prose hook
- `interpretation` (string): Single paragraph direct insight into what this song is really about
- `themes` (array of `{name: string, description: string}`): 2-4 themes, lowercase, specific
- `journey` (array of `{section: string, mood: string, description: string}`): 4-5 section emotional progression following song structure
- `key_lines` (array of `{line: string, insight: string}`): 2-3 key lyric moments with contextual insight
- `sonic_texture` (string): Sound description suitable for embedding

#### Scenario: Successful lyrical analysis
- **WHEN** the LLM analyzes a song with lyrics
- **THEN** the output contains all 8 fields with non-empty values
- **AND** the output validates against `SongAnalysisLyricalSchema`

#### Scenario: Compound mood format validation
- **WHEN** the LLM produces a `compound_mood` value
- **THEN** the value contains exactly two words in the format `[Modifier] [Core Emotion]`
- **AND** the two words capture an emotional tension (e.g. "Restless Tenderness", "Defiant Grief")

#### Scenario: Theme format enforcement
- **WHEN** the LLM produces `themes` entries
- **THEN** each `name` is lowercase
- **AND** each `name` is specific and human (e.g. "losing yourself in someone", "running from home")
- **AND** each `name` is NOT an academic category (e.g. NOT "existentialism", NOT "mortality", NOT "interpersonal dynamics")

#### Scenario: Journey follows song structure
- **WHEN** the LLM produces `journey` entries
- **THEN** each `section` corresponds to a structural section of the song (e.g. "opening verse", "first chorus", "bridge", "final chorus")
- **AND** the entries are ordered to follow the song's progression from start to end
- **AND** there are between 4 and 5 entries

#### Scenario: Brand voice in descriptions
- **WHEN** the LLM produces `mood_description`, `interpretation`, or journey `description` values
- **THEN** the text uses evocative, present-tense, image-driven language
- **AND** the text avoids clinical, academic, or hedging phrasing

---

### Requirement: Instrumental Song Analysis Schema

The LLM SHALL produce exactly 4 fields for instrumental songs, skipping lyric-dependent fields.

Fields:
- `headline` (string): 1-2 sentence punchy essence
- `compound_mood` (string): Two-word emotional label
- `mood_description` (string): 1-2 sentence evocative prose hook
- `sonic_texture` (string): Sound description suitable for embedding

Omitted fields: `interpretation`, `themes`, `journey`, `key_lines`.

#### Scenario: Successful instrumental analysis
- **WHEN** the LLM analyzes a song classified as instrumental
- **THEN** the output contains exactly 4 fields (`headline`, `compound_mood`, `mood_description`, `sonic_texture`)
- **AND** the output validates against `SongAnalysisInstrumentalSchema`
- **AND** no lyric-dependent fields are present

#### Scenario: Instrumental detection from missing lyrics
- **WHEN** a song has no lyrics available (lyrics fetch returns empty or `NoLyricsError`)
- **THEN** the system routes the song to the instrumental analysis prompt variant

#### Scenario: Instrumental detection from audio features
- **WHEN** a song has Spotify `instrumentalness` greater than 0.5
- **THEN** the system routes the song to the instrumental analysis prompt variant

#### Scenario: Instrumental detection from short lyrics
- **WHEN** a song has lyrics containing fewer than 50 words
- **THEN** the system routes the song to the instrumental analysis prompt variant

---

### Requirement: Embedding Text Composition

The system SHALL build a single embedding text per song by concatenating all descriptive analysis fields and genre metadata.

#### Scenario: Lyrical embedding text composition
- **WHEN** building embedding text for a lyrical song analysis
- **THEN** the text includes: `headline`, `compound_mood`, `mood_description`, `interpretation`, theme names, theme descriptions, journey moods, `sonic_texture`, and genres (from Last.fm)
- **AND** all fields are concatenated into a single string

#### Scenario: Instrumental embedding text composition
- **WHEN** building embedding text for an instrumental song analysis
- **THEN** the text includes: `headline`, `compound_mood`, `mood_description`, `sonic_texture`, and genres (from Last.fm)
- **AND** the resulting text is shorter than a lyrical embedding but still sufficient for meaningful vector representation

---

### Requirement: Brand Voice Compliance

All LLM output SHALL follow Hearted voice patterns across every field.

Voice rules:
- **Compound moods**: `[Modifier]` + `[Core Emotion]` capturing emotional tension
- **Mood descriptions**: evocative, present-tense, image-driven prose
- **Interpretations**: direct insight framing, never "this song is about..." phrasing, never hedging ("perhaps", "seems to", "might be")
- **Themes**: lowercase, human, specific to the song's content (not academic categories)
- **Journey descriptions**: evocative fragments conveying emotional texture, not music-theory commentary

#### Scenario: Voice pattern validation
- **WHEN** the LLM produces any text field
- **THEN** the text matches the Hearted voice rules for that field type
- **AND** compound moods are two-word tension pairs
- **AND** mood descriptions use present tense and sensory imagery
- **AND** interpretations start with direct insight, not meta-framing

#### Scenario: Anti-pattern rejection
- **WHEN** reviewing LLM output for voice compliance
- **THEN** the following patterns are rejected:
  - Academic framing: "explores themes of existentialism", "commentary on society"
  - Clinical language: "the subject experiences cognitive dissonance", "demonstrates emotional volatility"
  - Hedging: "perhaps suggesting", "seems to imply", "might be about"
  - Meta-framing: "this song is about...", "the artist tells the story of..."
  - Generic themes: "love", "loss", "hope" (without specificity to the song)

---

### Requirement: Zod Schema as Source of Truth

The analysis schema SHALL be defined as Zod schemas with TypeScript types inferred via `z.infer`. Two separate schemas cover the lyrical and instrumental variants.

#### Scenario: Lyrical schema definition
- **WHEN** defining the lyrical analysis schema
- **THEN** a `SongAnalysisLyricalSchema` Zod object is exported
- **AND** it defines all 8 lyrical fields with appropriate Zod types and constraints
- **AND** a `SongAnalysisLyrical` TypeScript type is exported via `z.infer<typeof SongAnalysisLyricalSchema>`

#### Scenario: Instrumental schema definition
- **WHEN** defining the instrumental analysis schema
- **THEN** a `SongAnalysisInstrumentalSchema` Zod object is exported
- **AND** it defines the 4 instrumental fields with appropriate Zod types and constraints
- **AND** a `SongAnalysisInstrumental` TypeScript type is exported via `z.infer<typeof SongAnalysisInstrumentalSchema>`

#### Scenario: Schema used for LLM output validation
- **WHEN** the LLM returns a response
- **THEN** the response is parsed against the appropriate Zod schema (lyrical or instrumental)
- **AND** validation failures produce structured parse errors

---

## References

- [matching-pipeline spec](/openspec/specs/matching-pipeline/spec.md) — Downstream consumer of analysis output
- [lyrics spec](/openspec/specs/lyrics/spec.md) — Lyrics retrieval feeding analysis input

---

*Created: February 7, 2026 — redesign-analysis-pipeline change*
*Promoted to canonical spec: February 26, 2026*
