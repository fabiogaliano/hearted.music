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

- Spotify instrumentalness is unreliable in **both** directions — it scored
  vocal "Need You Now" at 0.70 and Ribs at 0.61 (false instrumental), and scored
  the genuinely instrumental Saib tracks at 0.01–0.03 (false vocal). Only the
  high extreme (≥ ~0.9) held in our sample (Goldmund 0.955, Daft Punk 0.949).
- Coverage is thin: of 824 songs only ~8% have any audio features, and ~91% have
  no genres — and of the 752 no-lyrics songs (the population where the question
  matters) only 2 had audio features at all.
- Genres carry an explicit instrumental / instrumental hip-hop tag and came
  back for every enriched song, correctly catching the Saib tracks that
  instrumentalness got wrong — but generic electronic tags (house, techno) are
  full of vocal tracks and cannot gate.

**A production incident (2026-06-09) proved the cost is not only cosmetic.**
Brock Berrigan "Crossing Paths" — an instrumental whose Genius page exists,
matches at 100% confidence, and literally says "This song is an instrumental" —
drove the worker into a permanent ~5-second hot loop for account `612d2e86…`:

1. The Genius page has no lyrics container, so the fetch dies as a
   `GeniusParseError` and is misfiled as "provider unavailable, retry in 6h" —
   a definitive "no lyrics exist" answer read as a temporary outage.
2. The song therefore never gains a `song_analysis` row, but the chunk selector
   (`select_liked_song_ids_needing_enrichment_work`) flags `needs_embedding`
   **without checking that analysis exists** — embedding's input dependency.
3. The embedding stage sees no analysis, skips silently, and records neither a
   result nor a failure — so no suppression window ever masks the flag.
4. `hasMoreSongs` stays true → `enrichment_completed(requestSatisfied: false)`
   → the reconciler re-ensures the job → goto 2, every ~5 seconds, forever.

The same audit surfaced two adjacent latent holes of the same class:
`needs_content_activation` ignores suppression windows entirely (every other
stage honors them), and blocked-input skip failures persist canned messages
("lyrics provider unavailable") that drop the underlying provider error — we
had to re-run the fetch live to learn what actually failed.

Knowing the true content type matters because the product shows **different,
honest** information for each: a lyrical read, a sound-first instrumental read,
or an honest "we couldn't find the words (yet)." Today all three collapse into
one misleading state — and the enrichment machine can burn indefinitely on the
collapsed case.

## What Changes

- **Add LRCLIB as a lyrics provider** ahead of / alongside Genius. LRCLIB
  returns an authoritative instrumental boolean and broader (incl. non-English)
  coverage, with no API key — fixing the ambiguity at the source rather than
  inferring it after the fact. Requests use the full track signature LRCLIB
  requires (title + artist + album + duration, matched ±2s), so album and
  duration are threaded into the lyrics fetch path.
- **Detect the Genius instrumental page.** When a matched Genius page has no
  lyrics container but carries the explicit "This song is an instrumental"
  marker, return a confirmed instrumental outcome (`source: "genius_page"`)
  instead of a parse error — converting today's retry-forever misfile into a
  terminal classification using a signal we already paid to fetch.
- **Persist a resolved content type per song** — lyrical / instrumental /
  unknown — with provenance (which signal decided), so the pipeline and the UI
  agree and unknown is representable rather than indistinguishable from
  absence.
- **Replace the lyrics-only `detectInstrumental` with a precedence-ordered
  classifier**: confirmed-instrumental fetch outcome (LRCLIB flag or Genius
  instrumental page) → real lyrics present → genre keyword match → very-high
  instrumentalness (≥ 0.9) → otherwise unknown. Low/mid instrumentalness never
  decides.
- **Override thin Genius matches** when LRCLIB reports the track is
  instrumental, fixing the spurious lyric match observed on Saib "in your arms"
  (an instrumental that Genius nonetheless returned words for).
- **Harden the chunk selector** so a song is only flagged for a stage whose
  inputs exist and whose failures are not suppressed: `needs_embedding`
  requires an existing `song_analysis` row, and `needs_content_activation`
  honors `job_item_failure` suppression windows like every other stage.
- **Stop instead of spinning on blocked chunks.** A chunk that attempts zero
  songs while the selector still reports work owed is blocked, not complete:
  the worker reports `enrichment_stopped` with a new `reason = "blocked"`,
  which the existing stale-without-auto-reensure semantics already handle —
  closing the hot-loop class structurally, not just the known instance.
