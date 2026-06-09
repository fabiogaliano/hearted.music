# Social Feed Exploration — "the hearted Jukebox"

> Status: **exploration / concept-locked, not yet specced for implementation.**
> Date: 2026-06-02. Inspiration: <https://www.godsjukebox.com/> ("a living playlist
> of hand-picked tracks, recommended by real people, not algorithms").

A minimal social layer inside hearted where a signed-in user can deliberately
**share a song they've hearted** to a feed visible to other signed-in hearted
users, who can react to it.

---

## 1. The thesis (why this is novel for hearted)

> **You can only share a song you've actually hearted, and sharing is a separate,
> deliberate act from hearting.**

- The heart is a pre-existing, sincere signal (`liked_song.liked_at` is the real
  Spotify heart timestamp). It makes a song *eligible* to share.
- Sharing is an intentional publication on top of that eligibility. This is
  **not** an "everything I liked" lifelog — the user picks.
- Result: a feed that is structurally incapable of performative spam — every post
  is provenance-backed by a genuine save. That's the differentiator vs. God's
  Jukebox (manual picks, no provenance) and vs. algorithmic music-social.

Guiding principle, one line: **hearting = eligibility (private). sharing =
publication (deliberate).**

---

## 2. Locked decisions

| Dimension | Decision | Notes |
|---|---|---|
| **Audience** | Signed-in hearted users only — *not* the open internet | Lives under `_authenticated`; no anonymous route; sealed DB untouched |
| **Feed model** | **Timeline of shares** (event-centric) | Reverse-chronological; same song may appear from multiple users; a reaction attaches to each individual share |
| **Scope** | **Feed + reactions** | No follow graph, no profiles, no comments in v0 |
| **Post unit** | **Song only** | No caption / free text → near-zero content moderation |
| **Source** | **Only songs you've hearted** | `shareSong()` verifies an active `liked_song` for (account, song) server-side |
| **Share entry points** | **Both**: (1) quick-share from the Liked Songs surface, (2) a "share a song" picker on the home feed | Auto-post-on-heart was rejected — intentionality matters |
| **Un-heart behavior** | **Share stays as a moment** | A share is a timestamped historical event; later un-hearting does not retract it; reactions preserved |
| **Identity** | **App-owned handle** — unique namespace, seeded from provider name, editable | See §3 |
| **Playback** | Reuse `SpotifyEmbedIframe` | Already works in `/matching`, already CSP-whitelisted |
| **Placement** | A section on the dashboard **home** (`/dashboard`) | A dedicated full-feed route can come later |

---

## 3. Identity: provider-agnostic handle (solves the collision worry)

**Problem raised:** "use the Spotify username — but if Last.fm / Apple Music link
later, and my Last.fm name equals another user's Spotify name, they collide."

**Resolution:** never let a *provider* own the public identity.

- Add a single **`handle`** to `account`, **unique across the whole app**
  (one namespace, case-insensitive — unique index on `lower(handle)` or `citext`).
- On first share, **seed a suggestion** from the Spotify display name, run it
  through a normalizer + uniqueness check (`fabio` taken → offer `fabio.galiano`,
  `fabio2`, …). User confirms/edits before save.
- Provider usernames are **inputs to a one-time suggestion**; the handle is the
  **output and source of truth**. Uniqueness lives only on the output, so the
  same provider name across providers/users can never collide.
- Optional secondary metadata later: "listens on Spotify as X / Last.fm as Y" —
  display-only, never unique, never the identity.

**Symmetry worth keeping in mind for the multi-provider future:**
- `handle` = provider-agnostic identity for a **person**.
- `song.isrc` (already a column!) = provider-agnostic identity for a **song**
  (same track across Spotify/Apple/Tidal).

So multi-provider support later is a data-mapping job, not a redesign.

Avatar: default to the existing `account.image_url` (Google avatar); define a
precedence order if/when multiple providers offer one.

---

## 4. Architecture — fits the existing patterns exactly

Because the feed is **authed-users-only**, there is no anonymous DB exposure. It
uses the same machinery already in the codebase:

- All access via `service_role` server functions guarded by `authMiddleware`
  (template: `src/lib/server/liked-songs.functions.ts`).
- All new tables keep **`deny_all` RLS** + `anon` revoked → the security-invariant
  test (`src/lib/data/__tests__/security-invariants.integration.test.ts`) stays
  green with no special handling.
