# Public Liked-Songs Sharing — exploration

> Status: **exploration / decisions locked, not yet specced for implementation.**
> Date: 2026-06-02.
>
> **Depends on:** `claudedocs/handle-identity-exploration-2026-06-02.md` — the
> `account.handle` username is built there and is a hard prerequisite (the public URL
> is `/@<handle>/liked-songs`). This doc does **not** re-derive identity.
>
> **Sibling of:** `docs/social/social-feed-exploration-2026-06-02.md` (the in-app,
> signed-in-only "Jukebox" feed). Both are **public surfaces hung off the same
> `@handle` profile namespace** — see §8.

A signed-in user flips a **"Share publicly"** toggle on their Liked Songs page. When
on, their hearted library becomes viewable at `/@<handle>/liked-songs` by **anyone
with the link — no account required**. Song **metadata** is public for the whole
library; the **AI analysis** is shown for the songs **the owner has unlocked**,
mirroring outward exactly what the owner sees in their own list.

---

## 1. The ask (one paragraph)

> "I want to share my liked songs page publicly. A toggle on the Liked Songs page
> turns it on; then I share a link and people see my songs. It's tied to me by my
> hearted username. Show the songs and the analysis — the analysis follows my own
> unlocked state."

---

## 2. Locked decisions

| Dimension              | Decision                                                                            | Notes                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Audience**           | **Truly public** — anyone with the link, no account                                 | A new _unauthenticated_ read path (§3)                                                                                    |
| **Which songs**        | **All active liked songs** (`unliked_at IS NULL`)                                   | The whole hearted library; a **live projection** (§4)                                                                     |
| **Per-song depth**     | **Metadata for all; analysis for the owner's unlocked songs** (owner-scoped)        | Everyone — including anonymous — sees the analyses the owner unlocked. The paywall trade is **accepted as a funnel** (§5) |
| **URL**                | **`@handle` namespace**: `/@<handle>/liked-songs`                                   | `/@<handle>` redirects to it in v0; a sibling `/@<handle>/jukebox` arrives later (§8)                                     |
| **Identity**           | `account.handle` from the handle doc                                                | Immutable in v0 (no renames)                                                                                              |
| **Toggle home**        | **Liked Songs page only**                                                           | No Settings section in v0 (§9)                                                                                            |
| **Owner preview**      | Owner opening their own URL while private sees the page **with a "Private" banner** | Loader resolves session only on the non-public branch (§8, §12.3)                                                         |
| **Toggle default**     | **OFF / private**                                                                   | Going public is a confirmed, deliberate act (§9)                                                                          |
| **Discoverability**    | **Unlisted by default** (`noindex`)                                                 | Indexing is a later opt-in (§13)                                                                                          |
| **New tables**         | **None**                                                                            | One boolean column on `account` + read-only RPCs (§6)                                                                     |
| **Un-heart semantics** | Song **leaves** the public page (live projection)                                   | Opposite of the Jukebox, where a share "stays as a moment" (§4)                                                           |
| **Security invariant** | `deny_all` RLS stays; service-role only                                             | Anonymous visitors never touch a table directly (§3, §14)                                                                 |

---

## 3. Core architectural insight — public without breaking the security model

The codebase's defining invariant: **every table has `deny_all` RLS,
`anon`/`authenticated` are revoked, all access flows through the service-role client.**
A test (`src/lib/data/__tests__/security-invariants.integration.test.ts`) fails if any
table becomes anon-readable. There is **no anon Supabase client** anywhere.

So "share publicly" must **not** relax RLS. The pattern (already used for the public
waitlist endpoint, `src/lib/server/waitlist.functions.ts`):

> An **unauthenticated `createServerFn`** (no `authMiddleware`) uses the service-role
> admin client to call **one purpose-built RPC** that returns **only whitelisted
> fields** for one handle — and nothing if the library is private. The return shape
> _is_ the security contract.

