# Playlist Creation from Liked Songs — Conceptualization

> Branch: `feat/playlist-creation-from-liked-songs`
> Status: design locked, implementation in progress (orchestrated build).

## 1. What we're building

A new way to turn the user's **liked songs** into a **brand-new playlist**, created
in-app through an **iterative, build-as-you-go** experience and then pushed to Spotify.

Until now the playlists tab only let users attach a **matching intent + filters** to
*existing* playlists and accept suggested matches one at a time. This feature adds the
inverse: start from nothing, describe/filter what you want, see a **live preview** of the
resulting playlist, **remove** songs you don't want, and pull in **suggested songs** that
also fit — like Spotify's "Add to this playlist" / Enhance tray — until it feels right.
Then commit it to Spotify.

It is deliberately a **separate route** so the whole curation session lives on one page and
feels like a focused, iterative tool rather than a modal bolted onto the list.

## 2. Locked product decisions

| Decision | Choice |
| --- | --- |
| **Creation model** | **Draft-first.** All curation happens in-app on a draft. The real Spotify playlist is created (via the extension) only when the user clicks **Create playlist**. It is a **static snapshot** at creation time (no auto-update). |
| **Intent gating** | The natural-language **matching intent phrase** is gated. Eligible = `hasUnlimitedAccess(billingState)` **OR** the account has **≥ 1000 songs unlocked** (non-revoked `account_song_unlock`). **Genre pills + filters are free for everyone.** |
| **Max songs** | Slider. **Default 15**, range **5–50**, **step 5**. Live value display with `tabular-nums` and an approximate duration hint. |
| **Spotify scope** | Build & wire the **full live creation path** through the extension (resolve the Spotify `userId`, batch-add tracks, acknowledge to DB). Reconnect button at **every** Spotify touchpoint. Overnight verification = typecheck + vitest + `ladle:build` + PR bots; human verifies the real end-to-end extension flow. |
| **Enrichment** | **Ungate Phase-1 enrichment** (audio features, genres, language, vocal gender — all deterministic, non‑ML signals) so it runs for **every song and every user**. Trigger it **on-demand** (lazily) when a user enters the playlist-creation feature. **Embeddings + LLM analysis stay gated.** |
| **Free-tier suggestions** | Powered by **deterministic similarity** (genre overlap + audio-feature distance + filters), reusing the matching service in a **no-embedding scoring mode**. Premium adds embeddings + intent on top. |
| **Design stack** | "Semi-shadcn": use `cn()` from `@/lib/utils`, `sonner` toasts (`top-right`, `richColors`) for undo, **lucide** icons, hand-rolled CSS-styled native `range` slider (no Radix/cva). Follow `hearted-design` + `make-interfaces-feel-better` + archived design/animation guidelines. |
| **Reuse** | Maximize reuse of the existing matching system for consistency. New code is a thin **draft-orchestration** layer over existing services + components. |

## 3. The experience (happy path)

```
Playlists tab
  └─ [ + Create playlist ]  ───────────────►  /playlists/new
                                                │
                            ┌───────────────────┴────────────────────┐
                            │  CONFIG (free: genre + filters + slider) │
                            │  Intent phrase ✦ (premium, locked teaser)│
                            ├──────────────────────────────────────────┤
                            │  PREVIEW  (live, up to {maxSongs})        │
                            │   ▸ removable rows, live count + duration │
                            ├──────────────────────────────────────────┤
                            │  SUGGESTED TO ADD  (soft-refresh feed)    │
                            │   ▸ add → enters preview, optimistic      │
                            └──────────────────────────────────────────┘
                            [ Create playlist ]  → extension creates in
                            Spotify, batch-adds tracks, success state.
```

- **Config and preview are visible together** (not wizard steps). Changing a filter, a genre
  pill, the slider, or the intent **re-runs the preview** (debounced ~600ms).
- **Remove** a preview song → it animates out, a `sonner` **undo** toast appears, and a new
  suggestion slides into the tray to backfill.
- **Add** a suggestion → optimistic insert into the preview with a brief highlight; the tray
  refreshes.
- Songs added/removed by the user are **pinned/excluded** and survive config re-runs.

## 4. Premium gating UX (intent only)

"Show, then lock." The intent field is **visible** to everyone, never blurred. For
ineligible users it renders a **muted, locked teaser** with a lock affordance + a single
benefit-first CTA ("Describe the vibe in your own words — available with Backstage Pass").
The rest of the flow (genre, filters, slider, preview, suggestions, create) is fully usable
without it. Eligibility predicate is computed server-side and passed down; the preview server
function also enforces it (defense in depth — never trust the client to apply intent).

## 5. Extension / Spotify reality

- The real Spotify playlist is created through the **browser extension** (`createPlaylist`
  command → `acknowledgePlaylistCreate`). Creation needs the Spotify **`userId`**, which the
  web app does not currently hold — resolved in T3 (cache from sync payload server-side, or a
  new lightweight extension command; builder picks the simplest reliable path).
- **Every Spotify touchpoint** must render the existing reconnect affordance
  (`SpotifyReconnectLink` + `useSpotifyReconnectState`) when a command returns
  `reconnect-required`, and an install/connect prompt when the extension is unreachable.
- Because creation is draft-first, the only Spotify writes happen at **Create**: create the
  playlist, then batch-add the previewed tracks, then acknowledge to the DB.

## 6. Degradation & edge states

- **Free user, no enriched songs yet** → on-demand Phase-1 backfill runs; show a friendly
  "warming up your library" state until enough songs have genre/audio data.
- **Not enough songs match filters** (e.g. slider 50 but only 12 eligible) → fill what exists
  and show an inline "broaden your filters for more" note; never error.
- **Extension missing / Spotify disconnected** at Create → reconnect/install affordance,
  draft preserved.
- **Reduced motion** → all enter/exit animations collapse to instant opacity changes.

## 7. Research basis (summary)

UX research (Spotify Enhance/Recommended Songs, prompt-to-playlist, filter+preview patterns,
playlist-length studies) supports: visible live result counts, distinct visual treatment for
system suggestions vs. user picks, optimistic add/remove with undo, debounced suggestion
refresh, a modest default length (15 here) over starting maxed, and "show-then-lock" premium
gating. Full source list lives in the orchestration research notes; see
`implementation-plan.md` for the concrete contracts derived from the codebase.