- **Make blocked-input failures observable and convergent.** Persist the
  underlying provider error (class, status, URL) in blocked-skip failure rows
  instead of canned messages, and escalate a blocked code to terminal (with the
  existing replacement-credit compensation) after a bounded number of identical
  unresolved failures — every song eventually reaches done-or-dead.
- **Render each state honestly** in the song-detail panel: lyrical read
  (unchanged); a proper instrumental read (headline / compound_mood /
  sonic_texture / mood_description) so confirmed instrumentals stop showing
  "Quiet one"; and a distinct honest "lyrics unavailable" state for unknown,
  marked as a retry candidate.
- **Retire Spotify `instrumentalness` from the routing decision** (kept as
  stored data for matching/embeddings).

## Capabilities

### New Capabilities

- **song-content-type**: classify each song as lyrical / instrumental /
  unknown via a fixed precedence of trustworthy signals; persist the decision
  plus its provenance; and define how each state is presented in the song-detail
  panel (lyrical read, instrumental read, honest lyrics-unavailable state and
  retry candidacy).

### Modified Capabilities

- **lyrics**: multi-provider retrieval (LRCLIB then Genius) that surfaces an
  authoritative instrumental flag and a per-song fetch outcome with provenance;
  the instrumental flag overrides a low-confidence lyric match; the Genius
  instrumental page is recognized as a confirmed-instrumental signal.
- **background-enrichment-worker**: chunk selection respects stage input
  dependencies and suppression windows for all stages; blocked-input failures
  carry the underlying provider detail and escalate to terminal after a bounded
  number of identical failures; a no-progress chunk stops (`reason = blocked`)
  instead of completing-unsatisfied and immediately re-arming.
- **library-processing**: the `enrichment_stopped` reason union gains
  `blocked`, handled by the existing stale-without-auto-reensure semantics.

## Impact

- **Specs**: new song-content-type spec; deltas to lyrics,
  background-enrichment-worker, and library-processing specs.
- **Database** (`supabase/migrations/`): record content type + provenance so
  unknown is representable, not just an absent `song_lyrics` row (shape decided
  in design.md); recreate `select_liked_song_ids_needing_enrichment_work` with
  the embedding dependency gate and the content-activation suppression branch.
- **Lyrics domain** (`src/lib/domains/enrichment/lyrics/`): add an LRCLIB
  provider client + types; make LyricsService provider-ordered; return a typed
  outcome `{ lyrics | instrumental | not_found }` with source; detect the
  Genius instrumental-page marker in the lyrics-page fetch path.
- **Analysis routing**
  (`src/lib/domains/enrichment/content-analysis/song-analysis.ts`): rewrite
  `detectInstrumental` into the precedence classifier (genres and
  instrumentalness already exist on `AnalyzeSongInput`); thread the resolved
  content type through `analyzeSong`.
- **Batch analysis** (`content-analysis/song-batch-analysis.ts`): carry the
  underlying lyrics-fetch error into the blocked-skip failure rows; thread
  album + duration into `BatchSong` for the LRCLIB signature.
- **Worker** (`src/lib/workflows/enrichment-pipeline/`,
  `src/lib/workflows/library-processing/`): failure-policy escalation for
  blocked codes; blocked-chunk detection in the runner; `enrichment_stopped`
  reason union extension.
- **Pipeline** (`content-analysis/pipeline.ts`): propagate content type; keep
  instrumentals re-analyzable; record unknown as a retry candidate.
- **UI** (`src/features/liked-songs/components/song-detail-panel/`):
  `song-detail-adapter.ts` parses + exposes the instrumental read when present;
  `SongDetailPanelSurface.tsx` UnreadState gains a distinct lyrics-unavailable
  copy separate from a rendered read.

### Out of scope

- An automated re-fetch / backfill worker for the unknown bucket — we record
  retry candidacy now; automating the sweep is a follow-up change.
- A timer that re-arms a `blocked`-stopped enrichment workflow; like
  error/local_limit stops, the next semantic change re-ensures it (V1
  failure-handling posture).
- Providers beyond LRCLIB + Genius (e.g. Musixmatch).
- Rebuilding matching/embeddings to consume the new content-type signal.
- Diagnosing the repeated `match_snapshot_failed` observed during the incident
  (separate investigation; it merely rode along with the enrichment loop).