**The projection rule (the whole security story):** the public RPC returns `song`
metadata + `liked_at` + the owner's `handle`/`display_name`/`image_url` + — because
analysis is owner-scoped (§5) — `analysis_content` **only for songs the owner is
entitled to**. It **never** returns `email`, `account_id`, the owner's `spotify_id`,
or `better_auth_user_id`.

**Owner-scoped analysis makes the page fully anonymous-servable and cacheable:** there
is _no per-viewer logic_ on the public path. The HTML for `/@fabio/liked-songs` is
identical for every viewer, so it's a clean CDN-cache candidate later. The only place
a viewer session is read is the private-preview branch (§8), which is off the public
hot path.

---

## 4. The visibility model: live projection, not a snapshot

The public page is a **live read** over `liked_song ⋈ song`, filtered to active likes:

- **Un-hearting removes a song** from the public page on the next load. No stored
  "public set" to drift.
- **Toggling private** 404s the link immediately (single boolean flip).
- **No new tables, no backfill, no snapshot job.**

This is the **defining contrast with the Jukebox**: a Jukebox _share_ is an event that
"stays as a moment" even after un-hearting (it needs `feed_post`). A public _library_
is a window onto current state. Same `@handle`, opposite persistence — keep them
straight as both surfaces grow under the profile namespace (§8).

---

## 5. The analysis model (owner-scoped)

`song_analysis` is a **global, per-song artifact** (the AI analyzes the _song_, not a
user). What's per-account is _access_, via the existing predicate
`is_account_song_entitled(account_id, song_id)`
(`supabase/migrations/20260405130000_entitlement_predicate.sql`): true if the account
has an active `account_song_unlock` for that song **or** active unlimited access.

**Owner-scoped (locked):** the public page shows analysis for a song **iff the page's
owner is entitled to it** — exactly what the owner sees in their own Liked Songs list,
projected outward to everyone.

| Song state (relative to the **owner**)   | Anonymous visitor sees       | Why                                                                 |
| ---------------------------------------- | ---------------------------- | ------------------------------------------------------------------- |
| Owner **unlocked** it (or has unlimited) | Metadata + **full analysis** | The owner has access; we mirror it publicly                         |
| Owner **liked but not unlocked**         | Metadata only                | The owner can't see its analysis either — there's nothing to mirror |
| Song never analyzed at all               | Metadata only                | No `song_analysis` row exists                                       |

Consequences:

- **No per-viewer auth, no separate analysis fetch.** Analysis rides along in the
  public projection, gated by the _owner's_ entitlement. This deletes the
  viewer-gated fetch that an earlier draft needed — simpler and cacheable (§3).
- **It reuses your existing billing-aware logic.** `get_liked_songs_page` already
  returns `analysis_content` gated by an account's entitlement. The public RPC is
  "resolve handle → owner account → run that same owner-scoped gating" (§7).
- **Accepted trade-off:** a public page reveals _which_ songs the owner unlocked
  (analysis presence implies it) and gives that paid analysis away free. That is the
  deliberate funnel — a non-user reads real analysis, then sees a single page-level
  _"Get analysis like this for your own songs → hearted"_ CTA. There is **no per-song
  unlock CTA** on the public page (a visitor can't unlock someone else's song).

---

## 6. Data model (one column; handle comes from the handle doc)

```sql
-- migration: <ts>_add_library_visibility_to_account.sql
-- (account.handle + lower(handle) unique index are added by the handle-identity doc)
ALTER TABLE account ADD COLUMN is_library_public BOOLEAN NOT NULL DEFAULT false;
```

**On `account`, next to `handle`** — so the public RPC resolves
`handle → account → visibility` in a single-table indexed lookup, no join. (The
`user_preferences` table is the other candidate, but it would force a join on the hot
public path; locality with `handle` wins. Re-open only if many sharing sub-preferences
appear.)

Boolean for v0; migrate to a `TEXT CHECK (...)` enum if `private`/`unlisted`/
`followers-only` is ever needed. No new tables, no RLS change (account already
`deny_all`).

---

