# Design Document: Redesign Analysis Pipeline

## Context

The current analysis pipeline generates ~20 LLM fields per song via a deeply nested Zod schema (`SongAnalysisLlmSchema` with `meaning`, `emotional`, `context`, `musical_style`, `matching_profile` groups). Of those ~20 fields, only ~8 are consumed by downstream systems:

- **Matching** reads `dominant_mood`, `themes[].name`, `listening_contexts` (12 numeric scores), and `best_moments` via `MatchingSongAnalysis`
- **Embedding** builds text from `themes[].name`, `surface_meaning`, `dominant_mood`, `mood_description`, `best_moments`, `genre_primary`, `sonic_texture` via `buildFullText()`
- **UI** renders `dominant_mood`, `mood_description`, `themes`, `surface_meaning`/`deeper_meaning`, `journey`, `sonic_texture`, `genre_primary` via `AnalysisContent`

The remaining ~12 fields (`matching_profile` (4 scores), `audience` (3 sub-fields), `emotional_peaks`, `metaphors`, `cultural_significance`, `intensity`, `valence`, `energy`, `vocal_style`, `production_style`, `distinctive_elements`, `genre_secondary`) are generated, stored, and never read. This wastes LLM tokens and adds maintenance surface area.

The matching algorithm uses 6 scoring signals (`vector: 0.25`, `audio: 0.25`, `genre: 0.15`, `semantic: 0.15`, `context: 0.15`, `flow: 0.05`) where three of them -- `semantic` (substring theme matching), `context` (12 listening context scores compared against playlist profile), and `flow` (mood transition lookup tables with `GOOD_MOOD_TRANSITIONS` and `RELATED_MOODS` dictionaries) -- are lossy, fragile compressions of what the embedding vector already captures in continuous space.

The embedding service defines four `EmbeddingKind` variants (`full`, `theme`, `mood`, `context`) but only `full` is ever passed to matching. The other three text builders (`buildThemeText`, `buildMoodText`, `buildContextText`) are dead code.

Instrumental songs currently hard-fail with `NoLyricsAvailableError` at line 223 of `song-analysis.ts`, producing no analysis at all.

The brand voice -- compound moods ("Anxious Nostalgia"), evocative fragments, direct present-tense observations -- is described in the prompt's style guidelines but the schema's structured fields (`dominant_mood` as a single word, `surface_meaning`/`deeper_meaning` split) work against it.

The app is pre-production and fully malleable. No user data at risk.

## Goals / Non-Goals

### Goals

- Eliminate wasted LLM output: reduce from ~20 fields to 9, where every field is consumed by display, embedding text, or both
- Embedding-centric matching that captures mood, theme, context, and vibe holistically through vector similarity instead of fragile structured signals
- Support instrumental songs with a reduced schema (4 fields) instead of hard-failing
- Brand voice in analysis output: compound moods, evocative fragments, direct present-tense interpretations
- Simpler matching algorithm: 3 signals (embedding + audio + genre) instead of 6

### Non-Goals

- Changing the embedding model or provider (DeepInfra E5-instruct stays)
- Modifying Spotify, ReccoBeats, Genius, or Last.fm integrations
- Changing the database schema (`song_analysis` stores analysis as a JSON blob -- the shape change is transparent to the column)
- UI redesign (update the `AnalysisContent` TypeScript interface to match the new schema; rendering changes are a separate concern)
- Playlist profiling changes beyond removing context/flow/semantic profile dimensions that no longer have consumers

## Decisions

### 1. Embedding-centric matching (3 signals: embedding + audio + genre)

**Decision**: Replace the 6-signal matching formula with 3 signals. Remove `computeFlowScore()`, `computeContextScore()`, `computeThematicScore()`, `scoreMoodTransition()`, and the `GOOD_MOOD_TRANSITIONS` / `RELATED_MOODS` lookup tables from `scoring.ts`. Remove `semantic`, `context`, and `flow` from `ScoreFactors`, `MatchingWeights`, and `MatchingConfig`. Remove `MatchingSongAnalysis` (its fields -- `dominantMood`, `themes`, `listeningContexts` -- have no consumers after this change). Remove `recentSongs`, `themes`, and `listeningContexts` from `MatchingPlaylistProfile`. Simplify `DataAvailability` to `hasEmbedding`, `hasGenres`, `hasAudioFeatures`. Remove the tiered scoring gate (`deepAnalysisThreshold`) since all 3 signals are cheap to compute.

