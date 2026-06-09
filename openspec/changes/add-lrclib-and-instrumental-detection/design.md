# Design

## Context

`detectInstrumental` currently decides purely on whether `input.lyrics` is
present (a previous fix removed the unreliable `instrumentalness` gate). That was
correct as far as it went, but it conflates two outcomes — *genuinely
instrumental* and *lyrics fetch failed* — because the only lyrics provider
(Genius) cannot distinguish them. This change resolves the ambiguity at the
source (LRCLIB), demotes `instrumentalness`, and makes the three outcomes
first-class through persistence and presentation.

Measured evidence from the local library that drives the decisions below:

| Song | Truth | `instrumentalness` | genres | Genius |
|---|---|---|---|---|
| Hot Chip — Need You Now | vocal | 0.70 | — | matched |
| Lorde — Ribs | vocal | 0.61 | — | matched |
| Saib — When It Rains / in your arms | instrumental | 0.03 / 0.01 | `instrumental, instrumental hip-hop` | "in your arms" wrongly matched |
| Goldmund — Subtle The Sum | instrumental | 0.955 | `ambient, neoclassical` | no match |
| Daft Punk — Veridis Quo | instrumental | 0.949 | `electronic, house, dance` | no match |
| Closer — Patrick Holland | instrumental | 0.884 | `house, electronic` | no match |
| Remix — Hamayoun Angar | vocal (Dari) | 0.001 | `{}` | no match |
| Laurence Guy — Saw You... | instrumental | null | `deep house` | no match |

## Goals / Non-Goals

- **Goal**: separate `lyrical` / `instrumental` / `unknown` reliably enough that
  the panel never shows "couldn't find enough" for a song we *can* describe.
- **Goal**: fix the ambiguity at the lyrics-fetch layer, where the signal is
  authoritative, not after the fact.
- **Non-Goal**: a perfect binary "is it instrumental." Laurence Guy proves it is
  not achievable from our data (no audio features, no instrumental genre tag) —
  `unknown` is a deliberate, honest third state, not a failure.
- **Non-Goal**: automating retries for `unknown`; we only record candidacy.

## Decision 1 — LRCLIB as the primary provider, Genius as fallback

LRCLIB (`https://lrclib.net`, no API key) returns, per track:
`{ instrumental: boolean, plainLyrics, syncedLyrics }`. That `instrumental` flag
is the authoritative signal Genius cannot give us. Order: **LRCLIB first**, fall
back to Genius only when LRCLIB has no record (`404`). Rationale: LRCLIB both
disambiguates (instrumental vs not-found) and has broader non-English coverage;
Genius remains a useful fallback for songs LRCLIB lacks.

`LyricsService` (`src/lib/domains/enrichment/lyrics/service.ts`,
`createLyricsService`) becomes provider-ordered and returns a typed outcome:

```
type LyricsOutcome =
  | { kind: "lyrics"; text: string; source: "lrclib" | "genius"; confidence: number }
  | { kind: "instrumental"; source: "lrclib" }
  | { kind: "not_found" }
```

Follow existing patterns: class + factory + `Result` returns, `TaggedError`,
Zod-validated provider responses. No barrel exports.

## Decision 2 — Classifier precedence (replaces `detectInstrumental`)

Decide in this fixed order; first hit wins:

1. **LRCLIB `instrumental: true`** → `instrumental` (authoritative).
2. **Real lyrics in hand** (LRCLIB or Genius, above the word/confidence floor)
   → `lyrical`.
3. **Genre keyword match** against a curated instrumental set
   (`instrumental`, `instrumental hip-hop`, `neoclassical`,
   `contemporary classical`, `classical`, `ambient`, `post-rock`, …) →
   `instrumental`. Generic electronic tags (`house`, `techno`, `deep house`,
   `electronic`) are **excluded** — they are full of vocal tracks.
4. **`instrumentalness` ≥ 0.9** → `instrumental` (catches Daft Punk, which has no
   instrumental genre tag). High extreme only.
