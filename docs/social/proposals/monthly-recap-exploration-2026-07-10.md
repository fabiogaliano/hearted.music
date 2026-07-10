---
status: proposed
updated: 2026-07-10
---

# Monthly recap — exploration

"Your month in likes": what you fell for, how your taste drifted, and one
auto-drafted playlist to keep — Wrapped's emotional payoff at a monthly
cadence, built from likes (intent) rather than plays (behavior).

Sibling of `rewind-time-capsules-exploration-2026-07-10.md` (same diary,
ongoing cadence instead of retrospective) and reuses the digest
infrastructure defined in
`living-playlists-and-membership-exploration-2026-07-10.md`.

## The problem this solves

Spotify Wrapped proves people crave a rendered reflection of their listening
self — then delivers it once a year, about behavior, owned by an algorithm.
hearted sits on the better dataset for this: a like is a *choice*. A monthly
recap gives the product a heartbeat between creation bursts — a reason to
open hearted every month that requires no new likes-derived feature work
from the user's side, only that they kept living with music.

## What already exists

- **All the signals are Phase-1, i.e. free-tier and already computed**: genre
  distributions (`blendGenreDistribution` is the exact primitive), audio
  feature centroids (energy/valence/etc.), like counts and timing.
- The month's playlist is a **rewind capsule with a one-month window** —
  the same preset-`likedAt` draft, auto-assembled.
- The delivery channel is the living-playlists **digest**: recap and digest
  are one monthly artifact, not two notifications ("your playlists grew by
  14 songs; here's your month in likes").
- `song_analysis` JSONB exists for enriched songs when a member's recap
  wants qualitative color.

## Mechanics

1. **Compute (deterministic, cheap)**: for the month's likes — count, top
   genres, *new* genres (first-ever appearance in the library: the single
   most interesting stat), audio-centroid drift vs the library baseline
   ("your month ran 20% higher energy"), the rarest like (fewest global
   likers — ties into taste neighbors), longest liking streak/burst.
2. **The auto-draft**: assemble the month's playlist via the draft engine
   (deterministic path), present it as a *draft to accept*, not a playlist
   silently created — one tap commits it through the normal extension path.
   Human-in-the-loop matches the draft-first philosophy; nobody wants
   twelve unasked-for playlists a year.
3. **Skip threshold**: a month with 4 likes gets no recap (or a gentle
   combined "last two months" when the next month has volume). A sparse
   recap reads as an insult; silence reads as taste.
4. **Member layer**: one LLM-written month summary — a few sentences of
   qualitative narrative grounded in the analyses ("you spent March in
   slow, reverb-heavy rooms") — plus intent-aware framing. Marginal cost is
   one small call per member-month; the deterministic recap needs none.

## How it should look

- **A recap card**: one screen, designed to be screenshotted — hearted's
  aesthetic is the distribution mechanism. Stats minimal and human ("3 new
  genres. Your rarest like: …"), the auto-draft playlist at the bottom with
  an accept button.
- **In-app first**, notification/email second (channel decision is shared
  with the digest open question).
- **Later, social**: an opt-in public recap at `/@handle/recap/2026-06`
  riding the public-sharing architecture (unauthenticated server fn,
  service-role read, noindex default) — recaps are the jukebox's natural
  monthly content drop.

## Tier placement

The deterministic recap + accept-a-draft: **free** — it's a retention loop
and a monthly proof the product knows you, which is the best membership ad
there is. **Member**: the narrative summary, intent-aware drafts, and the
richer drill-down (drift charts over many months). The recap card itself can
carry one quiet locked line ("what this month *meant* — Backstage") — the
show-then-lock pattern already proven by the intent editor.

## How it strengthens the concept

Gives the recurring cue a voice on a fixed calendar (the burstiness answer
for months when no playlist wants creating), reuses three existing systems
(draft engine, digest, capsule window) rather than adding one, and produces
the shareable artifact that feeds the jukebox monthly once social ships.

## Open questions

- Channel: in-app only until email infra exists, or is email the whole point
  (recaps die if nobody's reminded)? Shared decision with the digest.
- Baseline definition for "drift": whole-library vs trailing-12-months
  (whole-library makes drift invisible for old libraries; lean trailing).
- Recap month boundary: calendar month vs rolling 30 days since last recap
  (calendar is shareable and social-synchronized; lean calendar).
- Does the public recap wait for handle-identity + sharing, or does a
  non-public share-image (rendered card, no URL) ship sooner?