**Rationale**: The structured signals are lossy compressions of what the embedding already captures. "Anxious Nostalgia" breaks the mood transition lookup table (not in `GOOD_MOOD_TRANSITIONS` keys), but embeds naturally near "Melancholic Hope" or "Restless Longing" in vector space. Substring theme matching (`computeThematicScore`) misses "Self-Destruction" vs "Self-Sabotage" but the embedding captures their proximity. The 12 listening context scores (`workout`, `party`, etc.) are LLM-generated numbers that duplicate information already present in the descriptive text that feeds the embedding.

**Alternative considered**: Keep structured signals alongside embeddings for debuggability. Rejected because the marginal signal does not justify the maintenance cost of mood transition tables, thematic string matching, and context score comparison, all of which are fragile and hard to tune.

**Alternative considered**: Pure embedding matching (drop audio + genre too). Rejected because audio features are objective measurements from Spotify/ReccoBeats (not LLM interpretations) that ground matching in physical reality, and genre is a strong categorical signal for playlist coherence that the embedding model may not capture precisely.

### 2. LLM describes, doesn't classify

**Decision**: The LLM produces freeform descriptive text fields. No mood enum, no numeric scores, no structured classification. `compound_mood` (e.g., "Anxious Nostalgia") is a display-only freeform string. Matching does not read any analysis field directly -- it operates on the embedding vector built from the descriptive text.

**Rationale**: Freeform description ("Restless energy wrapped in synth-pop shimmer") produces richer embedding text than constrained enums. The E5-instruct embedding model understands natural language -- letting the LLM speak naturally produces a higher-fidelity input signal than forcing it through classification.

**Implication**: No `dominant_mood` enum, no `listening_contexts` numeric scores, no `matching_profile` scores. The separation between "LLM output for display" and "signal for matching" is clean: display reads analysis JSON fields directly, matching reads the embedding vector.

**Alternative considered**: Dual fields (`compound_mood` for display + `primary_mood` enum for matching). Rejected because embedding similarity handles mood matching better than enum lookup, and the enum forces a lossy classification choice.

### 3. Single embedding per song

**Decision**: Remove the `EmbeddingKind` enum (`full`, `theme`, `mood`, `context`). One embedding per song, built from all descriptive fields concatenated. Remove `buildThemeText()`, `buildMoodText()`, `buildContextText()` from `EmbeddingService`.

**Rationale**: Only `full` kind is used in matching today. The other three text builders are dead code with no consumers. A single rich embedding from all descriptive fields is simpler and captures the holistic vibe. The `kind` column in the `song_embeddings` table can remain (default `"full"`) for backward compatibility.

**Implementation**: Rewrite `buildEmbeddingText()` to concatenate fields from the new schema: `headline` + `compound_mood` + `mood_description` + `interpretation` + `themes` (names + descriptions) + `journey` (moods) + `sonic_texture` + genres (from Last.fm input, not LLM output).

### 4. Instrumental songs get reduced schema (4 fields)

**Decision**: When lyrics are unavailable, use an instrumental prompt variant that produces 4 fields: `headline`, `compound_mood`, `mood_description`, `sonic_texture`. The remaining 4 LLM fields (`interpretation`, `themes`, `journey`, `key_lines`) are omitted. Genres from Last.fm are still available and included in the instrumental embedding text.

**Rationale**: Without lyrics, `interpretation`, `themes`, `journey`, and `key_lines` would be hallucinated. Being honest about what is knowable from audio features + genre + artist/title alone produces more trustworthy output.

**Detection**: If lyrics fetch returns `NoLyricsAvailableError` OR Spotify `instrumentalness > 0.5`, use the instrumental prompt variant. For borderline cases (lyrics present but fewer than 50 words), use the instrumental path -- minimal lyrics do not provide enough signal for meaningful thematic analysis.

**Matching impact**: Audio features carry more weight naturally since there is less embedding text. This is correct behavior -- instrumental songs should match primarily on how they sound.

### 5. Genres from Last.fm (top 3), not LLM-generated

**Decision**: Remove `genre_primary` and `genre_secondary` from the LLM output schema. Genres come from Last.fm community tags (top 3, already fetched by `GenreEnrichmentService` and stored on `song.genres`). Genres are provided to the LLM as input context (so it can reference genre conventions in its descriptions) and included in the embedding text, but the LLM does not generate genre classifications.