5. **Otherwise** → `unknown`.

`instrumentalness` below ~0.9 gets **no vote** — neither for nor against. This is
the crux: the data shows mid values misfire toward vocal (Need You Now 0.70) and
low values misfire toward instrumental (Saib 0.01). Only the high extreme is
trustworthy. `AnalyzeSongInput` already carries `genres?: string[]` and
`instrumentalness?: number`, so no signature change is needed for steps 3–4.

## Decision 3 — Spurious-match override

LRCLIB `instrumental: true` overrides a Genius lyric match below a confidence
floor (the Saib "in your arms" case: Genius returned words for a track LRCLIB
and its own genre tags call instrumental). A *high-confidence* Genius match is
still trusted as `lyrical` even if LRCLIB says instrumental (LRCLIB is
community-sourced and occasionally mislabels), so the override is gated on the
existing lyric match confidence from `utils/string-similarity.ts` /
`search-strategy.ts`.

## Decision 4 — Persistence (primary open question)

`unknown` must be representable; today an absent `song_lyrics` row means both
"no lyrics" and "never tried." Two options:

- **(A) Extend `song_lyrics`** with `fetch_status text` (`lyrics` | `instrumental`
  | `not_found`) + `source text`, and always write a row after a fetch attempt
  (an `instrumental`/`not_found` row carries an empty `document`). Smallest
  schema change; keeps the signal next to where it is produced.
- **(B) New `song_content_type` table** (`song_id`, `content_type`, `source`,
  `decided_at`) decoupled from lyrics. Cleaner separation, but a second source of
  truth to keep in sync with `song_lyrics`.

**Recommendation: (A).** The content type is a direct product of the lyrics
fetch; co-locating it avoids a sync problem and matches how the pipeline already
reasons ("does a `song_lyrics` row exist?"). The classifier's genre/instrumental
fallback (steps 3–4) is computed at analysis time and does not need its own row —
only the lyrics-fetch outcome is persisted; the final routing decision is
recomputed deterministically from `{ fetch_status, genres, instrumentalness }`.

Migration via `supabase/migrations/` (never ad hoc), RLS stays deny-all.

## Decision 5 — Presentation (three states → three surfaces)

In `SongDetailPanelSurface.tsx` `UnreadState`, the `analyzing` vs `Quiet one`
branch becomes three:

- **lyrical** → existing `SongRead` render (unchanged).
- **instrumental** → render the instrumental analysis
  (`headline` / `compound_mood` / `sonic_texture` / `mood_description`).
  `song-detail-adapter.ts` currently only `safeParse`s `SongReadSchema` and drops
  everything else to `read = null`; it gains a parallel parse for
  `SongAnalysisInstrumentalSchema` so the panel has something to render. Copy
  follows the brand voice (sound-first, evocative).
- **unknown** → an honest, distinct copy ("We don't have the words for this one
  yet" — separate from a real read), flagged internally as a retry candidate.

This keeps the honest "couldn't find" only for the genuine `unknown` case and
stops penalising confirmed instrumentals.

## Risks / Trade-offs

- **LRCLIB coverage / mislabels**: community-sourced; some tracks missing or
  mistagged. Mitigated by Genius fallback and the confidence-gated override
  (Decision 3).
- **Genre-keyword recall**: real instrumentals without an instrumental tag (Daft
  Punk, Laurence Guy) slip past step 3 — step 4 catches Daft Punk; Laurence Guy
  correctly lands in `unknown`. Accepted: `unknown` is honest.
- **External dependency at fetch time**: one more network provider. Mitigated by
  existing rate-limiting/concurrency in `LyricsService` and `not_found`
  short-circuit to Genius.

## Migration / Rollout

- Backfill is lazy: existing songs re-resolve on next enrichment; no bulk re-run
  required. The `unknown`/`instrumental` rows accrue as songs are unlocked.
- `instrumentalness` stays in `song_audio_feature` and stored analysis for
  matching/embeddings; only its *routing vote* is removed.