- Cursor-based infinite pagination via TanStack Query
  (template: `src/features/liked-songs/queries.ts`, cursor = timestamp).
- Rich page rows assembled in a Postgres RPC
  (template: `get_liked_songs_page`).

**Cross-user projection rule:** when user A views user B's share, the server
function must SELECT only B's *safe* fields (handle, avatar, song metadata,
shared_at, reaction count) — **never** B's `email` or `account_id`. This is
careful SELECT-ing, not an architectural change.

### Proposed data model

```sql
-- account: add the public handle (nullable until opt-in on first share)
ALTER TABLE account ADD COLUMN handle TEXT;
CREATE UNIQUE INDEX account_handle_lower_key ON account (lower(handle))
  WHERE handle IS NOT NULL;

-- a single share event
CREATE TABLE feed_post (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  song_id       UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  liked_song_id UUID REFERENCES liked_song(id) ON DELETE SET NULL, -- provenance
  shared_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at    TIMESTAMPTZ,                                       -- self soft-delete
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one active share per song per user (intentional; blocks self-spam re-shares)
CREATE UNIQUE INDEX feed_post_active_unique
  ON feed_post (account_id, song_id) WHERE removed_at IS NULL;
CREATE INDEX feed_post_timeline ON feed_post (shared_at DESC) WHERE removed_at IS NULL;

-- one heart per user per share (toggle = insert/delete)
CREATE TABLE feed_reaction (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_post_id UUID NOT NULL REFERENCES feed_post(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (feed_post_id, account_id)
);
CREATE INDEX feed_reaction_post ON feed_reaction (feed_post_id);
```

Note: "share stays as a moment" falls out for free — `feed_post` is independent
of `liked_song.unliked_at`. `shareSong()` checks an active like *at share time*;
afterwards the post stands on its own. `ON DELETE SET NULL` on `liked_song_id`
keeps the post even if the underlying like row is ever hard-deleted.

### Server functions (mirror `*.functions.ts`)

- `getFeedPage({ cursor, limit })` → RPC `get_feed_page(viewer_account_id, cursor, limit)`
  returning post + song metadata (name, artists, `image_url`, `spotify_id`) +
  sharer handle/avatar + `reaction_count` + `viewer_has_reacted`.
- `shareSong({ songId })` — verifies active `liked_song`; inserts `feed_post`
  (idempotent via the partial unique index).
- `deleteShare({ postId })` — sets `removed_at` if caller owns it.
- `toggleReaction({ postId })` — insert or delete `feed_reaction`.
- `getHandleSuggestion()` / `setHandle({ handle })` — normalize, blocklist,
  uniqueness check.

### UI (heavy reuse)

- Feed item ≈ adapt `SongCard` (`src/features/liked-songs/components/SongCard.tsx`):
  album art + title + artist + sharer handle/avatar + relative `shared_at` +
  reaction button/count; **play = `<SpotifyEmbedIframe spotifyId={...} />`**
  (with `preloadSpotifyEmbedAPI()` on hover).
- Feed section on `src/features/dashboard/Dashboard.tsx` (mind the existing
  private `ActivityFeed.tsx` — use a distinct name, e.g. `Jukebox` / `PublicFeed`).
- Share entry point #1: a "Share" affordance on the Liked Songs `SongCard` /
  `SongDetailPanel`.
- Share entry point #2: a composer on the home feed — search your hearted songs
  (reuse `likedSongsInfiniteQueryOptions` as the source), pick one, publish.
- Reactions: optimistic toggle via TanStack Query mutation; invalidate feed on share.
- First-share flow: a small modal to claim/confirm a handle (seeded suggestion).

---

## 5. Build surface for v0 (files)

- **Migrations:** `account.handle` + index; `feed_post`; `feed_reaction`; `deny_all`
  RLS on both; `get_feed_page` RPC. (Follow `supabase/migrations/` conventions.)
- **Server fns:** new `src/lib/server/feed.functions.ts`.
- **Queries:** `src/features/feed/queries.ts` (infinite query, cursor = `shared_at`).
- **Feature:** `src/features/feed/` — `Feed.tsx`, `FeedItem.tsx`, `ShareComposer.tsx`,
  `HandleSetup.tsx`, `ReactionButton.tsx`.