**Rationale**: Community-sourced tags from Last.fm with the existing 469-genre canonical whitelist are more reliable than LLM genre classification, which tends to hallucinate for lesser-known artists or niche genres.

### 6. Matching weight distribution

**Decision**: Starting weights: `embedding: 0.50`, `audio: 0.30`, `genre: 0.20`.

**Rationale**: Embedding is the primary signal -- it captures mood, theme, vibe, and situational fit holistically. Audio features ground the match in physical reality (tempo, energy, valence are objective measurements). Genre is a tiebreaker for playlist coherence (a jazz song and an electronica song could have similar embedding vectors for "late night contemplative" but belong in different playlists).

**Adaptive weights**: When embedding is unavailable (missing analysis), redistribute its weight proportionally to audio and genre. When audio features are unavailable, redistribute to embedding and genre. The `computeAdaptiveWeights()` function simplifies from 5 availability flags to 3.

**Tuning**: These are educated starting points. They should be validated against real playlist data by measuring whether songs in the same user playlist cluster more tightly than songs across playlists.

### 7. New LLM schema (9 fields, lyrical variant)

**Decision**: Replace `SongAnalysisLlmSchema` with a flat schema (no nesting groups):

| Field | Type | Display | Embedding | Purpose |
|---|---|---|---|---|
| `headline` | `string` | Yes | Yes | 1-2 sentence song essence for list views |
| `compound_mood` | `string` | Yes | Yes | Freeform compound mood ("Anxious Nostalgia") |
| `mood_description` | `string` | Yes | Yes | Paragraph describing the emotional texture |
| `interpretation` | `string` | Yes | Yes | Single paragraph replacing `surface_meaning` + `deeper_meaning` |
| `themes` | `Array<{name, description}>` | Yes | Yes | Identified themes (no `confidence` score) |
| `journey` | `Array<{section, mood, description}>` | Yes | Yes (moods) | Emotional arc following song structure |
| `key_lines` | `Array<{line, insight}>` | Yes | No | Notable lyric lines with interpretation |
| `sonic_texture` | `string` | No | Yes | Description of the sonic palette (embedding only, no UI currently) |

**8 fields from LLM, plus genres from Last.fm (top 3).** Every field is consumed by at least one downstream system. The flat structure avoids the current nested grouping (`meaning.interpretation.surface_meaning`) that adds indirection without value.

**Genres**: Come exclusively from Last.fm community tags (top 3, normalized against 469-genre canonical whitelist). The LLM receives genres as input context (so it can reference genre conventions in its descriptions) but does not output genre classifications — Last.fm is more reliable and the LLM has the same hallucination risk as cultural significance for lesser-known artists. Last.fm genres serve dual purpose: included in embedding text (for semantic matching) and used directly for genre overlap scoring (categorical matching).

### 8. Prompt rewrite for brand voice

**Decision**: Rewrite `SONG_ANALYSIS_PROMPT` to produce the new schema in the Hearted brand voice. Key prompt directives:

- Write in direct, present-tense language as an observer (already in current prompt, but now reinforced by schema shape)
- `compound_mood` must be a two-word evocative compound in [Modifier] + [Core Emotion] format (not a single adjective)
- `headline` should read like a capsule review, not a summary
- `interpretation` merges `surface_meaning` and `deeper_meaning` into one flowing paragraph
- No hedging language ("seems to", "perhaps", "might be")

**Instrumental variant**: Same voice, but restricted to what is knowable from audio features + genre + artist context. The prompt explicitly instructs the LLM not to speculate about lyrical content.

## Risks / Trade-offs

### Risk: Embedding quality depends on prompt quality

**Impact**: High -- if descriptive text is generic or repetitive across songs, embeddings collapse to similar vectors and matching degrades.

**Mitigation**: Test embedding clustering with real playlists as ground truth. Pick 5 diverse playlists, embed all songs, measure intra-playlist vs inter-playlist cosine similarity. If intra-playlist similarity is not meaningfully higher than inter-playlist, the descriptions need to be more discriminating.

### Risk: Less debuggable matching

**Impact**: Medium -- the current system produces 6 named scores (`vector: 0.72, genre: 0.8, audio: 0.65, semantic: 0.3, context: 0.5, flow: 0.7`) which are individually interpretable. With 3 signals, and the primary one being a black-box embedding similarity, it is harder to explain why a song matched or did not match a playlist.

**Mitigation**: Log the embedding text per song so matching decisions can be traced back to descriptions. The `ScoreFactors` interface still provides `embedding`, `audio`, `genre` as named scores. Consider adding a "nearest neighbors" debug view that shows the 3 closest songs in a playlist to a candidate, with their embedding texts.