## 7. Server functions & the public RPCs

RPCs match conventions: `SECURITY DEFINER`, pinned `search_path`, execute granted only
to `service_role`.

```sql
-- Profile header. 0 rows ⇒ unknown OR private (drives 404 / private-preview branch).
CREATE OR REPLACE FUNCTION public.get_public_profile(p_handle TEXT)
RETURNS TABLE (display_name TEXT, image_url TEXT, handle TEXT, song_count BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT a.display_name, a.image_url, a.handle,
         (SELECT count(*) FROM liked_song ls
            WHERE ls.account_id = a.id AND ls.unliked_at IS NULL)
  FROM account a
  WHERE lower(a.handle) = lower(p_handle) AND a.is_library_public = true;
END; $$;

-- Metadata page + owner-scoped analysis. Cursor = liked_at DESC (mirrors get_liked_songs_page).
CREATE OR REPLACE FUNCTION public.get_public_library_page(
  p_handle TEXT, p_cursor TIMESTAMPTZ DEFAULT NULL, p_limit INT DEFAULT 30
)
RETURNS TABLE (
  song_id UUID, spotify_id TEXT, name TEXT, artists TEXT[],
  album_name TEXT, image_url TEXT, liked_at TIMESTAMPTZ,
  analysis_content JSONB    -- NULL unless the OWNER is entitled to this song
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account_id UUID;
BEGIN
  SELECT a.id INTO v_account_id FROM account a
  WHERE lower(a.handle) = lower(p_handle) AND a.is_library_public = true;
  IF v_account_id IS NULL THEN RETURN; END IF;     -- unknown or private ⇒ empty

  RETURN QUERY
  SELECT s.id, s.spotify_id, s.name, s.artists, s.album_name, s.image_url, ls.liked_at,
         CASE WHEN public.is_account_song_entitled(v_account_id, s.id)
              THEN sa.analysis ELSE NULL END
  FROM liked_song ls
  JOIN song s ON s.id = ls.song_id
  LEFT JOIN song_analysis sa ON sa.song_id = s.id   -- mirror get_liked_songs_page's analysis join/ordering
  WHERE ls.account_id = v_account_id AND ls.unliked_at IS NULL
    AND (p_cursor IS NULL OR ls.liked_at < p_cursor)
  ORDER BY ls.liked_at DESC LIMIT p_limit;
END; $$;
```

Note: `analysis_content` is gated on `v_account_id` (the **owner**), so it returns the
owner's unlocked analyses to everyone — never any viewer's state, never `email` /
`account_id` / owner `spotify_id`. Both RPCs: `REVOKE ALL ... FROM PUBLIC, anon,
authenticated; GRANT EXECUTE ... TO service_role;`.

### Server functions

| Fn                                                | Auth                 | Purpose                                                                                                                           |
| ------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `getPublicProfile({ handle })`                    | **None**             | service-role → `get_public_profile`; `null` ⇒ unknown/private (route decides 404 vs private-preview)                              |
| `getPublicLibraryPage({ handle, cursor, limit })` | **None**             | service-role → `get_public_library_page`; `{ songs, nextCursor }`, cursor = `liked_at` (mirrors `likedSongsInfiniteQueryOptions`) |
| `setLibraryVisibility({ isPublic })`              | **`authMiddleware`** | flips `account.is_library_public` for the caller; refuses (routes to claim) if `handle IS NULL` (§12.12)                          |

No viewer-gated analysis fn is needed (owner-scoped). The public fns follow the
`waitlist.functions.ts` template (no middleware, `createAdminSupabaseClient`, zod
`inputValidator`); `setLibraryVisibility` follows `updateThemePreference`.

---

## 8. Routing: the `@handle` profile namespace

**Verified against the installed router (`@tanstack/react-router` 1.170.4):** a path
param can carry a **literal prefix** via the brace syntax — `/posts/post-{$postId}`
matches `/posts/post-123`. So a `@`-prefixed segment is first-class:

