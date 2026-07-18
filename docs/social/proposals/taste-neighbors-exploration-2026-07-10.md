---
status: proposed
updated: 2026-07-10
---

# Taste neighbors — exploration

Library-overlap discovery: "you and @handle share 8% of your libraries," and
per-song, "12 other people love this song." The bridge from tool to network —
the first surface where another hearted user's existence makes *your* hearted
better.

Sibling of `public-liked-songs-sharing-exploration-2026-06-02.md` (profiles to
point at) and `living-playlists-and-membership-exploration-2026-07-10.md`
(the membership frame). Feeds `blend-playlists-exploration-2026-07-10.md`
directly.

## The problem this solves

The jukebox and public sharing give people profiles, but a directory of
strangers has no gravity. Nobody browses profiles for fun; they follow
*edges* — "this person's taste overlaps mine." Neighbors create the edges
before the social graph exists, so the community launches into a network
instead of an empty room. It is also the feature that makes the shared
catalog *felt*: the same `song_id` dedup that powers the cost subsidy becomes
visible as "who else loves this."

## What already exists

- The catalog is global: `liked_song` rows point accounts at shared `song`
  rows, so overlap is a single self-join — no new data model.
- Likers-of-song selectors already exist in the matching domain ("entitled
  likers of song"), built for candidate sourcing; the read shape is the same.
- The subsidy analysis measured real pairwise overlap at 2–10% of the smaller
  library (25 accounts), with one 39% outlier pair — enough signal to rank
  neighbors even at current scale.
- Consent infrastructure: the public-sharing toggle establishes the opt-in
  pattern (deliberate act, OFF by default, deny-all RLS preserved via
  service-role reads).

## Mechanics

1. **Participation is opt-in and symmetric.** Only accounts that opted into
   sharing (the existing toggle, or a dedicated "discoverable" flag — open
   question) enter the neighbor graph. You cannot see overlap with someone
   who can't see overlap with you. Private libraries never leak, not even as
   an anonymous count.
2. **Overlap metric: rarity-weighted, not raw.** Raw shared-song counts are
   Zipf-polluted — everyone shares the hits, so raw overlap measures
   mainstream-ness, not affinity. Weight each shared song by inverse
   popularity (few likers → strong signal), TF-IDF style. Two people sharing
   30 obscure shoegaze B-sides are neighbors; two people sharing 30 chart
   toppers are strangers. Report both numbers ("214 songs, affinity 8.2%")
   but *rank* by the weighted one.
3. **Computation**: a periodic materialized pairwise-overlap job over opted-in
   accounts (n is small for a long time; even at thousands of accounts the
   opted-in × opted-in join with a min-overlap floor is cheap). Per-song
   liker counts are a trivial aggregate. Per CLAUDE.md, any account-scoped
   read pushes the predicate into an RPC — no id-list round-trips.
4. **Surfaces feed other features**: the neighbor list is the partner picker
   for blends; neighbor libraries are the candidate pool for "songs you might
   love" (songs your closest neighbors love that you haven't heard — the
   commons as a discovery engine).

## How it should look

- **On a song row** (own library or public pages): a quiet "loved by 12
  people" affordance — tapping shows opted-in likers as @handles. This is the
  lowest-effort, highest-warmth surface; ship it first.
- **Neighbors page**: ranked list of @handles with overlap stats, the shared
  songs browsable, and one highlighted "rarest thing you share" (the single
  most improbable common song — the moment of delight this feature exists
  for).
- **On a public profile**: "your overlap with @handle" banner when the viewer
  is signed in and opted in.
- Tone per the voice guide: warm, never gamified leaderboards — affinity, not
  competition.

## Tier placement

Discovery participation should be **free** — the graph's value is its
density, and gating membership in the graph starves it (same logic as the
subsidy: every library makes the commons richer, gated or not). The
**member** layer is depth: the full neighbor explorer, per-genre overlap
breakdowns, and "songs to steal from your neighbors" recommendations (which
ride the deep-analysis/embedding machinery members already fund).

## How it strengthens the concept

It converts the cost-structure fact (shared catalog) into a product fact
(shared taste), makes public sharing worth turning on (opting in now *gets*
you something: neighbors), and hands blends their invite flow. It is the
cheapest possible "hearted is a community" proof.

## Open questions

- Consent surface: reuse the public-sharing toggle, or a separate
  "discoverable to neighbors" flag? (Sharing your library page publicly and
  appearing in overlap rankings are different exposure levels; lean:
  separate flag, both OFF by default.)
- Minimum-overlap floor before a pair is shown (absolute count vs weighted
  score) — below it, show nothing rather than embarrassing 0.3% matches.
- Does the anonymous *count* ("loved by 12") include non-discoverable
  accounts? Lean no — simpler privacy story: invisible means invisible.
- Cold start honesty: at 25 accounts the neighbor list is thin. Acceptable to
  ship behind the sharing rollout and let acquisition-by-taste-community
  (which clusters overlap) fill it in?
