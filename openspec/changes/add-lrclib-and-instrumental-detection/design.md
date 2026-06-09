# Design

## Context

`detectInstrumental` currently decides purely on whether `input.lyrics` is
present (a previous fix removed the unreliable instrumentalness gate). That was
correct as far as it went, but it conflates two outcomes — *genuinely
instrumental* and *lyrics fetch failed* — because the only lyrics provider
(Genius) cannot distinguish them. This change resolves the ambiguity at the
source (LRCLIB + the Genius instrumental page), demotes instrumentalness, and
makes the three outcomes first-class through persistence and presentation.

It also hardens the enrichment machine around the same ambiguity. A live
incident (account `612d2e86…`, song "Crossing Paths") showed that a song stuck
in "analysis blocked" can drive the worker into a ~5s hot loop: the selector
flags `needs_embedding` without checking embedding's input dependency
(`song_analysis`), the embedding stage skips silently (no failure row, no
suppression), `hasMoreSongs` stays true, and the reconciler re-ensures the job
indefinitely. Two latent variants exist: `needs_content_activation` ignores
suppression windows, and blocked-skip failure rows drop the underlying provider
error, making the whole class hard to diagnose.

Measured evidence from the local library that drives the decisions below:

| Song | Truth | instrumentalness | genres | Genius |
|---|---|---|---|---|
| Hot Chip — Need You Now | vocal | 0.70 | — | matched |
| Lorde — Ribs | vocal | 0.61 | — | matched |
| Saib — When It Rains / in your arms | instrumental | 0.03 / 0.01 | instrumental, instrumental hip-hop | "in your arms" wrongly matched |
| Goldmund — Subtle The Sum | instrumental | 0.955 | ambient, neoclassical | no match |
| Daft Punk — Veridis Quo | instrumental | 0.949 | electronic, house, dance | no match |
| Closer — Patrick Holland | instrumental | 0.884 | house, electronic | no match |
| Remix — Hamayoun Angar | vocal (Dari) | 0.001 | {} | no match |
| Laurence Guy — Saw You... | instrumental | null | deep house | no match |
| Brock Berrigan — Crossing Paths | instrumental | n/a (not in ReccoBeats) | funk, beats, instrumental hip-hop | matched 100%; page says "This song is an instrumental"; parse error today |

## Goals / Non-Goals

- **Goal**: separate lyrical / instrumental / unknown reliably enough that the
  panel never shows "couldn't find enough" for a song we *can* describe.
- **Goal**: fix the ambiguity at the lyrics-fetch layer, where the signal is
  authoritative, not after the fact.
- **Goal**: guarantee the enrichment loop converges — every song eventually
  reaches a final state (enriched, terminal, or honestly unknown) and a blocked
  song can never hot-loop the worker.
- **Non-Goal**: a perfect binary "is it instrumental." Laurence Guy proves it is
  not achievable from our data (no audio features, no instrumental genre tag) —
  unknown is a deliberate, honest third state, not a failure.
- **Non-Goal**: automating retries for unknown; we only record candidacy.

## Decision 1 — LRCLIB as the primary provider, Genius as fallback

