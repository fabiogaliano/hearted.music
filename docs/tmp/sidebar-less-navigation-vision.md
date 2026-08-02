# Getting rid of the sidebar: everything flows from /dashboard

A theory-and-evidence pass on removing the sidebar and making `/dashboard` the
navigational root, with routes preserved and navigation happening through the
content itself. Framed as a hypothesis to react to, not a plan of record.

Inputs: codebase audit (routes, sidebar, dashboard link graph), IA literature
research (NN/g, information foraging, OOUX, Krug), and product case studies
(Superhuman, Duolingo, Stripe, Spotify, Apple Music, Airbnb, plus
counter-examples). Frameworks: Covert's *How to Make Sense of Any Mess*
(Mode B single pass), Rosenfeld/Morville/Arango four systems, hearted-design.

---

## 1. The mess (Covert step 1)

Root cause: **not the right kind of information** — chrome-based navigation in
a content-driven app. The app runs two navigation systems that teach different
mental models:

- The sidebar teaches *sections*: "Match Songs / Liked Songs / Playlists" as
  abstract places.
- The content teaches *objects*: activity rows open songs, covers open
  playlists, the match CTA opens the queue, "Adjust strictness" round-trips to
  settings.

The second system has been quietly winning for months (search moved into the
library panel, creation moved into the masthead, the dashboard already links
to nearly every destination). The sidebar is close to vestigial: it holds
exactly three links, a count badge, and an identity strip. The mess is the
redundancy — two systems doing one job, and the weaker one occupying the
app's only piece of persistent chrome.

Users affected: logged-in, returning listeners (high-frequency, task-focused —
exactly the population NN/g carves out as the exception where removing global
nav is defensible).

## 2. Intent (step 2)

Why: hearted. is editorial — an art-gallery, typography-first product where the
music is the interface. A sidebar is app furniture; a masthead is editorial
furniture. The navigation should feel like *reading a magazine about your own
library*, not operating a tool.

Adjectives we want: **inhabited, editorial, calm, confident, personal, spatial**.
Adjectives we're okay not having: **exhaustive, app-like, dense, efficient-looking,
familiar-as-in-SaaS**. (Real trade: we give up the at-a-glance "map of the app"
and instant one-click lateral jumps that a sidebar provides.)

## 3. Reality (step 3 — from the codebase audit)

Scope: authenticated shell only. Timescale labels: *now* = audited reality,
*when* = proposal.

**Now:**
- 5 sidebar destinations: `/dashboard` (wordmark), `/match`, `/liked-songs`,
  `/playlists`, `/settings` (footer strip). Plus badge (unsorted count) and
  identity/plan/upgrade strip.
- Dashboard already links out: MatchReviewCTA → `/match`, CreatePlaylistCTA →
  `/playlists/new`, every activity row → `/liked-songs?song=slug`. Only the
  header doesn't navigate.
- Deep navigation is already content-driven: covers → spotlight panel, rows →
  song drawer, match empty-state ↔ settings with a scoped "Back to match".
- No breadcrumbs, no global topbar, no global search. Every page renders its
  own masthead. The sidebar is the app's *only* persistent chrome.
- View Transitions API already does shared-element morphs (playlist cover →
  detail).
- Mobile = sidebar-as-drawer + hamburger; no bottom tabs. (Design system says
  desktop-first; mobile is a thin adaptation.)

**What the sidebar uniquely provides (the four jobs to re-home):**
1. Neutral "browse" entries to the two libraries (liked songs, playlists)
   without a specific object in hand.
2. Ambient status: the unsorted-count badge.
3. Identity/plan/upgrade strip.
4. Orientation: "which section am I in."

## 4. Direction (step 4)

Level: **structure** (the journey graph), expressed at the **interface** level
as mastheads and cards.

Controlled vocabulary:
- Do say: *home* (the dashboard, internally), *masthead* (per-page header
  band), *shelf* (a hub section that previews + links to a spoke), *spoke*
  (a destination page).
- Don't say: *menu*, *nav*, *sidebar*, *hub page* (in UI copy), *sections*.
  The brand never names its own chrome.

