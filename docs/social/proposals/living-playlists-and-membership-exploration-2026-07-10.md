---
status: proposed
updated: 2026-07-10
---

# Living playlists & the membership structure

## The problem this solves

Playlist creation from liked songs has a front-loaded value curve: a big burst
at onboarding (a years-deep backlog becomes 10–20 playlists), then a long
trickle while likes re-accumulate. A usage-metered subscription against that
curve is a churn machine — the rational user subscribes once, mines
everything, cancels. Static snapshots are the right v1, but they are also the
design decision that _creates_ the burstiness.

Living playlists are the recurring job: likes keep arriving (~5,300 in the
first third of July 2026 alone), and a playlist that understands why it exists
can keep absorbing them.

## What a living playlist is

A playlist whose stored match configuration keeps working after creation.

|                                                         | Snapshot (shipped)        | Living (this proposal)                          |
| ------------------------------------------------------- | ------------------------- | ----------------------------------------------- |
| Created from                                            | draft at `/playlists/new` | same                                            |
| Config (`match_intent`, `genre_pills`, `match_filters`) | persisted at commit       | same rows, now _active_                         |
| After creation                                          | frozen; never changes     | new likes matching the config surface over time |
| Spotify side                                            | static playlist           | same playlist, grows via extension adds         |

The persistence layer already exists — `persistNewPlaylistConfig` writes the
intent/pills/filters onto the playlist row precisely so a committed draft
becomes a _managed_ playlist, and the matching engine already serves
suggestions to configured playlists. Living playlists are that machinery run
forward in time instead of once.

## Mechanics

1. **Ingest** — new likes sync as today; Phase-1 (genres, audio features) is
   ungated and runs for everyone; deep analysis + embeddings run for members
   (entitlement-gated, as today).
2. **Match** — enriched new likes are scored against each living playlist's
   stored profile (same scorer as the draft engine; embedding path for
   members).
3. **Queue** — matches land in a per-playlist suggestion queue
   (`match_decision` already models served/added/dismissed, so committed and
   dismissed songs never resurface).
4. **Surface** — two cadences, user-chosen per playlist:
   - **Digest (default):** periodic "14 new likes match _rainy late-night
     drive_" — review, add, dismiss. Human-in-the-loop matches the
     draft-first philosophy.
   - **Auto-add:** high-confidence matches flow straight to Spotify via the
     extension, with an undo window.
5. **Freeze on lapse** — if membership lapses, nothing breaks: playlists stop
   growing and keep everything they have. Lapsed-but-intact matters because
   re-subscription is the most likely revenue event for bursty usage;
   punishing lapse poisons it.

The recurring cue is free: accumulating likes. "You've liked 87 songs since
your last session — enough for two new playlists" is a re-engagement trigger
the data already contains.

## How it should look

- **Playlist page**: a "Living" state on managed playlists — the stored intent
  phrase shown as the playlist's reason for existing, plus a pending-
  suggestions tray (reuse the `/playlists/new` suggestions tray pattern: soft
  refresh, optimistic add, highlight pulse).
- **Digest**: one periodic notification/email across all living playlists, not
  one per playlist. Deep-links into each playlist's suggestion tray.
- **Creation flow**: at commit time on `/playlists/new`, a single choice —
  "Keep this playlist growing" (member) vs "Create as snapshot" (everyone).
  This is also where free users _see_ the member feature concretely: their
  playlists freeze at birth; members' playlists live.
- **Lapse state**: a quiet "paused" badge, never a broken one.

## The structure it belongs to: membership, not metering

hearted's long-term shape is a music community (public liked-songs jukebox,
music-history learning, last.fm expansion) built around the love of liked
songs. That is patronage economics — the Letterboxd model — not SaaS metering.
People renew a membership in months they barely use it because they are buying
belonging and sustaining a thing they want to exist, not units of usage. This
dissolves the burstiness problem entirely.

The cost structure genuinely supports the framing: `song_analysis` is a global
cache keyed by song, so every member's library enriches the catalog for
everyone (measured: ~9% realized subsidy at 25 accounts, climbing ~7×
month-over-month; 0.85–1.27¢ per analysis; see the subsidy analysis doc).
"Your Backstage Pass helps analyze the catalog for everyone" is literally
true.

### Free

- Phase-1 enrichment for the whole library
- Full playlist creation: pills, filters, deterministic scoring, live Spotify creation — everything on the `feat/playlist-creation-from-liked-songs` branch except intent
- Snapshot playlists forever
- Later: public jukebox and history content

### Backstage Pass — the membership (yearly, $39.99)

