---
status: proposed
updated: 2026-07-10
---

# Blend playlists — exploration

A playlist drafted from **two members' libraries at once**, with a shared
intent — "our rainy-drive songs" — that can then keep living as both people's
likes grow. Spotify's Blend is algorithmic and opaque, built on listening
behavior; this is deliberate and intent-driven, built on *liked* songs — the
stronger signal of what someone actually claims as theirs.

Depends on `taste-neighbors-exploration-2026-07-10.md` (the partner picker)
and `living-playlists-and-membership-exploration-2026-07-10.md` (the living
cadence). Sits in the membership frame of the latter.

## The problem this solves

Everything in hearted so far is solo. The jukebox and neighbors let people
*see* each other; blends are the first thing two people *make* together —
the difference between a community that browses and one that collaborates.
It is also the product's only natural invite loop: a blend invite sent to a
non-user is a reason to join that no landing page can match ("make this
playlist with me" beats "analyze your library").

## What already exists

The draft engine was built candidate-pool-agnostic: `filterCandidates` →
profile → `scoreCandidates` → `assembleDraft` operates on whatever
`Phase1Candidate[]` it is handed. A blend is, mechanically, **the same
pipeline with a union candidate pool** from two accounts' Phase-1 loads.
The commit path (extension create + `persistNewPlaylistConfig` +
`match_decision` recording) and the living-playlist queue reuse unchanged.
The genuinely new work is consent, attribution, and balance — social
problems, not pipeline problems.

## Mechanics

1. **Initiation**: pick a partner from the neighbors list (or send an invite
   link to a non-user — the acquisition path). Partner must accept; a blend
   is always bilateral consent, revocable by either side.
2. **Candidate pool**: union of both accounts' Phase-1 candidates, each
   tagged with its source account. Filters apply per the shared config;
   either person's pins are respected.
3. **Balance is a scoring concern, not an afterthought.** Unconstrained
   scoring lets the larger or better-enriched library dominate. Assemble
   with a source quota (soft alternation toward ~50/50, relaxing only when
   one side's eligible pool runs dry) so the playlist *feels* like both
   people. Songs both people like are gold — always surface them first and
   badge them ("you both love this").
4. **Living cadence**: both members' new likes feed the suggestion queue;
   the digest goes to both; adds require one accept (either person) — a
   blend that needs two approvals per song dies of friction.
5. **Spotify side**: one real playlist created on the initiator's account via
   the extension; the partner gets the link (Spotify follow covers the
   "mine too" need). Mirroring two copies doubles the write surface for
   marginal gain — v0 says no.
6. **Entitlement**: the deep pass needs at least one member (their Pass funds
   the analysis of both pools — the shared catalog makes this literally
   cheaper: overlapping songs are analyzed once). Living blends require the
   *initiator* to be a member; the partner can be free. This makes every
   blend a soft membership advertisement to the free partner.

## How it should look

- **Creation**: the `/playlists/new` surface with a partner chip at the top;
  preview rows carry a small avatar dot for source (whose song is whose),
  and shared songs get the "you both" badge. Two-column identity, one list.
- **Invite**: a public invite page (unauthenticated server-fn pattern from
  the sharing doc — no RLS changes) showing the initiator's @handle, the
  intent phrase, and a taste of their library; accept = sign up + connect.
- **The blend page**: both @handles as co-owners, the intent as the
  playlist's reason for existing, the pending-suggestions tray showing whose
  like each suggestion came from.

## Tier placement

Creating a one-off blend snapshot: **free for both** (it is the invite loop —
gating it strangles acquisition). **Living** blends and the AI/intent layer:
require the initiator to be a member, consistent with living playlists
generally. The asymmetry is deliberate: free users experience membership
through their member friends.

## How it strengthens the concept

The invite loop (only growth feature with built-in distribution), the first
collaborative artifact (community that makes things), and the clearest
"only hearted" story — Spotify cannot do intent-driven blends from liked
songs, and last.fm never made anything together.

## Open questions

- More than two people? Group blends are tempting (road-trip playlist) but
  quota balancing and consent get combinatorial; v0 is strictly pairs.
- What happens on revoke/un-share: freeze the blend (lapse semantics, like
  membership) vs remove the revoker's songs? Lean freeze — never
  retroactively hollow out a playlist someone is listening to.
- Invite-link abuse: rate limits and expiry per the sharing doc's §11
  patterns.
- Does the partner picker require neighbors, or is a bare @handle enough?
  (Neighbors first is warmer; handles-only unblocks blending with your
  actual friends who just joined and share no history yet. Probably both.)