LRCLIB (https://lrclib.net, no API key) returns, per track:
`{ instrumental: boolean, plainLyrics, syncedLyrics }`. That instrumental flag
is the authoritative signal Genius cannot give us. Order: **LRCLIB first**, fall
back to Genius only when LRCLIB has no record (404 `TrackNotFound`). Rationale:
LRCLIB both disambiguates (instrumental vs not-found) and has broader
non-English coverage; Genius remains a useful fallback for songs LRCLIB lacks.

API specifics that shape the integration:

- `GET /api/get` requires the **full track signature**: `track_name`,
  `artist_name`, `album_name`, and `duration` (seconds). LRCLIB only answers
  when the duration matches its record within **±2 seconds** — so duration is
  not optional metadata; the fetch path must carry it. `song` already has
  `album_name` and `duration_ms`; `BatchSong` gains both.
- `GET /api/search` (by `track_name` + `artist_name`) is the fallback when the
  exact signature misses; results are validated locally (duration within ±2s,
  names above the existing similarity floor) before acceptance.
- Requests include a `User-Agent` identifying the app and a project link, per
  LRCLIB's request (not mandatory, but good citizenship).
- `/api/get` may reach out to external sources on a miss (slow); acceptable for
  a background worker. `/api/get-cached` exists if latency ever matters.

`LyricsService` (`src/lib/domains/enrichment/lyrics/service.ts`,
`createLyricsService`) becomes provider-ordered and returns a typed outcome:

```ts
type LyricsOutcome =
  | { kind: "lyrics"; text: string; source: "lrclib" | "genius"; confidence: number }
  | { kind: "instrumental"; source: "lrclib" | "genius_page" }
  | { kind: "not_found" }
```

Follow existing patterns: class + factory + Result returns, TaggedError,
Zod-validated provider responses. No barrel exports.

## Decision 2 — Genius instrumental page is a confirmed-instrumental signal

The proposal's original premise ("Genius cannot distinguish") missed a third
Genius outcome, observed live on Crossing Paths: **match found, page exists,
no lyrics container, and the page explicitly renders "This song is an
instrumental."** Today `fetchLyrics` throws `GeniusParseError` on the missing
container, which the batch analyzer files as *unconfirmed / provider
unavailable* — a definitive "no lyrics exist" misread as a temporary outage,
retried every 6h forever.

Change: in the lyrics-page fetch, when the lyrics container
(`[data-lyrics-container="true"]`) is absent, check the fetched HTML for the
instrumental marker. Marker present → `{ kind: "instrumental", source:
"genius_page" }`. Marker absent → keep the parse error (a found page that
neither parses nor declares itself instrumental may be a layout change — that
*is* an unconfirmed provider problem).

This signal is the same trust tier as LRCLIB's flag: Genius states it
explicitly, and we already paid for the page fetch. It also covers tracks
LRCLIB doesn't carry, and (unlike genre keywords) needs no enrichment to have
succeeded first — the proposal's data shows ~91% of songs have no genres.

## Decision 3 — Classifier precedence (replaces detectInstrumental)

Decide in this fixed order; first hit wins:

1. **Confirmed-instrumental fetch outcome** — LRCLIB `instrumental: true` or
   the Genius instrumental page → instrumental (authoritative).
2. **Real lyrics in hand** (LRCLIB or Genius, above the word/confidence floor)
   → lyrical.
3. **Genre keyword match** against a curated instrumental set (instrumental,
   instrumental hip-hop, neoclassical, contemporary classical, classical,
   ambient, post-rock, …) → instrumental. Generic electronic tags (house,
   techno, deep house, electronic) are **excluded** — they are full of vocal
   tracks.
4. **instrumentalness ≥ 0.9** → instrumental (catches Daft Punk, which has no
   instrumental genre tag). High extreme only.
5. **Otherwise** → unknown.

instrumentalness below ~0.9 gets **no vote** — neither for nor against. This is
the crux: the data shows mid values misfire toward vocal (Need You Now 0.70)
and low values misfire toward instrumental (Saib 0.01). Only the high extreme
is trustworthy. `AnalyzeSongInput` already carries `genres?: string[]` and
`instrumentalness?: number`, so no signature change is needed for steps 3–4.

## Decision 4 — Spurious-match override

LRCLIB `instrumental: true` overrides a Genius lyric match below a confidence
floor (the Saib "in your arms" case: Genius returned words for a track LRCLIB
and its own genre tags call instrumental). A *high-confidence* Genius match is
still trusted as lyrical even if LRCLIB says instrumental (LRCLIB is
community-sourced and occasionally mislabels), so the override is gated on the
existing lyric match confidence from `utils/string-similarity.ts` /
`search-strategy.ts`.

## Decision 5 — Persistence

`unknown` must be representable; today an absent `song_lyrics` row means both
"no lyrics" and "never tried." Two options:

- **(A) Extend `song_lyrics`** with `fetch_status text`
  (`lyrics | instrumental | not_found`) + `source text`, and always write a row
  after a fetch attempt (an instrumental/not_found row carries an empty
  document). Smallest schema change; keeps the signal next to where it is
  produced.
- **(B) New `song_content_type` table** (`song_id, content_type, source,
  decided_at`) decoupled from lyrics. Cleaner separation, but a second source
  of truth to keep in sync with `song_lyrics`.

**Recommendation: (A).** The content type is a direct product of the lyrics
fetch; co-locating it avoids a sync problem and matches how the pipeline
already reasons ("does a `song_lyrics` row exist?"). The classifier's
genre/instrumental fallback (steps 3–4) is computed at analysis time and does
not need its own row — only the lyrics-fetch outcome is persisted; the final
routing decision is recomputed deterministically from
`{ fetch_status, genres, instrumentalness }`. The `source` column records
`lrclib | genius | genius_page`.

Migration via `supabase/migrations/` (never ad hoc), RLS stays deny-all.

## Decision 6 — Selector flags require inputs and honor suppression

`select_liked_song_ids_needing_enrichment_work` is the single answer to "does
this song still need work," and the incident showed its flags are not all
honest:

- `needs_embedding` is computed from "no `song_embedding` row" alone. But
  embedding's input is a `song_analysis` row — a song whose analysis is blocked
  is *not actionable* for embedding, yet the flag keeps the song (and the whole
  account) in the work queue. Fix: `needs_embedding` additionally requires
  `EXISTS (song_analysis)`, mirroring how `needs_content_activation` already
  gates on analysis.
- `needs_content_activation` is the only stage flag with **no**
  `job_item_failure` suppression branch — `CONTENT_ACTIVATION_FAILED`'s 6h
  suppression window is dead code today. Fix: add the same
  `NOT EXISTS (… suppress_until > now())` branch every other stage has.

The invariant after this decision: **a song is flagged for a stage only if the
stage could actually run now** (inputs exist, no active suppression). That
makes `hasMoreSongs` a truthful "there is attemptable work" probe rather than a
wish list. One new migration recreates the function; the selector remains the
single source of readiness + entitlement truth.

## Decision 7 — Blocked chunks stop; they do not complete-unsatisfied

Even with Decision 6, the loop *class* deserves a structural guard: any future
flag/stage mismatch would reproduce the incident. The runner gains a blocked
outcome:

- A chunk that **attempted zero songs across all stages** while the post-chunk
  probe still reports work owed is *blocked*, not complete. The worker reports
  `enrichment_stopped` with `reason = "blocked"` instead of
  `enrichment_completed(requestSatisfied: false)`.
- The reconciler already treats `enrichment_stopped` as
  stale-without-auto-reensure (V1 failure posture), so no reconciler change is
  needed beyond the reason union — the workflow stays owed and the next
  semantic change (sync, unlock, target save) re-arms it. With Decision 6 the
  blocked outcome should be rare; it exists as defense-in-depth.

Trade-off: a blocked account waits for the next semantic change rather than a
timer. That is the already-accepted posture for `error` stops, the escalation
in Decision 8 converges the song anyway, and an extension sync arrives
regularly in practice. A timer-based re-arm is explicitly out of scope.

## Decision 8 — Blocked failures are observable and convergent

Two gaps made the incident expensive to diagnose and impossible to self-heal:

- **Observability.** The blocked-skip buckets (`skippedUnconfirmedLyrics`,
  etc.) persist canned messages ("lyrics provider unavailable") and drop the
  underlying `GeniusError` — its class, HTTP status, and URL. `StageFailure`
  already carries `provider` / `statusCode` / `causeTag`; the batch analyzer
  threads the real error into those fields and into `error_message`
  (e.g. `GeniusParseError: no lyrics container — https://genius.com/…`). No
  schema change required.
- **Convergence.** "Unconfirmed" blocked codes (`analysis_blocked_*`) retry
  every 6h with no bound — a song that fails identically forever never reaches
  a final state. The failure-policy gains escalation: when the prior
  unresolved-failure count for the same (song, stage, code) reaches the
  threshold, the failure is recorded as terminal with
  `analysis_inputs_missing` semantics, which routes through the **existing**
  replacement-credit compensation (idempotent RPC) untouched. The prior-count
  lookup already exists for `BACKOFF_CODES`
  (`count_unresolved_job_item_failures`); blocked codes join it.

Threshold: **4 prior unresolved identical failures** (≈ a day of attempts at
the 6h cadence) — long enough to ride out a real provider outage, short enough
that a song cannot stay in purgatory for weeks. A single constant in
`failure-policy.ts`, covered by tests, adjustable without schema impact.

Note: with Decision 2 in place, Crossing Paths itself never reaches
escalation — the genius_page signal resolves it on the next attempt. Decisions
7–8 are for the cases nobody has found yet.

## Decision 9 — Presentation (three states → three surfaces)

In `SongDetailPanelSurface.tsx` `UnreadState`, the analyzing vs Quiet one
branch becomes three:

- **lyrical** → existing SongRead render (unchanged).
- **instrumental** → render the instrumental analysis
  (headline / compound_mood / sonic_texture / mood_description).
  `song-detail-adapter.ts` currently only safeParses `SongReadSchema` and drops
  everything else to `read = null`; it gains a parallel parse for
  `SongAnalysisInstrumentalSchema` so the panel has something to render. Copy
  follows the brand voice (sound-first, evocative).
- **unknown** → an honest, distinct copy ("We don't have the words for this one
  yet" — separate from a real read), flagged internally as a retry candidate.

This keeps the honest "couldn't find" only for the genuine unknown case and
stops penalising confirmed instrumentals.

## Risks / Trade-offs

- **LRCLIB coverage / mislabels**: community-sourced; some tracks missing or
  mistagged. Mitigated by Genius fallback and the confidence-gated override
  (Decision 4).
- **Genius page-marker fragility**: the instrumental marker is page copy, not
  API contract; Genius could reword it. Mitigated by treating marker-absent
  pages as parse errors (fail-safe to the unconfirmed path) and by LRCLIB
  being the primary signal; a snapshot test pins the current marker.
- **Genre-keyword recall**: real instrumentals without an instrumental tag
  (Daft Punk, Laurence Guy) slip past step 3 — step 4 catches Daft Punk;
  Laurence Guy correctly lands in unknown. Accepted: unknown is honest.
- **Selector behavior change**: gating `needs_embedding` on analysis means a
  song with permanently-terminal analysis never reappears for embedding — the
  desired behavior, but it changes `hasMoreSongs` semantics from "missing
  artifacts exist" to "attemptable work exists." Covered by integration tests
  on the recreated RPC.
- **Escalation false-positives**: a 4-failure ladder could terminalize a song
  during an extended provider outage. Acceptable: termination grants the
  replacement credit, and the existing manual-retry path
  (`resolve_job_item_stage_failures`) clears terminal state if the provider
  returns.
- **External dependency at fetch time**: one more network provider. Mitigated
  by existing rate-limiting/concurrency in LyricsService and the not_found
  short-circuit to Genius.

## Migration / Rollout

- Backfill is lazy: existing songs re-resolve on next enrichment; no bulk
  re-run required. The unknown/instrumental rows accrue as songs are unlocked.
- The selector migration takes effect immediately and is expected to *shrink*
  the work queue (blocked songs drop out); the incident account converges as
  soon as its stuck song stops being flagged for embedding.
- `instrumentalness` stays in `song_audio_feature` and stored analysis for
  matching/embeddings; only its *routing vote* is removed.
- Acceptance check on the incident data: account `612d2e86…` / song
  `b836987a…` ("Crossing Paths") must classify instrumental via genius_page (or
  LRCLIB), gain an instrumental analysis, and the worker loop must settle.