The compute-expensive magic plus membership goods:

- Intent phrase + AI-reranked drafts (deep analysis + embeddings)
- **Living playlists** — the flagship visible difference
- Whole-library deep understanding as a background perk, not the price fence
- As community ships: public profile/jukebox presence, supporter identity,
  early access

Yearly-only is deliberate (quarterly is already disabled): membership
psychology is annual. Song packs become legacy or fold into an optional
one-time "analyze my library" escape hatch for the subscription-averse — kept
only if it doesn't muddy the story. The intent gate's `>= 1000 unlocks` clause
retires with the packs.

The discipline this demands: free must stay excellent, and the _felt_
difference must stay visible. Living playlists carry that weight — free users
can see exactly what membership adds every time their snapshot doesn't grow.

## Growth directions that strengthen the concept

Ordered roughly by how directly each compounds the core (liked songs as
identity, the shared catalog as commons). Each has its own exploration doc
in this folder; the entries below are the index:

1. **Public jukebox / shared liked-songs profiles** (planned; see
   `public-liked-songs-sharing-exploration-2026-06-02.md` in this folder) —
   liked songs as a public identity artifact. The keystone of the list: it is
   what makes every other feature here _social_ rather than solo (neighbors
   need profiles to point at, blends need people to find each other, recaps
   want an audience). Every library shared makes the commons more explorable
   and the membership more like belonging.
2. **Taste neighbors** (`taste-neighbors-exploration-2026-07-10.md`) — "who
   else likes this song / how much do our libraries overlap." The
   likers-of-song selectors and the pairwise-overlap data already exist; the
   subsidy analysis measured 2–10% pairwise overlap. This is the community's
   discovery engine and the bridge from tool to network.
3. **Blend playlists** (`blend-playlists-exploration-2026-07-10.md`) — a
   living playlist whose candidate pool is two members' libraries. Only
   possible here, not in Spotify's blends, because the profile is
   intent-driven. Strong invite loop: blending requires the other person to
   join.
4. **Rewind / time capsules**
   (`rewind-time-capsules-exploration-2026-07-10.md`) — "your likes, summer
   2019." `liked_at` is a personal music diary nobody else treats as one;
   drafts seeded by era are pure deterministic scoring, so this works fully
   on the free tier — and it re-triggers the creation burst repeatedly from
   data that already exists, with no new pipeline work.
5. **Monthly recap** (`monthly-recap-exploration-2026-07-10.md`) — "your
   month in likes": new genres, drift from your baseline, one auto-drafted
   playlist. Wrapped-cadence retention without waiting for December; the
   digest infrastructure does double duty.
6. **The story of your library**
   (`story-of-your-library-exploration-2026-07-10.md`) — the learning vision,
   but anchored in _their_ songs: genre lineages walked through the user's own
   genres, scenes and eras connected to what they already love. The
   `song_analysis` JSONB is the raw material; members get depth, everyone gets
   taste.
7. **Last.fm / listening-history import**
   (`lastfm-import-exploration-2026-07-10.md`) — deepens the signal beyond
   likes (a like is intent; a scrobble is behavior) and widens who can
   onboard. Feeds every feature above.

Common thread: each one either makes the commons richer (1, 2, 7), gives the
recurring cue more to say (4, 5), or makes membership more like identity
(2, 3, 6). None of them are usage meters.

### Suggested sequencing

Two first moves, chosen for leverage per effort:

- **Rewind first** — cheapest to ship (existing data, deterministic scoring,
  free tier), and it re-engages the current user base _now_, before any
  community exists.
- **Taste neighbors second** — the first genuinely social surface. Shipping it
  ahead of the jukebox means the jukebox launches into a graph that already
  has edges ("you share 8% with this library") instead of a directory of
  strangers, so the keystone lands harder.

Blends follow neighbors naturally (they need the pairing UI anyway); recap
waits for the living-playlist digest infrastructure it reuses; the history
layer and last.fm import are independent tracks that can slot in whenever
depth or onboarding-width becomes the priority.

## Open questions

- Community access: free-with-membership-as-support (Letterboxd's answer,
  grows the commons faster) vs the community itself as the gated club (more
  literally "backstage"). Current lean: the first.
- Auto-add trust: what confidence threshold earns auto-add, and does it need a
  per-playlist "strictness" control?
- Digest cadence: weekly vs "when enough matches accumulate" (count-triggered
  beats time-triggered for bursty likers).
- Does the one-time "analyze my library" escape hatch survive, or is one
  currency worth more than the edge case it serves?