```
src/routes/
  @{$handle}/                 → namespace, segment matches "@fabio" (params.handle = "fabio")
    route.tsx                 → shared profile shell + the private/404 resolution
    index.tsx                 → /@fabio        → v0: redirect to ./liked-songs
    liked-songs.tsx           → /@fabio/liked-songs   ← THIS feature (public)
    jukebox.tsx               → /@fabio/jukebox       ← future (its own beforeLoad/audience)
```

Why `@` over `/u/`: it reads as "a person" instantly, and the literal prefix means a
handle URL can **never collide** with a top-level route (`/login` ≠ `/@login`), which
shrinks the reserved-word list (handle doc §5). Each sub-route owns its own
`beforeLoad`, so `liked-songs` is anonymous while `jukebox` can be signed-in — under
one namespace, no shared-audience compromise.

- **`/@<handle>` (index):** v0 = `redirect` to `./liked-songs` (one line). When a
  second surface exists, promote it to a real hub. The redirect keeps the sub-paths
  stable, so adding the Jukebox is **additive, never a URL migration.**
- **`liked-songs` loader:** SSR-prefetch `getPublicProfile` + first
  `getPublicLibraryPage`. **Resolution order (preserves cacheability):**
  1. `getPublicProfile(handle)` → **public** ⇒ render the page (no session read →
     identical for all viewers → cacheable).
  2. profile `null` ⇒ _now_ read the optional session (`getAuthSession()`, the
     non-throwing impl — `optionalAuthMiddleware` does not exist; call it directly,
     as `src/routes/index.tsx` does). If `viewer.account.handle === handle` ⇒ render
     the **private-preview** with a banner (§12.3). Else ⇒ `throw notFound()`.
- **404:** caught by the global `notFoundComponent` in `__root.tsx`. Unknown handle
  and "exists but private (not owner)" 404 **identically** — no existence oracle.
- **Head / OpenGraph — greenfield** (only `__root.tsx` sets `head:` today; zero OG
  tags exist). The `liked-songs` route is the first per-route `head:` with
  `loaderData`:
  ```ts
  head: ({ loaderData }) => ({ meta: [
    { title: `${loaderData.displayName}'s hearted songs` },
    { name: "description", content: `${loaderData.songCount} songs, hand-picked.` },
    { property: "og:title", content: `${loaderData.displayName} on hearted` },
    { property: "og:description", content: "the stories inside their liked songs" },
    { property: "og:image", content: /* v0: brand card or avatar; v1: collage */ },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "robots", content: "noindex" },   // unlisted by default
  ]})
  ```
  TanStack Start merges child `head()` over root, so the route only adds/overrides.

---

## 9. The toggle UX on Liked Songs (page-only)

The control lives **only on the Liked Songs page** (`LikedSongsHeader.tsx` or a thin
sharing bar) — no Settings section in v0. When ON, reveal the read-only URL
`hearted.music/@<handle>/liked-songs` + a **Copy link** button.

Reality check — **three primitives must be built; none exist in the design system:**

1. **A Switch/Toggle** — there is no `Switch` in `src/components/ui/`. Build an
   accessible one: `role="switch"`, `aria-checked`, keyboard (Space/Enter), visible
   focus ring, `prefers-reduced-motion`-aware transition. (The ad-hoc dark-mode
   `Button variant="surface"` toggle in `LikedSongsPage.tsx` is a style reference,
   not a drop-in.)
2. **Copy-to-clipboard** — none exists (no `navigator.clipboard` usage anywhere).
   Build `CopyLinkButton`: `await navigator.clipboard.writeText(url)` →
   `toast.message("Link copied.")` (existing neutral-toast style); fall back +
   `toast.error` on rejection/insecure context.
3. **A confirm dialog** — no reusable one; the app builds them ad hoc with
   `createPortal` (`UnlockConfirmDialog`, `PaywallCTA`). Build the "make your library
   public?" confirm the same way (`dialog-backdrop` + `dialog-content` +
   `theme-surface-bg theme-border-color`, Cancel/Confirm).

**Confirm asymmetry (locked):** turning **ON** shows the confirm — _"Anyone with this
link can see all your hearted songs, including the analysis on the ones you've
unlocked."_ Turning **OFF** is instant (no confirm) — the safe direction.

Persistence mirrors the theme picker: optimistic local state → `setLibraryVisibility`
→ rollback + `toast.error` on failure.

URL is built from an env base (`https://hearted.music`) + `/@<handle>/liked-songs`, never
hand-assembled from `window.location` on the server.

