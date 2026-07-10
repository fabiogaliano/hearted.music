---
status: proposed
updated: 2026-07-10
---

# Rewind / time capsules — exploration

"Your likes, summer 2019." `liked_at` is a personal music diary that no other
product treats as one — Spotify shows a flat reverse-chronological list and
throws the shape of the data away. Rewind turns eras of that diary into
playlists, using machinery that already shipped.

Sibling of `living-playlists-and-membership-exploration-2026-07-10.md`
(listed there as the cheapest first move) and feeds
`monthly-recap-exploration-2026-07-10.md` (same data, ongoing cadence).

## The problem this solves

Playlist creation from a backlog is bursty: after the onboarding burst, users
have no reason to return until likes re-accumulate. Rewind re-triggers the
creation burst **from data that already exists** — a 4,000-song library
contains dozens of latent playlists sliced by time, each one emotionally
loaded in a way genre slices aren't ("the songs from the year I moved" beats
"my indie songs"). It is re-engagement for the current user base, shippable
before any community exists.

## What already exists — this is nearly free

- The match-filters V1 schema already includes a **liked-at range**, and
  `SongFilterMetadata.likedAt` flows through `passesAllMatchFilters` in the
  draft engine. A time capsule is literally a draft with a `likedAt` window
  preset.
- Deterministic scoring (`noEmbeddingMode`) means the whole feature works on
  the **free tier** with Phase-1 data only. Zero new pipeline, zero marginal
  LLM cost.
- The commit path (extension create, config persist) is unchanged — a capsule
  is just a snapshot playlist whose config happens to be a time window.

The new work is *framing*: era detection, entry points, and naming — product
surface, not engine.

## Mechanics

1. **Era detection**: two complementary modes.
   - **Calendar eras** (trivial): years, seasons, "Summer 2019". Predictable,
     always available.
   - **Burst eras** (the delightful one): density clustering on `liked_at` —
     a spike of liking is usually a life chapter (new relationship, new city,
     a festival, one obsessive week). Detect bursts, label them by dominant
     genres + date ("your March 2023 drum-and-bass week"), offer each as a
     one-tap draft.
2. **One data caveat**: `liked_at` comes from Spotify's `added_at`, which is
   genuine for organically-built libraries but collapses for bulk imports
   (the subsidy analysis flagged one account with a 100% pre-existed rate —
   a re-import smell; its `liked_at` values cluster at import time). Era
   detection should detect the degenerate single-spike shape and fall back
   to calendar mode quietly instead of offering "your entire life: one week
   in June."
3. **Seeded drafts**: tapping an era opens `/playlists/new` with the
   `likedAt` filter and a suggested name prefilled; the user is in the
   familiar draft flow, everything editable. No new creation surface.
4. **Anniversary cues**: "five years ago this week you liked…" — a recurring,
   personal, zero-cost re-engagement trigger from the same column. Feeds the
   digest/notification channel the living-playlists doc defines.

## How it should look

- **A timeline strip on the Liked Songs page**: like-density over time as a
  small area chart; bursts visibly bulge; tapping a region seeds a capsule
  draft. The chart alone teaches people their library *has* a shape — that
  moment is the feature's hook.
- **Capsule naming**: auto-suggest `"<era>: <dominant genre feel>"` from
  Phase-1 genre distribution ("2019: indie summer"), always editable —
  the name is half the artifact's charm.
- **Seasonal prompts**: at most a few per year ("your songs from last
  summer, one year on") — cue, not spam.
- Later, social: a capsule is inherently shareable ("what I sounded like in
  2019") — a natural jukebox/public-profile artifact once those ship.

## Tier placement

**Free, fully.** Deterministic scoring, existing data, and it strengthens the
free tier's lovability, which the membership model depends on. The member
layer arrives only where intent does: "my heartbreak songs from 2019" is a
time window *plus* an intent phrase — the existing intent gate composes with
capsules for free, no new gating logic.

## How it strengthens the concept

Cheapest item on the growth list (existing data, existing engine, no new
pipeline), converts burstiness from a monetization problem into a content
source, gives the recurring cue something personal to say, and produces the
product's most shareable artifact so far — a bridge to the social layer that
requires none of it to exist yet.

## Open questions

- Burst detection parameters: window size, density threshold, minimum songs
  per era (an era with 9 songs isn't a playlist — fold it into its calendar
  neighbor?).
- Does the timeline strip live on Liked Songs, on `/playlists/new`, or both?
  (Lean: Liked Songs owns the diary; `/playlists/new` gets an "eras" pill
  row.)
- Notification channel for anniversary cues — shared open question with the
  living-playlists digest (no email infra decision yet).
- Should capsules default to snapshot even for members? (Lean yes — a time
  capsule is definitionally frozen; a "living 2019 playlist" is an oxymoron
  unless late-liked old songs should count, which is its own debate.)
