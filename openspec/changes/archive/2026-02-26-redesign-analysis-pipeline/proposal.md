## Why

The current analysis pipeline generates ~20 LLM fields per song but only ~8 are consumed by matching, embeddings, or UI — 60% waste in tokens and complexity. The matching algorithm uses fragile structured signals (mood enum lookup tables, thematic string matching, listening context scores) that duplicate what embeddings already capture in continuous vector space. Meanwhile, instrumental songs hard-fail with `NoLyricsAvailableError`, the brand voice (compound moods, evocative fragments) isn't reflected in the prompt, and the schema shape doesn't match what the UI actually renders.

## What Changes

### Analysis Schema (LLM Output)

- **BREAKING** Replace the entire `SongAnalysisLlmSchema` (Zod) with a lean 8-field schema. Every field either displays in UI, feeds embedding text, or both. No dead weight.
- **Add** `headline` (string) — punchy 1-2 sentence song essence for list views/cards. Feeds display + embedding.
- **Add** `interpretation` (string) — single paragraph replacing the `surface_meaning`/`deeper_meaning` split. Feeds display + embedding.
- **Rename** `dominant_mood` → `compound_mood` (freeform two-word string, e.g. "Anxious Nostalgia"). Feeds display + embedding — no longer used for structured matching.
- **Keep** `mood_description`, `themes[].{name, description}`, `journey[].{section, mood, description}`, `sonic_texture`
- **Keep** `key_lines[].{line, insight}` — promoted from dead field to display-ready
- **Remove** `matching_profile` (4 scores — matching computes its own), `audience` (3 sub-fields — generic, no consumer), `emotional_peaks` (redundant with journey), `metaphors` (redundant with key_lines), `cultural_significance` (LLM hallucinates for lesser-known songs), `best_moments` (absorbed by mood_description + embedding), `themes[].confidence` (never displayed), `intensity`/`valence`/`energy` (LLM-generated duplicates of Spotify audio features), `genre_primary`/`genre_secondary` (genres come from Last.fm, not LLM), `vocal_style`/`production_style`/`distinctive_elements` (no consumers)
- **Remove** `listening_contexts` (12 numeric scores) — embeddings capture situational fit through descriptive text; explicit context scoring adds marginal value over embedding similarity + audio features

### Analysis Prompt

- **BREAKING** Rewrite the LLM prompt to produce the new schema in the Hearted brand voice (compound moods, evocative fragments, direct interpretations)
- **Add** instrumental song prompt variant — reduced 4-field output (`headline`, `compound_mood`, `mood_description`, `sonic_texture`) for songs without lyrics, using audio features + genre + artist/title as input

### Matching Algorithm

- **BREAKING** Simplify from 6 scoring dimensions to 3: embedding similarity (primary), audio feature distance, genre overlap
- **Remove** `computeFlowScore()` with mood transition lookup tables (`GOOD_MOOD_TRANSITIONS`, `RELATED_MOODS`) — embedding similarity captures mood coherence
- **Remove** `computeContextScore()` with listening context profile comparison — embedding similarity captures situational fit
- **Remove** `computeThematicScore()` with substring theme matching — embedding similarity captures thematic overlap
- **Reweight** matching formula: embedding similarity (heavy), audio feature distance (heavy), genre overlap (lighter)

### Embedding Text Builder

- **BREAKING** Rewrite `buildEmbeddingText()` to compose from the new schema fields: `headline` + `compound_mood` + `mood_description` + `interpretation` + `themes` (names + descriptions) + `journey` (moods) + `sonic_texture` + genres (from Last.fm input)
- **Remove** multiple `EmbeddingKind` variants (`full`, `theme`, `mood`, `context`) — single embedding per song built from all descriptive fields

### UI Types

- **BREAKING** Update `AnalysisContent` interface to match the new schema shape
- **Remove** fields the UI never rendered (`matching_profile`, `audience`, `emotional_peaks`, `metaphors`, `listening_contexts`)

## Capabilities

### New Capabilities

- `analysis-schema`: Defines the LLM output schema (Zod), prompt templates (lyrical + instrumental variants), and the contract between what the LLM produces and what downstream systems consume

### Modified Capabilities

- `matching-pipeline`: Matching simplifies from 6-signal to 3-signal (embedding + audio + genre). Removes mood transition tables, context scoring, thematic string matching. Reweights formula. Embedding text builder rewrites to use new schema fields. Genre enrichment (Last.fm top 3) unchanged.

## Impact

### Code (files requiring changes)

- `src/lib/capabilities/analysis/song-analysis.ts` — New Zod schema, new prompt (lyrical + instrumental variants), remove old schema
- `src/lib/capabilities/analysis/pipeline.ts` — Handle instrumental path (no longer hard-fail on no lyrics)
- `src/lib/capabilities/matching/scoring.ts` — Remove `computeFlowScore`, `computeContextScore`, `computeThematicScore`, mood lookup tables
- `src/lib/capabilities/matching/types.ts` — Simplify `MatchingSongAnalysis`, `ScoreFactors`, remove context/flow/semantic factors
- `src/lib/capabilities/matching/service.ts` — Update orchestration for 3-signal matching
- `src/lib/capabilities/matching/config.ts` — New weight defaults for 3 signals
- `src/lib/ml/embedding/service.ts` — Rewrite `buildEmbeddingText()`, remove `EmbeddingKind` variants
- `src/features/liked-songs/types.ts` — Update `AnalysisContent` interface
- `src/features/liked-songs/components/detail/ContextSection.tsx` — Remove or repurpose (no more "Perfect For" pills from `best_moments`)

### Database

- `song_analysis` table stores analysis as JSON blob — schema change is transparent (new analyses get new shape, old ones remain until re-analyzed)
- No migration needed for the JSON column itself
- Existing embeddings will be stale after text builder changes — re-embedding required for affected songs

### Dependencies

- No new external dependencies
- Last.fm genre enrichment (top 3) already exists — just ensure the LLM receives genres as input context
