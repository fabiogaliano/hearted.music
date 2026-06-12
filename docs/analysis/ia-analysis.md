# hearted. — Information Architecture Analysis

> Frameworks layered: Abby Covert's *How to Make Sense of Any Mess* (7-step sensemaking, applied at the app level) + Rosenfeld/Morville/Arango's *Information Architecture* 4e (four-systems review, applied per route).
>
> Mode: **Single structured pass** (Mode B). Treat this as a hypothesis to react to, not a finished plan. Sections marked `[NEEDS INPUT]` flag places where the analysis cannot honestly proceed without user confirmation.
>
> Date: 2026-05-20

---

## Part I — App-level sensemaking (Covert's 7 steps)

### Step 1 — Identify the Mess

**Users** (inferred from code, not validated with research):

- A music listener with a Spotify library of "liked songs", who has installed (or is being asked to install) the hearted. Chrome extension.
- Two tiers: **Free** (with a finite *credit balance* to "unlock" songs for AI analysis) and **Unlimited** (subscription-based, unbounded analysis).
- New users are funnelled through a multi-step onboarding wizard.

**Stakeholders** (inferred):

- A small product team that owns the app + extension + AI enrichment pipeline.
- Stripe (billing dependency); Google (auth); Spotify (data source, via extension).
- Sentry (observability — tunneled).

**What users are currently being asked to interpret across the app:**

- The *state* of a song: `pending`, `analyzed`, `analyzing`, `locked`, `unlocked`, `matched`, `dismissed`, `suggested`. That is **eight overlapping states** layered onto a single noun. Some are mutually exclusive, some are not — and the code does not appear to make this hierarchy explicit in the UI.
- The *state* of a playlist: `available` vs `target` (a.k.a. "active") — a binary partition that the user must induce from two side-by-side panels (`ActivePlaylistsPanel` + `PlaylistLibrary`).
- The *meaning of a "match"*: in nav ("Match Songs"), in scoring ("match score 87%"), in the review session ("matching session"), and as a verb ("add this match"). One word, four jobs.
- The *meaning of balance*: "songs to explore" appears in the Sidebar footer, "songs remaining" appears in Settings, "{N} songs ready to explore" appears post-checkout. Three phrasings, one concept.