### Risk: Re-embedding required for all existing songs

**Impact**: Low (pre-production, small dataset) -- but the operational pattern matters for future.

**Mitigation**: This is a batch job, not a schema migration. Run `embedBatch()` after deploying the new text builder. Old embeddings remain in the DB (keyed by `content_hash`) and are functionally superseded by new embeddings with different content hashes. No data deletion required.

### Risk: Dual schema period during rollout

**Impact**: Low -- between deploying new code and re-analyzing all songs, some songs will have old-shape analysis JSON and some will have new-shape.

**Mitigation**: The `AnalysisContent` TypeScript interface already marks all fields as optional. UI components already guard against missing fields. New analyses get the new shape immediately. Old analyses render with whatever fields they have until re-analyzed.

### Risk: Instrumental detection edge cases

**Impact**: Low -- songs with minimal lyrics (mostly instrumental with a few spoken words) could go either path.

**Mitigation**: Use a word-count threshold: if lyrics have fewer than 50 words, use the instrumental path. This avoids hallucinated thematic analysis from insufficient text. The threshold is configurable.

## Migration Plan

### Step 1: Deploy new schemas and prompt (no behavioral change yet)

- Replace `SongAnalysisLlmSchema` in `song-analysis.ts` with the new 9-field Zod schema
- Add instrumental variant schema (4 fields) and prompt
- Update `AnalysisContent` interface in `liked-songs/types.ts` to match new shape
- Update `buildAnalysisData()` to pass through new fields

### Step 2: Deploy simplified matching algorithm

- Replace `ScoreFactors` with 3 fields: `embedding`, `audio`, `genre`
- Replace `MatchingWeights` with 3 fields
- Remove `computeFlowScore()`, `computeContextScore()`, `computeThematicScore()`, `scoreMoodTransition()`, `GOOD_MOOD_TRANSITIONS`, `RELATED_MOODS` from `scoring.ts`
- Update `MatchingService.scoreSongToPlaylist()` to compute 3 signals without tiered gating
- Simplify `computeAdaptiveWeights()` for 3 factors
- Remove `MatchingSongAnalysis`, simplify `MatchingPlaylistProfile`

### Step 3: Deploy updated embedding text builder

- Rewrite `buildEmbeddingText()` for new schema fields
- Remove `EmbeddingKind` enum and `buildThemeText()`/`buildMoodText()`/`buildContextText()`
- Update `embedSong()` and `embedBatch()` signatures to remove `kind` parameter (default `"full"` internally for DB compatibility)

### Step 4: Deploy instrumental path in analysis pipeline

- Update `SongAnalysisService.analyzeSong()` to detect instrumental songs (no lyrics or `instrumentalness > 0.5`) and use the instrumental prompt variant instead of returning `NoLyricsAvailableError`
- Add word-count threshold check (< 50 words = instrumental path)

### Step 5: Background jobs (post-deploy)

- Batch re-analyze all songs with new prompt (generates new-shape analysis JSON)
- Batch re-embed all songs with new text builder (generates new embedding vectors)
- Batch re-profile playlists with new embeddings

Steps 1-4 can deploy together as a single release. Step 5 is a background job triggered after deploy.

**Rollback**: Revert code changes. Old analysis JSON and old embeddings remain in the database untouched. Songs analyzed after deploy but before rollback will have new-shape JSON, but since all `AnalysisContent` fields are optional, the old UI renders gracefully.

## Open Questions

1. **Matching weight tuning** -- Starting weights (`0.50` / `0.30` / `0.20`) are educated guesses. Need real playlist data to validate. Measurement approach: for each playlist, compute pairwise song similarity and compare intra-playlist similarity distribution to inter-playlist similarity distribution. Weights should maximize separation.

2. **Embedding text composition format** -- Should fields be concatenated with labels (`"Mood: Anxious Nostalgia. Themes: identity, loss."`) or as a flowing paragraph (`"A track steeped in anxious nostalgia, exploring identity and loss..."`)? Labeled format is more explicit for the embedding model; flowing text is more natural. Need to test which produces better clustering with E5-instruct.

3. **Journey for instrumental songs** -- Currently omitted from the instrumental variant. Could revisit if energy curve data from audio features (not currently extracted but available from Spotify's audio analysis endpoint) could drive a section-by-section journey without lyrics.
