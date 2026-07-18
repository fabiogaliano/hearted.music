---
status: proposed
updated: 2026-07-10
---

# Last.fm import — exploration

Bring listening history (scrobbles) in beside liked songs. The two signals
answer different questions — **a like is intent** ("this is mine"), **a
scrobble is behavior** ("this is what actually happened") — and every scorer,
recap, capsule, and neighbor calculation gets sharper with both. It also
widens the front door: people with years of scrobbles but messy Spotify
libraries currently have no way into hearted.

Sibling of `living-playlists-and-membership-exploration-2026-07-10.md`
(listed there as an independent track) and a force multiplier for
`rewind-time-capsules-exploration-2026-07-10.md`,
`monthly-recap-exploration-2026-07-10.md`, and
`taste-neighbors-exploration-2026-07-10.md`.

## The problem this solves

Two problems, one integration:

1. **Signal depth.** Likes are sparse and binary. Scrobbles add magnitude
   (played 400 times vs twice) and *fidelity checks* (liked but never
   played — aspirational; played constantly but never liked — a blind spot
   in the library, and the best "you should like this" candidate that
   exists). The scorer currently cannot distinguish a user's actual
   heavy-rotation from a one-week fling.
2. **Onboarding width.** hearted's entry requirement today is a well-tended
   Spotify liked-songs library. Last.fm users are, almost by definition,
   people who care about their music history — the exact target user — and
   many of them keep their real signal in scrobbles, not likes.

## What already exists / what's genuinely new

- The last.fm API is public and username-based — reading someone's scrobbles
  needs no OAuth, just their (public) username. Import is low-friction.
- The global `song` catalog and Phase-1 enrichment apply unchanged once a
  scrobble is matched to a catalog song.
- **Genuinely new: the matching problem.** Scrobbles arrive as artist/title
  strings (with MusicBrainz IDs when lucky), not Spotify IDs. Mapping them
  onto `song` rows is fuzzy matching at scale — remaster suffixes, live
  versions, feat. credits. This is the real engineering cost of the whole
  feature and should be prototyped first, because match quality bounds
  everything downstream.
- **Volume**: a 15-year scrobbler has hundreds of thousands to millions of
  events. Store **aggregates per (account, song)** — play count, first/last
  played, per-era buckets — not raw events. Raw scrobbles are re-fetchable
  from last.fm; hearted only needs the shape.

## Mechanics

1. **Import**: enter a last.fm username → backfill aggregates via the API
   (rate-limited, resumable job through the existing job/reconciler
   machinery) → match to catalog songs, parking unmatched rows for later
   passes as the catalog grows.
2. **Scrobbles never become likes.** They are a parallel signal: separate
   table, separate semantics. Conflating them would corrupt the product's
   core object (the library as *chosen*). Instead, behavior surfaces as
   context on liked songs and as candidates ("your most-played unliked
   songs — heart the ones that belong").
3. **Scoring**: an optional behavior term in the matching profile — presence
   confirmed by play data nudges a song up; "liked, never played" flags
   aspirational picks (which some playlists *want* — an intent phrase like
   "songs I keep meaning to get into" becomes possible).
4. **Continuous sync** (later): periodic top-up of recent scrobbles, feeding
   the recap ("most-played this month" beside "liked this month") and the
   living-playlist queue.

## How it should look

- **Import flow**: one field (username), a progress state honest about the
  long tail ("matched 78% of your history; the rest keeps matching as the
  catalog grows"), and one immediate payoff screen — your played/liked
  overlap, your most-played unliked song — so the import ends in a moment,
  not a settings toggle.
- **On song rows**: a quiet play-count glyph where behavior data exists.
- **The reconciliation surface**: "heavy rotation you never hearted" as a
  one-tap hearting queue — the fastest library-improvement loop in the app,
  and it feeds every other feature.

## Tier placement

Import and the reconciliation queue: **free** — it is an acquisition funnel
and it improves the library, which improves the commons. Behavior-weighted
scoring and intent phrases that lean on behavior ride the existing member
gate (they live inside the deep-scoring path anyway). Continuous sync is a
reasonable member perk (ongoing compute, ongoing value — same shape as
living playlists).

## How it strengthens the concept

Deepens every scorer with a second orthogonal signal, widens onboarding to
the highest-affinity audience outside Spotify power users, makes recaps and
capsules richer (what you *played* that summer vs what you claimed), and
extends the identity story — hearted as the home of your whole musical
record, not just one platform's like button.

## Open questions

- Match strategy: MusicBrainz ID → exact string → normalized fuzzy, with
  what confidence floor? Prototype against a real 100k-scrobble account
  before committing to any downstream feature.
- Do unmatched scrobbles ever surface ("we couldn't find these 900 songs"),
  or fail silently? Lean: a count with no wall of shame.
- Is Spotify listening history (recently-played via the extension) a sibling
  source later, or does last.fm's depth make it the only one worth having?
- Aggregate granularity: per-song totals + yearly buckets is probably
  enough; monthly buckets triple the rows for marginal recap gain.
- Does import without any Spotify connection constitute a valid degraded
  account (browse/learn but no playlist commit)? That decides how wide the
  front door really opens.