Noun-verb requirements (outcomes, not widgets):
- A listener can reach any of the five destinations from the dashboard in one
  interaction.
- A listener on any spoke can return home in one interaction, from an
  affordance inside the page (not only browser back).
- A listener can move between sibling spokes without passing through home
  when the content implies the relationship (song → its matched playlist,
  match → strictness settings, playlist → its tracks' songs).
- A listener landing on a deep link (`?song=slug`, `/playlists/$ref`,
  checkout return) can answer "what page is this, what are my options, how do
  I get home" without prior context (Krug's trunk test).
- A listener always sees how many songs are waiting to be matched somewhere
  ambient, without opening `/match`.

## 5. Measures (step 5)

| Intent | Baseline (now) | Indicator | Flag |
| --- | --- | --- | --- |
| Home is sufficient | Sidebar carries ~3 nav clicks/session (assumed — instrument first) | % of navigations originating from dashboard shelves vs. anywhere else | Shelf-originated nav < old sidebar nav after 2 weeks |
| No wayfinding regressions | No pogo-stick data | X→Y→X bounce sequences (the NN/g failing-hub signature) | Pogo rate on any shelf > ~15% of its clicks |
| Match throughput unharmed | Time from session start → first match action | Same | Regression > 20% |
| Deep links self-orient | — | Bounce rate on `?song=` / `$playlistRef` entries | Bounce above pre-change level |

The one to watch hardest is pogo-sticking: it is the *specific* signature of a
hub whose spokes don't deliver what their cards promised.

## 6. Structure (step 6) — two competing sketches

Both preserve all routes. Both are hub-and-spoke with the dashboard as hub.
They differ in how much persistent chrome survives.

### Sketch A — "The front page" (pure hub, zero persistent nav)

The dashboard becomes an editorial front page whose *sections are the
destinations*, rendered as living content:

```
hearted.                                    (avatar)
Welcome back, @handle          last synced · 2m ago

┌ READY TO MATCH ─────────────────────────────────┐
│  7 songs looking for homes        [fanned art] → /match
└──────────────────────────────────────────────────┘

LIKED SONGS · 1,204                        → /liked-songs
  [3 most recent rows, each → ?song=slug]

PLAYLISTS · 18                             → /playlists
  [cover shelf preview, each → /playlists/$ref]
  + Create a playlist                      → /playlists/new

RECENT ACTIVITY
  [existing feed]
```

Every spoke gets a two-item masthead: wordmark (home) left, avatar (settings)
right. Nothing else persists. Lateral movement is purely contextual
cross-links.

- Worldview encoded: *your library is a place you inhabit; the app has no
  machinery.* Maximal editorial purity.
- Risk: the case-study research found **nobody successful ships literally zero
  persistent affordance** — every product kept a thin rail, a palette, or
  both. Lateral moves (liked-songs → playlists with no object in hand) cost
  two hops and invite pogo-sticking.

### Sketch B — "The masthead line" (hub + one line of type)

Same front-page dashboard, but every page's masthead carries a single quiet
line of text links in the existing nav idiom (text-xs, tracking-widest,
uppercase — the sidebar's typography rotated 90°):

```
hearted.        MATCH · 7    LIKED SONGS    PLAYLISTS        (avatar)
```

- Worldview encoded: *a magazine's masthead — the sections exist, printed
  small, but the page is the point.*
- This is what Stripe/Spotify/Apple Music/Duolingo actually do: hub-first
  content with a *thin* persistent lateral rail (their tab bars ≈ our
  masthead line). It answers orientation (active item), keeps the badge
  ambient (`MATCH · 7`), and kills pogo-sticking for object-less lateral
  moves.
- Risk: it's not really "getting rid of navigation," just rotating it. If the
  goal is the purist version, this reads as a compromise.

### Recommendation

**Sketch A as the destination, Sketch B as the honest first ship.** The
evidence (Wroblewski's hidden-nav engagement data, the universal thin-rail
pattern, Vercel re-adding a sidebar at scale) says chrome removal has a real
discoverability cost that must be bought back with compensating affordances.
Ship B, instrument it, and let the masthead line earn deletion: if
shelf-originated navigation dominates and the line's click share collapses,
remove it and A becomes safe. If lateral clicks stay high, B *is* the answer
and it still deletes the sidebar, the drawer, the hamburger, and 256px of
chrome.

Either way, add a **command palette (cmd-k)** as the power-user escape hatch —
every chrome-light product in the research leans on one, and it covers
known-item seeking (jump to a song, a playlist, settings) that neither sketch
serves.

## 7. Four-systems check (Rosenfeld/Morville/Arango)

- **Organization:** shifts from section-hierarchy to object-driven (OOUX):
  songs, playlists, matches, and their relationships *are* the structure. The
  hub is a database-style page (shelves over live data), spokes are the
  objects' homes. This matches the brand ontology exactly — "songs find their
  homes" is a relationship graph, and now the user navigates it literally.
- **Labeling:** every navigational element must carry scent. "Match Songs"
  (section label) becomes "7 songs looking for homes" (state + promise).
  Shelf headers are label + live count + preview — the three scent carriers
  information-foraging theory names (link text, context, imagery).
- **Navigation:** global = wordmark + avatar (+ masthead line in B); local =
  each page's existing masthead/toolbar; contextual = the cross-link graph
  (song panel → suggested playlists as *links*, not just add-actions; match
  card → the target playlist; settings ← scoped "Back to match" pattern,
  generalized to "Back to {parent}" with the parent named). Supplemental =
  cmd-k. No breadcrumbs — the app is only ever two levels deep; labeled
  back-links are the house idiom and suffice.
- **Search:** stays scoped (library lens in the panel, liked-songs toolbar) —
  correct per the "search zones" principle. Cmd-k becomes the cross-zone
  known-item finder. Search never substitutes for the shelves (NN/g: search
  and structure are complementary, not interchangeable).

## 8. Orientation through motion, not chrome

The sidebar's last job — "where am I" — can be partially replaced by **spatial
continuity**: the codebase already uses the View Transitions API for playlist
cover → detail morphs. Extend the same idiom hub → spoke: the Liked Songs
shelf header morphs into the `/liked-songs` page title; a shelf's preview rows
morph into the top of the list; the match CTA's fanned art morphs into the
match stage. Arriving somewhere *by watching it grow out of where you were* is
orientation the sidebar never provided. This is the design-language payoff:
navigation stops being teleportation between sections and becomes movement
within one continuous place.

## 9. Adjustment plan (step 7)

- **Smallest first step (no removal yet):** make the dashboard sufficient —
  add the Liked Songs and Playlists shelves with live counts and previews.
  The sidebar stays; instrument which system users actually use. This is
  shippable now and valuable even if the sidebar never leaves.
- Then: per-page masthead (wordmark + avatar everywhere), generalize the
  labeled back-link pattern, land cmd-k.
- Then: remove the sidebar behind a flag; watch the step-5 flags for two
  weeks; keep or fold the masthead line per the data.
- **Failure signals:** pogo-sticking above threshold; deep-link bounce up;
  users reaching settings less (the footer strip today is a strong settings
  scent — the avatar must inherit it); support signals of "can't find X".
- **Discipline commitment:** hub-first survives only while the destination
  set stays ≤ ~6 and flat. Vercel is the cautionary tale — at 10+ sections
  teams re-add sidebars. Every future feature must justify living *inside* an
  existing object's world (song, playlist, match, settings) rather than
  claiming a new top-level place. The sidebar's removal is an architectural
  constraint on the roadmap, not just a layout change — arguably its biggest
  benefit.

## Open questions for the maintainer

1. Is Sketch A purity worth a two-step migration, or is B's masthead line an
   acceptable permanent state?
2. Mobile: with the drawer gone, is B's masthead line + avatar the whole
   mobile story (it fits one line), or does mobile stay drawer-based longer?
3. Cmd-k scope: navigation-only, or also actions (add to playlist, start
   match)? Navigation-only is the cheap, safe first version.
4. Should the unsorted-count badge get an ambient home in Sketch A (e.g. a
   quiet dot/count near the wordmark), or is the dashboard shelf enough?