- **Dashboard:** mount the feed section in `src/features/dashboard/Dashboard.tsx`.
- **Liked Songs:** add the quick-share affordance.
- **Types regen:** `bun run gen:types` after migrations.
- **Tests:** server-fn integrity (can't share an un-hearted song; can't react
  twice; delete only own share), handle uniqueness/normalization, security
  invariants still green.
- **Analytics:** PostHog events `feed_share`, `feed_react`, `feed_view` to measure
  the loop (project already uses PostHog).

No realtime needed for v0 — refetch on focus / navigation (the app deliberately
avoids SSE today; see `useDashboardSync.ts`). Live updates are a v2+ option (the
TanStack Start stack supports SSE).

---

## 6. How to develop it further (roadmap)

- **v1 — sticky:** per-handle pages (`/u/$handle`, among users) showing a user's
  shares; "now playing"; a share-count badge on songs.
- **v2 — network:** follow graph + a "Following" tab next to "Global"; comments
  (re-introduces real content moderation — defer deliberately); SSE live feed.
- **v3 — depth/discovery:**
  - **Vibe filters** from existing `song_audio_feature` (tempo/energy/valence):
    "show me high-energy shares."
  - **Trending lens** = the *collapse-dupes* view as a secondary surface:
    "songs shared by the most people this week" (the God's-Jukebox playlist view,
    layered on top of the timeline rather than replacing it).
  - Collaborative rooms / weekly recap.
- **Cross-provider:** `handle` (people) + `isrc` (songs) are already
  provider-agnostic → Apple Music / Last.fm libraries plug into the same feed.
- **Going truly public (outside-world), if ever:** *then* add a controlled,
  projection-limited public read path (a public server function returning only
  whitelisted fields). Deliberately out of scope now.

---

## 7. Open questions / risks

- **Cold start.** An empty feed is a bad first impression — seed it (team hearts,
  a curated launch set) before enabling for everyone.
- **Handle is the only UGC text** → the entire moderation surface is handle
  validation: length, charset, reserved-word + profanity blocklist, maybe
  reclaim-on-abuse. (A direct payoff of "song only.")
- **Rate limits** on share + reaction (anti-spam, even among users).
- **Reaction richness** — just a heart for v0; a small reaction set is a later call.
- **Sharing locked/un-analyzed songs** — should be allowed (a share needs no
  analysis); confirm the UI doesn't gate on `displayState`.
- **Consent moment** — first share publicly exposes a handle + that song to all
  users; make the first-share confirmation explicit.

---

## 8. Suggested next step

When ready to move from exploration to building, the natural path is an **OpenSpec
change** (`openspec/` + the `opsx:*` skills are set up in this repo) capturing the
v0 slice above as the proposal + tasks. Nothing here is implemented yet.

---

## 9. Platform integration & UX (exploration round 2 — the actual point of this exploration)

> §4's tables are reference. This section is the spine: how the feature maps onto
> existing product surfaces.

### Participation contract — "The Wall"
The feed is a **core surface** of hearted, not a separate network you join. Every
signed-in user can browse it. **Sharing** your own songs is the opt-in act (claim a
handle). You can **hide the feed surface in Settings** if you don't want it.

### Reversibility (folds into the contract)
Two separate controls, always in the user's hands:
- **Hide** (Settings) = removes the feed from *your view*; does not touch content.
- **Delete a share** = removes *your content* from everyone's feed, anytime.

"No going back" does **not** apply — a share is a real moment, but you can always
take it down. (Avoids the trust/legal problem of irreversible public content.)