---

## 10. The public page UI (reuse map)

A read-only re-skin of Liked Songs. Direct reuse:

| Need                                                  | Reuse                                                                                                                                               | Source                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Owner header (avatar + name + `@handle` + song count) | `UserAvatar`                                                                                                                                        | `src/components/ui/UserAvatar.tsx`                            |
| Song row                                              | `SongCard` (strip selection/unlock affordances; keep art/title/artist/time)                                                                         | `src/features/liked-songs/components/SongCard.tsx`            |
| Empty library state                                   | `EditorialNotice` pattern                                                                                                                           | `src/features/liked-songs/components/LikedSongsList.tsx`      |
| Analysis (owner-unlocked songs)                       | `PanelContent` analyzed branch (genres, themes, journey, key lines, mood, playlists)                                                                | `src/features/liked-songs/components/detail/PanelContent.tsx` |
| Owner-locked song detail                              | `PanelContent` `isLocked` branch, **reworded** — not "unlock to see" (visitor can't), just a quiet "no public analysis" + the page-level funnel CTA | `PanelContent.tsx`                                            |
| Page-level funnel CTA ("Get hearted")                 | The `WalkthroughCta` sticky-button pattern                                                                                                          | `SongDetailPanel.tsx`                                         |
| Playback                                              | `SpotifyEmbedIframe` (`spotifyId` = projected `song.spotify_id`; hover-preload, click-activate)                                                     | `src/features/matching/components/SpotifyEmbedIframe.tsx`     |

CSP already allows the Spotify embed for **all** routes
(`frame-src https://open.spotify.com` in `__root.tsx` `headers()`), so playback works
on `/@<handle>/liked-songs` with no CSP change.

**Omit:** the `Locked`/`Unlocked` filter tabs (would expose the billing breakdown),
the "Unlock Songs" selection mode, `SongSelectionBar`, `PaywallCTA`, credit balance.
**Keep:** total song count and optionally a plain search.

---

## 11. Rate limiting & abuse

A public, unauthenticated, cacheable endpoint still invites scraping. Available
mechanism: `withinRateLimit(bindingName, key)`
(`src/lib/platform/rate-limit/edge-rate-limit.ts`, Cloudflare native, fails open in
local dev).

**Decision (v0, with caveat):** add a `PUBLIC_LIBRARY_LIMITER` binding in
`wrangler.jsonc` and call `withinRateLimit("PUBLIC_LIBRARY_LIMITER", handle)` at the
top of `getPublicLibraryPage`, keyed per-handle (caps hammering one profile).
**Caveat:** per-_IP_ limiting needs request access `createServerFn` doesn't cleanly
expose — if required, implement the public read as a raw file-route handler (like
`src/routes/api/billing-bridge.ts`). Tracked §13.C. Mitigations already cheap: handles
aren't enumerable (no listing endpoint), `noindex` keeps crawlers off.

---

## 12. Edge cases (exhaustive)

1. **Unknown handle** → `getPublicProfile` empty → (not owner) `notFound()`.
2. **Exists but private, viewer ≠ owner** → **identical 404** (no existence oracle).
3. **Owner opens own private page** → render the library **with a "Private — only you
   can see this. Flip the toggle to share." banner** (LOCKED). The loader reads the
   session only on the profile-`null` branch (§8), so the public path stays cacheable.
4. **Public, zero active likes** → **not** a 404; render the profile header +
   `EditorialNotice` empty state ("Nothing on the shelf yet."). The profile is valid.
5. **Very large library** → cursor pagination (`liked_at`), SSR first page only, lazy
   embeds, modest `p_limit` (start 30). `noindex` avoids crawler load.
6. **Un-hearting a song** → it vanishes on next load (live projection, §4).
7. **Owner unlocked song** → full analysis shown to everyone (the funnel).
8. **Owner liked but didn't unlock** → metadata only; the detail view shows the quiet
   "no public analysis" state (not an unlock CTA — a visitor can't unlock it).
9. **Song never analyzed** → metadata only; same as (8).
10. **Owner later unlocks more songs** → their analyses appear on the public page
    automatically (live projection over current entitlement).
11. **Owner later loses unlimited / a pack is revoked** → those analyses disappear from
    the public page (gating is live on `is_account_song_entitled`). Worth noting: a
    page can lose richness if billing lapses.
12. **Toggle attempted with `handle IS NULL`** (legacy pre-`claim-handle` account) →
    `setLibraryVisibility` refuses; UI routes to claim a handle first (defensive;
    should be impossible post-onboarding — handle doc §7).
13. **Spotify embed** → needs only `song.spotify_id` (the _song's_ public id; never the
    _owner's_ `account.spotify_id`). Works under existing CSP.
14. **Account deleted** → `ON DELETE CASCADE` drops `liked_song`; handle frees; page
    404s. No orphan.
15. **Rapid private→public→private** → each flip is one boolean UPDATE; off → instant
    404 of the link.
16. **Made-private-after-sharing** → the link 404s at once; anything a recipient
    already loaded is already seen, and `noindex` limits cached copies. The confirm
    copy sets this expectation ("anyone with the link" while public).
17. **Caching** → because the public path reads no session, `/@<handle>/liked-songs` is
    identical for all anonymous viewers → CDN-cacheable later, with cache busting on
    `is_library_public` flip and on like/unlock changes (note for the caching work).
18. **Handle rename** → not in v0 (handle is immutable); so no link rot to manage here.

---

## 13. Open debates (what's left to decide)

Most forks are now locked (analysis = owner-scoped; URL = `@handle` namespace;
toggle = page-only; owner-preview = banner; renames = none). Remaining:

- **A. `/@<handle>` index — redirect vs hub.** v0 = redirect to `./liked-songs`.
  Confirm we promote it to a real hub only when a second surface (Jukebox) ships.
- **B. Page theming** — neutral brand (v0) vs the owner's `user_preferences.theme`.
  Recommend neutral for v0; owner-theme is a v1 polish.
- **C. Rate-limit shape** — `createServerFn` + per-handle (v0) vs raw route + per-IP.
- **D. Which counts are public** — total song count: **yes**. A locked/unlocked
  breakdown: **no** (analysis presence already implies unlock state per-song; don't
  also surface an aggregate). Confirm.
- **E. Public detail depth** — reuse the **full** `SongDetailPanel` (heavy animations,
  `HorizontalJourney`, `KeyLinesSection`) or a lighter read-only card? Recommend reuse
  `PanelContent`, drop walkthrough-only chrome.
- **F. Indexing** — `noindex` default; a per-user SEO opt-in is a later call.
- **G. Jukebox audience** — when it ships under `/@<handle>/jukebox`, is it
  signed-in-only (its current design) or also public? Out of scope here; the namespace
  supports either.

---

## 14. Security & privacy invariants (+ tests)

- `deny_all` RLS unchanged; both RPCs `service_role`-only; the security-invariants
  test passes **unedited**.
- **New tests:**
  - `get_public_library_page` / `get_public_profile` return **nothing** for a private
    library and for an unknown handle.
  - The projection **never** includes `email` / `account_id` / owner `spotify_id` /
    `better_auth_user_id` (assert on the returned shape — the boundary as a test).
  - `analysis_content` is present **only** for songs the **owner** is entitled to
    (`is_account_song_entitled(owner, song)`), and `NULL` otherwise — including the
    unlimited-owner-shows-all case and the lapsed-billing-hides-again case (§12.11).
  - The route 404s **identically** for unknown vs. private-and-not-owner (no oracle);
    the **owner** gets the private-preview banner instead.
  - `setLibraryVisibility` flips the boolean for the caller and refuses when
    `handle IS NULL`.
- **Privacy:** enabling sharing exposes the **entire** active liked library + handle +
  avatar + **the analysis of every unlocked song**. The confirm copy says exactly
  that. Default OFF, `noindex` default, one-click instant revert (page 404s the moment
  `is_library_public` is false).

---

## 15. Build surface (files)

- **Migrations:** `add_library_visibility_to_account` (the boolean);
  `create_public_library_rpcs` (`get_public_profile`, `get_public_library_page`). No
  tables, no RLS change. (`account.handle` + index come from the handle doc.)
- **Server fns:** `src/lib/server/public-library.functions.ts` (`getPublicProfile`,
  `getPublicLibraryPage` — unauthenticated; `setLibraryVisibility` — `authMiddleware`).
- **Queries:** `src/features/public-library/queries.ts` (infinite query, cursor =
  `liked_at`).
- **Routes:** `src/routes/@{$handle}/route.tsx` (profile shell + private/404
  resolution), `index.tsx` (redirect), `liked-songs.tsx` (loader + `head:`
  OG/`noindex`).
- **Feature dir:** `src/features/public-library/` — `PublicLibrary.tsx`,
  `OwnerHeader.tsx`, `PublicSongCard.tsx` (or `SongCard` with flags),
  `PrivateBanner.tsx`, `GetHeartedCta.tsx`.
- **New shared primitives (greenfield):** `Switch` (accessible), `CopyLinkButton`,
  a public-confirm dialog (ad-hoc `createPortal`).
- **Liked Songs page:** the share toggle + copy-link affordance (`LikedSongsHeader` or
  a sharing bar).
- **`wrangler.jsonc`:** `PUBLIC_LIBRARY_LIMITER` binding (if rate-limiting, §11).
- **Types regen:** `bun run gen:types` after migrations.
- **Analytics (PostHog):** `library_share_enabled` / `library_share_disabled`,
  `public_library_viewed`, `public_song_opened`, `get_hearted_cta_clicked`.

---

## 16. Roadmap

- **v1:** generated album-collage OG image (Workers-compatible generator); owner-theme
  styling; per-user SEO-indexing opt-in; CDN caching of the public path.
- **v2:** visibility enum (`private`/`unlisted`/`public`); an optional "hide these
  songs from my public page" per-song control (the one place the live-projection model
  gains a stored exception); lightweight view counts (needs new infra — there is **no**
  notification/inbox system today, only `sonner` toasts); the `/@<handle>` hub.
- **Cross-provider:** identity is `handle` (people) + `isrc` (songs), so a Last.fm /
  Apple Music library plugs into the same public page with no schema change — new sync
  sources writing `liked_song`/`song`.
- **Jukebox:** ships as a sibling `/@<handle>/jukebox` under the same namespace (§8).

---

## 17. Next step

When ready, the path (same as the handle + Jukebox docs) is an **OpenSpec change**
(`openspec/` + `opsx:*` skills) — **sequenced after or bundled with** the handle
change, since the URL depends on it. Scope: the `is_library_public` column, the two
public RPCs + unauthenticated read path, the `@{$handle}` route namespace
(shell + redirect + `liked-songs` page with OG/`noindex` + private-preview), the share
toggle + the three new UI primitives, rate limiting, and the §14 test matrix.

Nothing here is implemented yet.

---

### Routing-syntax sources (verified for this doc)

- [Path Params — TanStack Router](https://tanstack.com/router/latest/docs/guide/path-params) (prefix/suffix via `prefix-{$param}` braces; optional `{-$param}`)
- [Routing Concepts — TanStack Router](https://tanstack.com/router/latest/docs/routing/routing-concepts)
