## Why

The pipeline cannot tell a genuinely instrumental song from one whose lyrics we
simply failed to fetch. Both arrive at `detectInstrumental`
(`src/lib/domains/enrichment/content-analysis/song-analysis.ts`) as "no lyrics,"
get routed to the instrumental analysis path, and the panel renders the same
"Quiet one / We couldn't find enough about this one" — even for fully vocal
tracks. We observed this on Hot Chip "Need You Now" and non-English tracks such
as Hamayoun Angar "Remix" (a Dari vocal track our provider doesn't carry).

The root cause is the lyrics provider, not the classifier. Genius returns "no
match" identically for a real instrumental and a song it doesn't carry, so the
distinction is discarded at the source. Downstream heuristics cannot fully
recover it:

- Spotify `instrumentalness` is unreliable in **both** directions — it scored
  vocal "Need You Now" at 0.70 and Ribs at 0.61 (false instrumental), and scored
  the genuinely instrumental Saib tracks at 0.01–0.03 (false vocal). Only the
  high extreme (≥ ~0.9) held in our sample (Goldmund 0.955, Daft Punk 0.949).
- Coverage is thin: of 824 songs only ~8% have any audio features, and ~91% have
  no genres — and of the 752 no-lyrics songs (the population where the question
  matters) only 2 had audio features at all.
- Genres carry an explicit `instrumental` / `instrumental hip-hop` tag and came
  back for every enriched song, correctly catching the Saib tracks that
  `instrumentalness` got wrong — but generic electronic tags (house, techno) are
  full of vocal tracks and cannot gate.

Knowing the true content type matters because the product shows **different,
honest** information for each: a lyrical read, a sound-first instrumental read,
or an honest "we couldn't find the words (yet)." Today all three collapse into
one misleading state.

## What Changes

- **Add LRCLIB as a lyrics provider** ahead of / alongside Genius. LRCLIB
  returns an authoritative `instrumental` boolean and broader (incl. non-English)
  coverage, with no API key — fixing the ambiguity at the source rather than
  inferring it after the fact.
- **Persist a resolved content type per song** — `lyrical` / `instrumental` /
  `unknown` — with provenance (which signal decided), so the pipeline and the UI
  agree and `unknown` is representable rather than indistinguishable from
  absence.
- **Replace the lyrics-only `detectInstrumental` with a precedence-ordered
  classifier**: LRCLIB instrumental flag (authoritative) → real lyrics present →
  genre keyword match → very-high `instrumentalness` (≥ 0.9) → otherwise
  `unknown`. Low/mid `instrumentalness` never decides.
- **Override thin Genius matches** when LRCLIB reports the track is instrumental,
  fixing the spurious lyric match observed on Saib "in your arms" (an
  instrumental that Genius nonetheless returned words for).
- **Render each state honestly** in the song-detail panel: lyrical read
  (unchanged); a proper instrumental read (`headline` / `compound_mood` /
  `sonic_texture` / `mood_description`) so confirmed instrumentals stop showing
  "Quiet one"; and a distinct honest "lyrics unavailable" state for `unknown`,
  marked as a retry candidate.
- **Retire Spotify `instrumentalness` from the routing decision** (kept as stored
  data for matching/embeddings).

## Capabilities

### New Capabilities

- **song-content-type**: classify each song as `lyrical` / `instrumental` /
  `unknown` via a fixed precedence of trustworthy signals; persist the decision
  plus its provenance; and define how each state is presented in the song-detail
  panel (lyrical read, instrumental read, honest lyrics-unavailable state and
  retry candidacy).

### Modified Capabilities

- **lyrics**: multi-provider retrieval (LRCLIB then Genius) that surfaces an
  authoritative instrumental flag and a per-song fetch outcome with provenance;
  the instrumental flag overrides a low-confidence lyric match.

## Impact

- **Specs**: new `song-content-type` spec; delta to `lyrics` spec.
- **Database** (`supabase/migrations/`): record content type + provenance so
  `unknown` is representable, not just an absent `song_lyrics` row (shape decided
  in `design.md`).
- **Lyrics domain** (`src/lib/domains/enrichment/lyrics/`): add an LRCLIB
  provider client + types; make `LyricsService` provider-ordered; return a typed
  outcome `{ lyrics | instrumental | not_found }` with `source`.
- **Analysis routing**
  (`src/lib/domains/enrichment/content-analysis/song-analysis.ts`): rewrite
  `detectInstrumental` into the precedence classifier (`genres` and
  `instrumentalness` already exist on `AnalyzeSongInput`); thread the resolved
  content type through `analyzeSong`.
- **Pipeline** (`content-analysis/pipeline.ts`): propagate content type; keep
  instrumentals re-analyzable; record `unknown` as a retry candidate.
- **UI** (`src/features/liked-songs/components/song-detail-panel/`):
  `song-detail-adapter.ts` parses + exposes the instrumental read when present;
  `SongDetailPanelSurface.tsx` `UnreadState` gains a distinct lyrics-unavailable
  copy separate from a rendered read.

### Out of scope

- An automated re-fetch / backfill worker for the `unknown` bucket — we record
  retry candidacy now; automating the sweep is a follow-up change.
- Providers beyond LRCLIB + Genius (e.g. Musixmatch).
- Rebuilding matching/embeddings to consume the new content-type signal.