**Dominant root cause:** *Not the right kind of information* (root cause #3), combined with *too much information arranged ambiguously* (root cause #1). The app is not missing data — it has rich data. It is missing **a controlled vocabulary** that lets users build a stable mental model of what a "song" is at any given moment and what they can do about it.

**Mess statement (one paragraph):**

> hearted. presents a music listener with a rich, multi-state library where each song can be in any of ~eight overlapping conditions, playlists are partitioned by an implicit binary they must infer, and the central verb "match" is reused for navigation, scoring, and a guided session. The user is not lost because content is missing; they are lost because the system speaks several dialects of the same domain language at once, and never resolves them into a single shared lexicon.

---

### Step 2 — State Your Intent

**Why does this exist?** (inferred from landing copy and onboarding flow) — to surface narrative meaning inside a listener's existing Spotify library ("the stories inside your liked songs… what do they say about you?") and route those songs into playlists they will actually keep using.

**What is it?** — A library-augmentation tool sitting *on top of* Spotify, not a replacement. The user already has the data; hearted. annotates and re-routes it.

**How will it deliver?** — Through an enrichment pipeline (analysis), a curation surface (matching), a library browser (liked songs), and a destination model (playlists).

**Adjective list — the experience aims for (inferred from copy + UI restraint):**

1. Intimate
2. Restrained
3. Editorial
4. Patient (it lets the user *decide* match by match)
5. Trustworthy with personal data
6. Quietly confident

**Adjectives it is okay NOT having (from the same evidence):**

1. Encyclopedic
2. Flashy
3. Gamified
4. Social / viral
5. Configurable to the bone
6. "Productivity tool"

These two lists are not in obvious contradiction — good sign. The first list is genuinely a constraint set: "patient" *rules out* the kind of progress bars and streaks that would make this look like Duolingo.

**Definition of "good" for hearted.:** the user finishes a session feeling they understand their library a little better than they did before, *with no sense of having been measured or sold to*. This is opposite-of-most-apps "good", which means small UX details (a misplaced counter, an over-loud paywall, a too-cheerful empty state) can break the spell out of proportion to their visual weight.

---

### Step 3 — Face Reality

**Users & players:** owner, casual listener, power listener (large library, opinionated about playlists), former user returning to refind, the extension-blocked user.

**Factors:** Spotify API constraints (rate-limit-driven enrichment, hence the *locked* model); cost-per-analysis (hence credits); Stripe webhook latency (hence the `/checkout/success` polling page); a Chrome extension dependency that is invisible on first paint.

**Channels:** desktop browser (primary); mobile (untested — no responsive evidence in the routes file); the *extension itself* (sync), which is a second surface that the web app cannot directly control.

**Three "real" diagrams the app *needs* but does not visibly produce:**

1. **State diagram of a song** — `liked → pending → unlocked (consumes credit) → analyzing → analyzed → (suggested → matched / dismissed)`. This exists implicitly; the user should see it explicitly somewhere (probably in `/faq` or as inline hint copy).
2. **Block diagram of the playlist universe** — `Spotify playlists → synced → split into {available, target} → target ⊂ match candidates`. The `available / target` split is the load-bearing concept of `/playlists` but is named only by panel headers.
3. **Journey map for the new-user onboarding** — already exists structurally (the wizard) but the gating is one-way; no map for *re-entry* if a user drops out at, say, `flag-playlists`. (Per code: `flag-playlists` is auto-skipped if user has no playlists — but what about the reverse case where they install the extension late?)

`[NEEDS INPUT: who do you actually believe your primary user is — the casual or the power listener? The product currently signals "intimate / editorial" which suits the casual user, but features like target-vs-available playlist partitioning suit the power listener. These choices will pull in opposite directions.]`

---

### Step 4 — Choose a Direction

**Working level:** `interface` and `structure`. The visual layer is consistent enough; the structural layer (taxonomy of song states, controlled vocabulary, navigation grammar) is where the work needs to land.

**Controlled vocabulary — proposed do-say / don't-say:**

| Concept | Do-say (proposed) | Don't-say |
|---|---|---|
| The user's library | **Liked Songs** | "your music", "your library" *(both currently appear)* |
| A song waiting for AI analysis | **Pending** | "locked", "unanalyzed", "queued" |
| A song the user has paid to analyze | **Unlocked** (one-time event) → then disappear; show only `analyzed` | Don't keep saying "unlocked" forever; it stops being a state |
| Match candidate playlists | **Suggestions** | "matches" *(reserve "match" for the act, not the noun)* |
| Currency | **Songs** (always count of songs, never "credits" or "tokens") | "credits", "tokens", "balance" *(in user-facing copy)* |
| Playlists user wants to populate | **Target playlists** | "active playlists" *(currently used in code; weaker)* |
| Spotify playlists not yet enrolled | **Library** | "available" *(very vague — "available for what?")* |

This vocabulary cleanup is the single highest-leverage change in this whole document.

**Noun-verb requirements at the app level:**

1. *A listener can see how many of their songs are pending analysis at a glance.*
2. *A listener can spend their balance without re-asking what the balance is in.*
3. *A listener can refind a song they reviewed last week without remembering its title.*
4. *A listener can decline a suggestion without dismissing the song.* (Currently unclear — does "Dismiss" hide the song, hide the suggestion, or both?)
5. *A listener can pause and resume an onboarding wizard without losing context.* (Code shows step-saving — good.)

---

### Step 5 — Measure the Distance

Working baseline candidates (only the user knows current values):

| Intent | Baseline | Indicator | Flag |
|---|---|---|---|
| Listener finishes a matching session feeling clarity | `[NEEDS INPUT]` | % of sessions ending in `CompletionScreen` vs. abandoned mid-session | Drop >10pp week-over-week → review session length / fatigue |
| Onboarding completion | `[NEEDS INPUT]` | % of new sign-ups reaching `match-walkthrough` | Drop at any step >20% → label / copy audit of that step |
| Vocabulary clarity | unknown | Number of distinct phrasings of "balance" in shipped copy | >1 phrasing → red flag |
| Refinding | unknown | % of song-detail opens that come from the `?song=<slug>` deep link (refind) vs. fresh browse | Low refind suggests history/recents are missing |

Note the deliberate fuzziness in row 3 — "number of phrasings" is a measure of *editorial discipline*, not of user behavior, but it is directly actionable and surfaces drift early. Covert: "imperfect measures still orient effort."

---

### Step 6 — Play with Structure (deferred to Part II)

This is the place where the per-page IA analysis lives. See **Part II**.

---

### Step 7 — Prepare to Adjust

- **Cadence:** monthly IA review until the vocabulary stabilizes; quarterly thereafter.
- **Artifact ownership:** one person owns the controlled vocabulary table. One person owns the song-state diagram. They are usually the same person.
- **Smallest-next-step (recommended):** ship the vocabulary cleanup in *Sidebar + Settings + Dashboard header* simultaneously — these are the three places balance and song-state language collide most. Do not stage them — partial rollout will make the inconsistency worse, not better.
- **Failure signal:** any new feature lands using vocabulary that is *not* in the do-say table. That is the single review gate.

---

## Part II — Per-page IA review (Rosenfeld/Morville/Arango 4 systems + Covert structural critique)

Each section follows the same shape: **Intent → Ecology → Organization → Labeling → Navigation → Search/findability → Mess diagnosis → Recommendations.**

---

### `/` — Landing

**Intent:** convert an unauthenticated visitor; signal the product's emotional register.

**Ecology:** Users = curious visitors; Content = a single editorial pitch + one rotating featured song + a "live" matching preview; Context = pre-trust, no skin in the game.

**Organization:** Linear top-to-bottom. Hero → demo → CTA → footer. **Sequential pattern** — the right choice; a landing page is one of the few places hierarchical or heterarchical structures are *worse* than a single ordered path.

**Labeling:** The voice is genuinely distinctive — *"the stories inside your liked songs… what do they say about you?"* This is the strongest part of the IA. **However:** the CTA button label "SIGN In" is jarring against this voice (all-caps "SIGN" + sentence-case "In" — a casing inconsistency in three characters). Either commit to lowercase ("sign in") to match the rest of the editorial register, or use proper title case ("Sign in").

**Navigation:** Outbound to `/login`, `/faq`, `/privacy`, `/terms`. No global nav — correct for a landing page.

**Search:** N/A.

**Mess diagnosis:** Mostly clean. The mess is in the *CTA button casing only*.

**Recommendations:**
- Fix `SIGN In` casing.
- Consider a 3-line "how it works" strip above the bottom CTA — currently the visitor sees the emotional pitch and the live demo, but nothing that connects them to "what will the next 5 minutes look like." This is invisible IA: setting expectations is itself a structural choice.

---

### `/login`

**Intent:** authenticate. That is the entire job.

**Ecology:** Users = returners or first-timers. Content = one button. Context = the user has *already decided* by reaching this page.

**Organization:** N/A — single decision point.

**Labeling:** Solid. "Continue with Google" is the conventional label; deviating from convention here costs trust for no gain.

**Navigation:** The "Back" link to `/` is good — login pages without an escape hatch are an under-respected anti-pattern.

**Search:** N/A.

**Mess diagnosis:** Clean. The only invisible IA decision here is the post-login routing logic (existing → `/dashboard`, new → `/onboarding`). This logic is correct but **invisible**, which means it must never get *quietly* changed — a regression here would silently send new users to a dashboard they can't use.

---

### `/faq`, `/terms`, `/privacy` (legal triad)

**Intent:** answer pre-purchase / pre-trust questions, satisfy legal requirements.

**Organization:** Numbered hierarchy with section TOC. **Exact classification** (numeric ordering) layered on **ambiguous classification** (topical headings). Correct.

**Labeling:** The h1 "questions & answers" instead of the more conventional "FAQ" is a register choice consistent with the editorial voice. Sustainable as long as the *footer link* and the *page h1* match — which they should, but `[NEEDS INPUT: verify footer links read "FAQ" not "Questions & Answers" — if they diverge, that's a labeling-as-a-system failure]`.

**Navigation:** Footer back-links to siblings. Good.

**Search:** None within the FAQ. **Recommendation:** if the FAQ grows past ~20 questions, add an in-page jump-to-section nav or a simple keyword filter. Below that threshold, the TOC is enough.

**Mess diagnosis:** Currently clean; main risk is *content drift* — if the FAQ acquires answers about "credits" when the rest of the app has migrated to saying "songs", the legal triad becomes the place where the dropped vocabulary lives forever.

---

### `/_authenticated` — Auth shell + Sidebar (global nav)

This is the single most important IA artifact in the app. Everything else inherits from it.

**Intent of the shell:** project consistent chrome, enforce auth, gate onboarding.

**Intent of the Sidebar:** answer the navigation stress test — *Where am I? What's this part of? Where can I go? How do I get home?*

**Organization of Sidebar:**

```
Home              → /dashboard
Match Songs (N)   → /match
Liked Songs       → /liked-songs
Playlists         → /playlists
```

This is a **flat hierarchy of four items** — well within the breadth heuristic. The badge on "Match Songs" is good (carries forward count); the lack of badges on the other three is a deliberate restraint (an "intimate" app does not stack four numbers next to four nav items).

**Labeling critique:**

1. **"Home" vs "Dashboard"** — the nav label says `Home`, the URL says `/dashboard`, and the dashboard header says `Welcome back`. Three different names for the same place. **Recommendation:** pick one. Strong preference for `/dashboard` URL + `Home` label + a header that does NOT use either word ("Welcome back" is fine, or just the user's name).
2. **"Match Songs" as a nav label** — `Match` is a noun in some contexts (a suggestion), a verb in others (the action), and the name of the page (`/match`). The nav label tries to disambiguate with `Match Songs` (verb + object), which is the right instinct. But then the URL is the verb alone (`/match`) which contradicts the page label. **Recommendation:** rename the URL to `/match-songs` *or* the nav label to just `Match`. The former is friendlier for sharing; the latter is more economical.
3. **"Liked Songs" capitalization** — title case here, but the rest of the app uses lowercase headings (`hearted.`, `questions & answers`). Either commit to title case for nouns-as-page-titles, or lowercase. Pick one and codify in the controlled vocabulary.
4. **Footer balance line** — "{N} songs to explore" is the *fourth* phrasing of balance I found. Standardize.

**Navigation stress test** (run on a random deep page, e.g. `/playlists/spotify:playlist:abc`):

1. *Where am I?* — Sidebar shows `Playlists` active. ✅
2. *What section is this part of?* — Clear: Playlists. ✅
3. *What are my options?* — Global nav only; no local nav within the Playlists section. ⚠️ — if the playlist detail view grows tabs (Tracks / Analytics / Settings), local nav will need to appear.
4. *How do I get home?* — Click `Home` in sidebar. ✅
5. *Do I trust the labels?* — Mostly yes, except for "Home/Dashboard/Welcome back" (see above).

**Mess diagnosis:** the Sidebar is the most exposed IA artifact in the app and currently carries three small inconsistencies (Home/Dashboard, Match vs Match Songs, casing). Fix these first.

---

### `/_authenticated/dashboard` — the most-trafficked surface ⭐

**Intent:** orient the user on return; surface the *next action*; show progress.

**Ecology:** the dashboard is what the user sees right after auth and after every checkout. It must work for both first-day-of-use and 90th-day-of-use users with the same composition.

**Composition (3 sections):**

1. **DashboardHeader** — `Welcome back` / display name / stats bar (`{N} SONGS · {N} PLAYLISTS · {N}% ANALYZED | {lastSyncText}`) / Sync link.
2. **MatchReviewCTA** — `Ready to match` / `{N} songs to match` / FanSpreadAlbumArt / `Start →`. Conditional on `reviewCount > 0`.
3. **ActivityFeed** — `Recent Activity` / list of ActivityItem.

**Organization analysis:**

This is a **hierarchical layout** that is also implicitly **temporal**: top = persistent state (header), middle = present-tense call-to-action, bottom = past-tense activity. That ordering (state → action → history) is excellent placemaking. It mirrors the way a desk looks: inbox at top, current task in the middle, archive at the bottom.

**Labeling critique:**

1. `{N} SONGS · {N} PLAYLISTS · {N}% ANALYZED` — all-caps stats. This is a register break from the editorial lowercase elsewhere. The choice is defensible (all-caps for monospaced micro-labels is a common pattern) but it must be consistent — `[NEEDS INPUT: are these all-caps stats also all-caps in Liked Songs, Settings, etc.? If not, regularize.]`
2. `Welcome back` — fine, but combined with the sidebar `Home` and the URL `/dashboard`, this is the third name for the same place. (See Sidebar critique.)
3. `Ready to match` + `Start →` — strong, action-shaped labels. The `→` arrow is a non-verbal cue that reinforces *forward motion*. Keep.
4. `Recent Activity` — generic. Consider `What you've done lately` or `Recently` — these match the editorial voice better. Or simply remove the heading and let the list speak (placemaking-by-rhythm).

**Navigation analysis:**

The dashboard is *only* outbound: header → Sync action; MatchReviewCTA → `/match`; ActivityFeed items → presumably song-detail or playlist-detail. **Recommendation:** confirm that every `ActivityItem` is clickable to its source — an activity feed that doesn't link is decorative.

**Search:** None on dashboard. Correct — dashboard answers the *known-task* need ("what should I do now?"), not the known-item need.

**Information-need coverage:**

| Need | Covered on dashboard? |
|---|---|
| Known-item ("find that song from yesterday") | Weakly — via ActivityFeed only if it links |
| Exploratory ("what's in my library?") | No — must navigate to Liked Songs |
| Exhaustive | No |
| Refinding | Partially — same as known-item |

This is correct: a dashboard should *not* try to be a finder. It should be a launchpad.

**Mess diagnosis:** The dashboard is the **healthiest** page in the app. Its only issue is *inherited* from the global vocabulary mess (the `Home` / `Dashboard` / `Welcome back` triplet).

**Recommendations:**

- Make sure ActivityFeed items are linkable to their referent.
- Verify the stats bar uses the same number formatting as Settings and Liked Songs (`12,408 songs` vs `12408 SONGS` — these *will* drift apart without a shared formatter).
- Consider a deliberate empty-state for ActivityFeed: even if the section is hidden when empty (which is the current behavior), a brand-new user with no activity may interpret the dashboard as "broken" — show a *one-line* welcome message instead.

---

### `/_authenticated/playlists` (list) + `/playlists/$playlistRef` (detail)

**Intent:** decide which playlists hearted. should be matching *into*; explore the library; deep-link to a single playlist.

**Ecology:** Users = a listener who has *opinions* about their playlists. Content = potentially hundreds of playlists. Context = the user has to do an unfamiliar curation step (`target` vs `available`) before matching is useful.

**Organization analysis:**

The page uses a **binary classification** (`Active` / `Available`) layered on a **database structure** (each playlist is a record with name, description, track count). This is the right structure but the binary is *under-explained*.

**Labeling critique:**

- `Active Playlists` (in code: `ActivePlaylistsPanel`) vs `Available` (the library) — the conceptual pair is `target` ↔ `library`, not `active` ↔ `available`. "Active" suggests "currently running" (which is not the meaning); "available" suggests "available for purchase" or "available to listen" (also not the meaning).
- **Recommended renaming:** `Target playlists` / `Your playlists` (or `From Spotify`).

**Navigation:**

- Deep link to a single playlist via `$playlistRef` — good.
- Unresolvable ref redirects to `/playlists` — good.
- No breadcrumb from playlist detail back to playlists list (the sidebar carries this, but only because Playlists is a top-level nav item — break that convention and the user is lost).

**Search:**

- **No search within playlists.** For a user with >50 playlists, this is the moment the IA starts to fail. The library will become un-scannable. **Recommendation:** ship a single search-box (the *single box with smart defaults* IA principle), scoped to playlist name + description. Stemming and synonym expansion are unnecessary at this scale — exact + prefix match is fine.

**Information-need coverage:**

| Need | Covered? |
|---|---|
| Known-item ("the playlist I made for road trips") | Weak without search |
| Exploratory ("what playlists do I even have?") | Yes (the Available grid) |
| Exhaustive ("review every playlist") | Possible but tedious |
| Refinding | Weak |

**Mess diagnosis:** *too much information* (a large library of playlists) presented through *not the right kind* of organization (a binary split with vague labels). Search would meaningfully change the calculus.

**Recommendations:**

1. Rename `Active` → `Target` and `Available` → `Library` (or whatever you settle on in the controlled vocabulary).
2. Add a single search box to the library.
3. On the playlist detail view, surface the *binary status* prominently — a target playlist and a library playlist should look different at a glance.
4. Empty states ("No playlists synced yet" / "Install the hearted. extension…") are doing IA work — they educate the user about the extension dependency. Keep this. Audit the phrasing.

---

### `/_authenticated/liked-songs`

**Intent:** browse the full library; unlock songs; open a song's detail.

**Ecology:** Users = same as playlists, but at a much larger scale (thousands of songs). Content = the central object of the entire app. Context = this is where the *song-state taxonomy* is most visible.

**Organization:**

- **Database structure** (infinite-scroll list of SongCards).
- **Filter facet** with values `all | pending | analyzed | matched`. This is the first place in the app where the filter taxonomy is exposed to the user, and it is **already inconsistent** with the song-state vocabulary elsewhere:
  - Code says `locked` and `pending` are different things (header stats: `{N} analyzed · {N} pending · {N} locked`).
  - But the filter offers only `pending`, not `locked`.
  - Question: is a `locked` song also `pending`? If yes, the filter is fine. If no, the filter is missing a value.
- **Selection mode** (`SongSelectionBar`) is a modal sub-structure — a temporary new IA for the duration of a multi-select.

**Labeling critique:**

- `Your Music` (kicker) + `Liked Songs` (h1) — two phrasings of the same library, again. The kicker reads as a section name, the h1 as the page. Acceptable, but consider whether the kicker is doing any work.
- Stats bar `{N} songs · {N} analyzed · {N} pending · {N} locked` — **four counts on one line**. This is right at the edge of what a user can hold in working memory. The IA test: can a user read this bar and tell me *which count is going up over time*? If not, consider grouping (`{analyzed + pending}/{total} ready` + a small lock indicator for the rest).
- Filter values: lowercase, single-word — consistent. Good.
- `Unlock Songs` button — the verb `unlock` is the strongest piece of *invisible IA* in the app: it makes the credit-spending action concrete. But it lives in tension with the song-state where `unlocked` is supposed to be a *transient* state on the way to `analyzed`. Recommendation: in the button label, say `Analyze {N} songs`, not `Unlock` — match the verb to the user's *outcome*, not the internal pipeline step.

**Navigation:**

- Slide-in `SongDetailPanel` with prev/next — this is excellent IA for *refinding* and *exhaustive* needs. It preserves the list as context.
- URL search params `?filter=...&song=...` make detail views deep-linkable — also excellent.
- No global search — same gap as Playlists.

**Search:**

- **The same library-scale problem as playlists, but worse** (thousands of songs vs dozens of playlists). A user looking for "that one ambient track" has *no path* except scrolling.
- **Recommendation:** highest-priority IA addition in the entire app. Single search box, search zone = the user's liked songs only, fields = track name + artist + (if available) album.
- Once search lands, the four-value filter becomes faceted nav (`Filter: pending` ∩ `Search: piano`).

**Information-need coverage:**

| Need | Covered? |
|---|---|
| Known-item | **No** — critical gap |
| Exploratory | Yes (scroll) |
| Exhaustive | Yes (scroll + filter) |
| Refinding | Partial (prev/next in detail panel, deep-linkable song) |

**Mess diagnosis:** *too much information, well-arranged, but no search* — a classic Rosenfeld failure mode. Browse-only structures fall apart at library scale.

**Recommendations:**

1. **Add search.** This is the single highest-impact change in the app.
2. Rename `Unlock Songs` → `Analyze Songs` in the user-facing button.
3. Resolve the `pending` vs `locked` ambiguity: either collapse them in the UI or surface both in the filter.
4. The dark/light toggle fixed bottom-right is misplaced — it belongs in Settings (where there is already a Theme color section). Two theme-controls in two places is a labeling-system failure.

---

### `/_authenticated/match`

**Intent:** review AI-generated suggestions one song at a time; add or dismiss.

**Ecology:** the most *sequential* page in the app. Users = anyone with a non-empty review queue. Content = a single song at a time + 3-5 candidate playlists. Context = the user is committing to a *session* — this is the only place where session-mindset is the right frame.

**Organization:**

- **Sequential pattern** — one song at a time, ordered queue. The right choice.
- Within each song, a **ranked list** of suggestions by match score — exact classification (numeric score) used to sort an ambiguous classification (semantic match). Good.

**Labeling critique:**

- `Match Songs` (sidebar) → `Matching` (header) → `Add` / `Dismiss` / `Next Song` (actions) → `Session Complete` / `added, dismissed, skipped` (completion). **The word "match" is overloaded across nav, action, and noun.** And `Skipped` is introduced *only* on the completion screen — there is no `Skip` button in the session itself (the action equivalent is presumably `Next Song`). This is a controlled-vocabulary failure: a term appears in summary that doesn't appear in the verbs.
- `Add` and `Dismiss` are well-paired binary actions. `Next Song` is a different action shape (advance) — it should look visually different from Add/Dismiss to avoid implying it's a third decision.
- `Real matches are ready` (walkthrough mode label) — this label is *suspicious*: it implies the previous matches the user saw weren't real. Rephrase.

**Navigation:**

- `MatchingEmptyState` — `Nothing to match just yet.` / `Your songs have found their home.` — two empty states for two different reasons. Excellent IA — most apps collapse these into one generic message.
- `Back home` link in empty state — good escape hatch.
- New-snapshot banner with `Refresh` — handles the *stale-data* problem honestly.

**Search:** N/A in session mode.

**Information-need coverage:** session mode is *not* a find surface; it's a triage surface. Correctly designed for *one* mode only.

**Mess diagnosis:** the structural design is excellent. The mess is purely in the lexicon: the four-way overload of "match" and the `Skipped` ghost-verb.

**Recommendations:**

1. Reserve **"match"** for the *act* (`/match-songs`, `Match Songs` nav, `match score`). Use **"suggestion"** for the *noun* (`Add this suggestion`, `Dismiss this suggestion`).
2. Either add an explicit `Skip` button or remove `Skipped` from the completion stats.
3. Rename `Next Song` → `Skip` if that's what it semantically does, or keep it as the queue-advance and stop reporting `Skipped` in completion.
4. Replace `Real matches are ready` with something that doesn't imply earlier matches were fake.

---

### `/_authenticated/onboarding`

**Intent:** carry a new user from sign-up to first useful match.

**Ecology:** Users = first-timers, *only*. Content = the same content as the rest of the app, but staged. Context = sidebar is hidden — the user has no escape hatch except completing or quitting.

**Organization:**

- **Pure sequential pattern**: `welcome → install-extension → syncing → flag-playlists → pick-demo-song → song-walkthrough → match-walkthrough`.
- **One conditional branch** (`flag-playlists` skipped if no playlists). Good.
- **Step-saving** in URL — good.

**Labeling critique:**

- Step names are *internal* tokens (`flag-playlists`, `pick-demo-song`). Whatever the user sees in the UI for these steps should not be those tokens. `[NEEDS INPUT: confirm the visible step labels are user-friendly]`.
- The verb `flag` (in `flag-playlists`) is yet another verb for the `target` action. **The same act has three names in the codebase: `flag`, `target`, `active`.** This is the strongest single piece of evidence that the controlled vocabulary work is overdue.

**Navigation:** intentionally constrained. The trade-off — no escape, no choice — is appropriate for onboarding, but means *every* step must be high-quality because the user cannot route around a broken one.

**Search:** N/A.

**Mess diagnosis:** structurally sound, vocabulary-poor.

**Recommendations:**

1. Resolve `flag` / `target` / `active` to one verb in both code and copy.
2. Audit every visible step label and gerund (`Syncing your library…`, `Pick a song…`) for register consistency with the rest of the editorial voice.
3. Add a `[Save & exit]` affordance on each step that writes the saved step and routes to `/dashboard` — currently the only way to leave is to close the tab, which is a hostile design choice for a "patient" product.

---

### `/_authenticated/settings`

**Intent:** account management, theme, billing, extension status, sign out.

**Organization:**

- **Topical hierarchy**: Account → Theme → Billing → Extension → Sign out.
- This ordering is *probably* by frequency-of-need (descending) — Account is read often, Sign out rarely. Verify with usage data.

**Labeling critique:**

- `Theme color` — fine. But the dark/light toggle lives in `/liked-songs`. **Reconcile.**
- `Manage subscription` (Stripe portal link) — opens external in new tab. The IA decision to delegate billing to Stripe is correct, but the *return path* needs care: after returning from Stripe, does the user land back on Settings or on Dashboard? `[NEEDS INPUT]`
- `Chrome extension` with `Checking / Connected / Not detected` — this is a tiny state machine, well-labeled. Good.
- `songs remaining` — fourth phrasing of balance. Standardize.

**Navigation:** Sign out → `/`. Good — terminal action returns to the unauthenticated landing.

**Search:** N/A — settings is small enough.

**Mess diagnosis:** mostly clean. Two concrete issues:

1. Theme controls split across two pages.
2. Balance language drift.

**Recommendations:**

1. Consolidate theme controls to Settings; remove from `/liked-songs`.
2. Standardize balance phrasing.
3. Add a one-line *plan summary* at the very top: `You're on Unlimited. {N} months active.` or `You're on Free. {N} songs remaining.` — currently the user has to read several rows to derive this.

---

### `/_authenticated/checkout/success` + `/checkout/cancel`

**Intent:** confirm purchase outcome; route back into the product.

**Organization:** state machine with 4 visible states (pending, timed-out, confirmed-pack, confirmed-unlimited). Cancel is a silent redirect.

**Labeling critique:**

- The voice is lovely here. `your songs are waiting` / `{N} songs ready to explore.` / `unlimited, all yours` — all lowercase, all editorial. This is the page where the brand voice is most consistent.
- **However:** `{N} songs ready to explore` is the *fifth* phrasing of balance. Pick this one or pick the Sidebar one, but ship one.

**Navigation:** All terminal states route to `/dashboard`. Correct.

**Search:** N/A.

**Mess diagnosis:** clean. This page is doing its IA job well.

**Recommendations:** consider whether the *cancel* path should leave any trace — currently it's a silent redirect. A toast (`Checkout cancelled — your card was not charged`) would *reduce* user anxiety, not increase it.

---

## Part III — Cross-cutting findings

### Vocabulary drift (the single biggest issue)

| Concept | Appearances |
|---|---|
| The user's library | "Your Music" (Liked Songs kicker), "Liked Songs" (h1, nav), "your library" (FAQ?) |
| Currency | "songs to explore" (Sidebar), "songs remaining" (Settings), "{N} songs ready to explore" (Checkout success), "credits" (code), "balance" (code) |
| Target playlists | "Active" (Playlists page), "Target" (code), "Flag" (onboarding step) |
| Suggestions | "Match", "Matches", "Suggestions" |
| Song state | `pending`, `locked`, `unlocked`, `analyzed`, `analyzing`, `matched`, `dismissed`, `suggested` |

**Action:** make a single controlled-vocabulary table the source of truth for both code and copy. Wire it into the codebase as `src/lib/copy/controlled-vocabulary.ts` (one place) so that the same string flows to all surfaces. This is invisible IA — the user never sees the file, but they feel its absence today.

### Navigation gaps

1. **No in-app search.** The single highest-impact addition. Start with Liked Songs (scope = user's songs only), then Playlists.
2. **No breadcrumbs in playlist detail.** Currently relies on the sidebar holding the section identity — fragile.
3. **No "What's new" / changelog surface.** Activity feed covers user activity but not product activity. Optional.

### Labeling system inconsistencies (concrete fixes)

- `SIGN In` → `Sign in` (landing)
- `Home` / `Dashboard` / `Welcome back` → pick two-of-three at most
- `Match Songs` (nav) vs `/match` (URL) → align
- All-caps stats vs lowercase headings → codify the rule
- `Unlock Songs` button → `Analyze Songs`
- Theme controls in two pages → consolidate

### Navigation stress test — overall pass rate

Running the test on five random deep pages:

| Page | Where am I? | Section? | Options? | Home? | Trust labels? |
|---|---|---|---|---|---|
| `/dashboard` | ✅ | ✅ | ✅ | ✅ | ⚠️ Home/Dashboard |
| `/playlists/$ref` | ✅ | ✅ | ⚠️ no local | ✅ | ⚠️ Active/Available |
| `/liked-songs?song=X` | ✅ | ✅ | ✅ | ✅ | ⚠️ pending/locked |
| `/match` (session) | ✅ | ✅ | ⚠️ minimal | ✅ | ⚠️ "match" overload |
| `/settings` | ✅ | ✅ | ✅ | ✅ | ⚠️ balance phrasing |

Pattern: *where* is always clear (good). *What things are called* is consistently the weak axis.

---

## What to revisit first (the 2–3 weakest steps)

1. **Step 4 (Choose a Direction) — controlled vocabulary.** This is the single intervention that unblocks the most pages. Ship one table; rewire copy and code.
2. **Step 6 (Structure) — search.** Liked Songs at library scale cannot be browsed-only. Add search before adding any new feature.
3. **Step 3 (Face Reality) — primary-user decision.** `[NEEDS INPUT]` Until you commit to "casual" vs "power" listener as the primary, label choices and feature priorities will keep contradicting each other.

---

## Adjustment plan (Step 7 concrete)

| Artifact | Owner | Review cadence | Update trigger |
|---|---|---|---|
| Controlled vocabulary table | Editorial / Product | Monthly | Any new feature or paywall change |
| Song-state diagram | Engineering / Product | Quarterly | Any new song state introduced |
| Sidebar nav (labels + URLs) | Product | Quarterly | Any new top-level section |
| Onboarding step labels | Product | Per new step | New step or merged step |
| FAQ phrasings | Editorial | Quarterly + on any vocab change | Vocabulary table change |

**Smallest next step the team could ship this week:** the vocabulary table + a single PR that rewires Sidebar footer + Settings billing row + Checkout success page to use the same balance phrasing. One day of work, ripples across the whole app's perceived consistency.

**Failure signal to watch:** any PR merging copy that introduces a new word for an existing concept. Add a CODEOWNERS or PR-template line that explicitly asks the author: *"Did you check the controlled vocabulary table?"*

---

*End of analysis.*