### Onboarding sub-flow
Insert after `plan-selection` (~step 9, post-`syncing` so the user's hearts exist).
Three screens, each a re-skin of an existing component:
1. **Gate** — forced choice, reuses `ConsentBanner`'s Accept/Decline: "Set up
   sharing now?" / "Maybe later." Under the Wall, this gates *posting setup*, not access.
2. **Claim handle** (if yes) — pre-filled suggestion, unique, editable. Settings-style form row.
3. **Optional first share** (skippable) — re-skins the `pick-demo-song` CD-case grid.
   Teaches the gesture + activates the user + seeds the cold-start feed in one move.

### Home / dashboard
The existing `ActivityFeed` is **personal** (your own likes/matches), NOT social —
so the social feed is a different purpose (discovery), not a drop-in replacement.
Plan: **build both layouts and decide by feel** (Ladle A/B):
- (a) one module with **Community / You** tabs;
- (b) **feed leads** + a compact personal-activity strip below.

**Graceful-degradation rule:** the Community tab appears only when the user has
opted in AND the feed is non-empty; otherwise home falls back to the existing
personal `ActivityFeed`. No empty/irrelevant social section ever renders.

### Liked Songs
Share via **both**: the `SongDetailPanel` (the considered act) and a quick row
action on `SongCard` (revealed on hover/focus, mirroring the walkthrough hint).
A small **"public" marker** on rows the user has shared.

### Reactions
v0 = **silent heart-counts** (a count per share, noticed on visit). The app has no
notification system today (only sonner toasts) — an inbox/badge is a later call.

### Identity — the de-confusion
The app ALREADY resolves multi-source identity into two account fields
(`display_name`, `image_url`) rendered everywhere via one `UserAvatar`
component (`src/components/ui`, used in the sidebar + settings). Every auth/sync
path (email vs Google login, Spotify) funnels into those columns upstream. So:
- The **only new identity field** is `handle` — public, unique, editable; seed
  priority: Spotify `display_name` → Google name → email local-part.
- **Feed identity = `handle` + the existing `UserAvatar`.** The feed never reads a
  provider username/photo directly; if the resolved avatar changes source later,
  the feed follows automatically.
- **Pseudonymous-vs-real is NOT a v0 fork** — default to the existing avatar; an
  "abstract avatar / hide my photo" option can be a later toggle.
- By share time, Spotify is synced (the user's hearts exist), so a good seed source
  always exists.

### Consolidated status
| Surface | Decided experience | Status |
|---|---|---|
| Contract | The Wall — browse-free for all; sharing opt-in; hide in Settings | locked |
| Onboarding | gate → claim handle → optional first share (after plan-selection) | locked |
| Home | build both layouts, decide by feel; Community tab degrades to personal activity | prototype |
| Liked Songs | share from detail panel + hover row action; "public" marker | locked |
| Identity | `handle` + existing `UserAvatar`; pseudonymity = later toggle | locked |
| Reactions | silent heart-counts; no notifications in v0 | locked |
| Post unit / source | song only; only hearted songs | locked |
| Un-heart / leaving | share stays as a moment; hide = view, delete = content | locked |
| Navigation | dedicated "Feed" nav item vs home-only | OPEN |
| Cold-start | seeding strategy before launch | OPEN |
| "My shares" | where the user reviews/deletes their own shares | OPEN |
| Handle rules | change frequency, reserved words, profanity blocklist | OPEN |
| In-feed discovery | filters / trending / vibe (audio_features) | future |

---

## 10. Naming — "Jukebox" (decided)

Chosen via a naming workshop (Van Lancker's *How to Name Anything* method) grounded
in `brand/VOICE-AND-TONE.md`.

**Compass (Phase 1):** core emotion = **Wonder** (discovery); tone = **playful-warm
× music-insider**; never-list = no generic-social terms ("feed/hub/community"), no
clash with "Liked/Hearted", nothing cutesy. Direction mined: the **communal jukebox**.

**Name: `Jukebox`** — the nav item and the destination. Runners-up considered:
Juke, Hi-Fi, Encore; earlier veins (Hearsay, Deep Cuts, B-Side, Overheard) were
cut as too borrowed / off-emotion.

### Founding myth — the ownership angle (vs god's jukebox)
> **god's jukebox runs on coins. hearted's runs on hearts.**

Every song on the Jukebox is there because someone **hearted** it first — you can't
put up a track you didn't mean. The coin slot is the heart. This ties the name
directly to the core integrity mechanic (only hearted songs are shareable) and
makes it unmistakably hearted's, not a clone of the inspiration. Use the name with
confidence — no apologetic "it's like god's jukebox but…" framing.

### Copy / verbs it unlocks (match VOICE-AND-TONE)
- Nav item: **Jukebox**
- Share action: **"Add to the Jukebox"** / "Put it on the jukebox" (warmer than "Share")
- Dashboard card eyebrow: **ON THE JUKEBOX** → "See all →"
- Activity line: *"mara put a song on the jukebox"*
- Empty state (light): "The jukebox is quiet. Play something first."
- Onboarding gate: "Put a song on the jukebox?" / "Maybe later."

### Open copy nuance
The voice guide reserves the ♥ for the Liked Songs reference, so Jukebox
**reactions** (silent counts in v0) likely want their own token/gesture rather than
another heart — decide when designing the reaction UI.
