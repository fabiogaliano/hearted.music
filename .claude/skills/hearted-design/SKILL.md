name: hearted-design
description: High-agency frontend taste system for Hearted — a desktop web app for editorial music exploration. Encodes the live design language (Tailwind v4 tokens, Instrument Serif + Geist typography, theme-prefixed utilities, flat materiality, CSS-first motion with house easings) and routes all voice/copy work to the canonical brand docs in /v1_hearted_brand/brand/. Use when building UI components, pages, reviewing frontend work, or writing user-facing strings. Triggers on: 'build UI', 'create component', 'design', 'review UI', '/hearted-design'.
license: MIT

---

# Hearted Design Taste System

**Calibrated for:** hearted. — editorial, typography-driven, warm-pastel music exploration app.
**Form factor:** Desktop web app. Not a responsive PWA. Mobile breakpoints are out of scope.
**Stack snapshot:** TanStack Start + React + Vite + Bun + Tailwind v4 (CSS-first, no `tailwind.config`).

> This skill is the ground truth for **how Hearted looks and moves**. For **how Hearted speaks**, defer to:
> - `/v1_hearted_brand/brand/VOICE-AND-TONE.md` — voice traits, tone matrix, core patterns
> - `/v1_hearted_brand/brand/COPY-GUIDE.md` — per-surface copy (landing, onboarding, analysis, matching, errors, loading)
> - `/v1_hearted_brand/brand/README.md` — brand quick-reference
>
> Do not invent or restate voice rules here — read those files.

---

## 1. ACTIVE BASELINE CONFIGURATION

* DESIGN_VARIANCE: **6** (Offset — editorial composition, flat materials, sparing accents)
* MOTION_INTENSITY: **4** (CSS-first; Framer Motion permitted for orchestrated transitions, always behind `useReducedMotion`)
* VISUAL_DENSITY: **2** (Art Gallery — whitespace dominant, cards rare)

**AI Instruction:** Do not drift toward higher variance or heavier motion unprompted. If the user explicitly asks for denser layouts or richer motion, adapt; otherwise, stay calibrated.

---

## 2. PROJECT ARCHITECTURE & CONVENTIONS

* **Stack:** TanStack Start + React + Vite + Bun. Routes via `createFileRoute()`. Server functions via `createServerFn`. SSE supported. Use the `tanstack-start-react` skill for router/loader patterns.
* **Tailwind v4, CSS-first.** No `tailwind.config.*` file exists. Tokens are declared in `src/styles.css` via `:root` custom properties + `@theme inline { … }`. Never recreate a v3 config.
* **Package manager:** Bun. Tests: `bun run test` (Vitest).
* **Dependency rule:** Check `package.json` before importing anything new. Output the install command before any code using an unconfirmed dep.
* **No barrel exports.** Import from source files directly.
* **No emoji** in markup, alt text, or copy. Exceptions (text glyphs, not emoji): `♡` (U+2661), `♥︎` (`♥︎`), `♫` — already used in landing AnimatedHeart, checkout success, and AlbumPlaceholder. Don't introduce new ones.

### 2.1 Theme tokens (the only colors that exist)

Tokens live in `src/styles.css` as CSS custom properties and are consumed via **hand-rolled utility classes**, not arbitrary-value Tailwind syntax.

| CSS variable          | Role                                  | Utility classes that use it                                                            |
| --------------------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| `--t-bg`              | Page background                       | `.theme-bg`                                                                            |
| `--t-surface`         | Slightly raised surface, hover bg     | `.theme-surface-bg`, `.theme-hover-surface:hover`                                      |
| `--t-surface-dim`     | Deeper surface (selected, empty art)  | `.theme-surface-dim-bg`                                                                |
| `--t-border`          | All 1px borders                       | `.theme-border-color`, `.theme-border-bg`                                              |
| `--t-text`            | Primary foreground                    | `.theme-text`                                                                          |
| `--t-text-muted`      | Secondary foreground, labels          | `.theme-text-muted`, `.theme-text-muted-bg`                                            |
| `--t-text-on-primary` | Foreground when on `--t-primary`      | `.theme-text-on-primary` (consumed by `.theme-primary-action`)                         |
| `--t-primary`         | Accent (single per screen)            | `.theme-primary`, `.theme-primary-bg`, `.theme-primary-action`                         |
| `--t-primary-hover`   | Accent hover                          | (referenced by `.theme-primary-action:hover`)                                          |

**Use the utility class.** `.theme-text` ✅ — `text-[var(--t-text)]` ❌. The exception is when composing inside an inline `style={{}}` where a CSS-var reference is unavoidable (e.g., `borderLeft: '2px solid var(--t-primary)'`).

### 2.2 Themes & dark mode

Four monochromatic HSL palettes keyed by hue (`src/lib/theme/colors.ts`):

| Key        | Brand name | Hue |
| ---------- | ---------- | --- |
| `blue`     | Hush       | 218 |
| `green`    | Bloom      | 135 |
| `rose`     | Ember      | 340 (default) |
| `lavender` | Reverie    | 300 |

Saturation 12–32%. No raw `zinc-*` / `gray-*` / `neutral-*` Tailwind classes anywhere. No hex literals.

**Dark mode is per-theme**, derived in `src/features/liked-songs/components/song-detail-panel/themed-dark-colors.ts` from the active hue: `bg = hsl(h, 18%, 8%)`, `text = hsl(h, 12%, 94%)`, `accent = hsl(h, satP, 72%)`. Components inside a dark surface (e.g., the `SongDetailPanel` hero) **must receive the palette as a prop** from the panel root — never call `useTheme()` from leaves, which would return the page's light palette and produce contrast bugs.

### 2.3 Allowed non-token color exceptions

These exist by design and are the only acceptable hardcoded values:

* `rgba(255, 255, 255, 0.16)` / `rgba(255, 255, 255, 0.1)` — inset album art outlines on hero art and reviewed thumbnails
* `box-shadow: inset 0 0 0 1px rgba(0,0,0,0.08)` — the `.image-outline` utility for thumbnails (auto-flips to white in dark mode)
* `bg-black/10`, `bg-black/35` — play-button overlay states
* `bg-black/50` — dialog scrim
* `bg-white/15` — Button `secondary` and `card` hover bg

---

## 3. TYPOGRAPHY (the core identity signal)

Two faces. Loaded via Google Fonts in `src/routes/__root.tsx`:

* **Instrument Serif** — display only. Italic and non-italic. No weight axis.
* **Geist** — body & UI. Variable, 100–900.

Applied via `style={{ fontFamily: fonts.display }}` / `style={{ fontFamily: fonts.body }}` from `src/lib/theme/fonts.ts`. **Never via Tailwind `font-*` utilities** — those would need a config.

### 3.1 The type scale (verbatim, by role)

| Role                                  | Font              | Size                                              | Weight                    | Other                                       |
| ------------------------------------- | ----------------- | ------------------------------------------------- | ------------------------- | ------------------------------------------- |
| Page title (h1)                       | Instrument Serif  | `text-page-title` (2.25rem → 3rem @ md)           | `font-extralight` (200)   | `tracking-tight text-balance leading-[0.95]`|
| Page eyebrow / kicker                 | Geist             | `text-xs`                                         | normal                    | `tracking-widest uppercase theme-text-muted`|
| Section label                         | Geist             | `text-xs`                                         | normal                    | `tracking-widest uppercase theme-text-muted`|
| Hero title (match page song)          | Instrument Serif  | `text-5xl` (or `clamp(120px,18vw,220px)` for stats) | `font-extralight` (200) | `leading-[1] tabular-nums` if numeric        |
| Hero title (panel song)               | Instrument Serif  | `text-2xl`                                        | `font-light` (300)        | `leading-tight`                             |
| Active playlist card name             | Instrument Serif  | `text-2xl`                                        | `font-extralight` (200)   | `line-clamp-2`                              |
| Available playlist card name          | **Geist** (not display) | `text-sm`                                   | 300 default / 400 selected | inline `fontWeight`                         |
| Song row title (lists)                | Instrument Serif  | `text-base` / `text-xl`                           | inline 300 default / 400 selected | `leading-[1.1]`                       |
| Artist (under song)                   | Geist OR Instrument Serif italic | `text-sm` / `text-xl`              | normal / italic           | italic only on hero/panel artist            |
| Body                                  | Geist             | `text-base` or `text-sm`                          | normal                    | `leading-relaxed` for paragraphs            |
| Metadata / timestamps                 | Geist             | `text-xs`                                         | normal                    | `tabular-nums` when numeric                 |
| Compound mood headline                | Geist             | `text-xs`                                         | 500                       | `tracking-[0.1em] uppercase` + accent color |
| Genre pill                            | Geist             | `text-xxs` (0.625rem)                             | normal                    | `letterSpacing: 0.07em` inline              |
| Row action label ("Remove" / "Added") | Geist             | `text-[11px]`                                     | normal                    | `tracking-widest uppercase`                 |
| Counter / numeric badge               | Instrument Serif  | `text-3xl`                                        | `font-extralight`         | `tabular-nums leading-none`                 |

`text-xxs` = `0.625rem`, declared in the `@theme inline` block. `text-page-title` resolves to the `--page-title-size` CSS var.

### 3.2 Italic usage (precise)

Italic is **never applied to display headlines as a whole**. It is reserved for:

1. **Mid-sentence emphasis words** inside an `<em>` (rendered in Instrument Serif italic): `homes`, `for`, `description`, `home`. This is the signature voice mechanic — see brand docs.
2. **Artist name** in the matching `SongSection` and the panel hero (`text-xl italic` / inline `fontStyle: 'italic'`).
3. **Body interpretation blocks** — Geist `italic` for sonic texture, key line quotes, mood description body.
4. **Dialog headlines** with one italicized emphasis word.

Always via `<em>` or inline `fontStyle: 'italic'`, never the Tailwind `italic` class on a wrapping heading.

### 3.3 Weight rule

* Display headings: `font-extralight` (200) or `font-light` (300). **Never `font-bold` or `font-semibold` on display type.**
* Body: `font-normal` (400). UI labels rarely go above 500.

---

## 4. LAYOUT

### 4.1 Shell

* Sidebar: `w-64` (256px), `sticky top-0 z-10 h-screen`, `theme-bg theme-border-color border-r px-6 py-8`. No mobile collapse; this is a desktop app.
* Brand mark: text wordmark `hearted.`, Instrument Serif `text-4xl font-extralight tracking-tight`, linked to `/dashboard`.
* Nav items (`NavItem.tsx`): no icons. `text-xs tracking-widest uppercase`. Inactive: `theme-text-muted font-normal`. Active: `theme-text font-medium`. Optional `tabular-nums` count badge on the right.
* User row pinned to bottom: full-bleed (`-mx-6 -mb-8`) with `border-t` and `<UserAvatar>`.

### 4.2 Page containers

* Default page wrapper: `mx-auto max-w-5xl` (1024px). Used on dashboard, liked-songs, playlists.
* Matching session: `mx-auto w-full max-w-[min(1600px,100%)]` (wider canvas for the two-column composition).
* `<main className="flex-1 p-8">` inside the authenticated shell.

### 4.3 Two layout idioms

**Idiom A — Bleed row.** The dominant pattern for any interactive list item (activity feed, song row, playlist card, track row, CTA banner):

```tsx
className="-mx-3 px-3 py-N flex items-center gap-N theme-hover-surface"
```

Negative horizontal margin extends the hover background past the content column edge while the inner padding re-establishes alignment. Vertical padding is row-specific (`py-2.5` available card → `py-5` active card → `py-6` CTA). Rows use `border-b theme-border-color` for separation, **never `divide-y`**. Active row gets `border-left: 2px solid var(--t-primary)` with `margin-left: -2px` to avoid layout shift.

**Idiom B — Two-column stage.** Used on matching and playlists. Matching: `grid gap-10 lg:grid-cols-[1.1fr_1fr]` (~52/48, song left, matches right). Playlists: `grid grid-cols-[1fr_280px] gap-10` (matching list left, library right rail).

Single-column (lists) and two-column (stages) cover everything. No three-column equal-card layouts.

### 4.4 Drawer panel pattern (`SongDetailPanel`)

When opening contextual detail, slide a right-side panel in:

* Width: `clamp(380px, 45vw, calc(100vw - 280px))`
* Position: `fixed top-0 right-0 h-screen z-50 overflow-hidden`
* Slide: `transform: translateX(100% → 0)` + opacity, `transition: transform 300ms var(--ease-out-quart), opacity 300ms var(--ease-out-quart)`
* The list area pushes left simultaneously via `paddingRight: '45vw'` animated with the same easing.
* Internal scroll only (`overflow-y-auto overscroll-y-contain`); sticky 108px header retains nav.
* Layout constants live in `panel-constants.ts` (`heroHeight`, `albumArtExpanded/Collapsed`, `paddingX`).

### 4.5 Spacing rhythm

Honor the 8px grid via Tailwind's default scale. Common gaps in this codebase:

* `mb-10` — between page-level sections
* `mb-6` / `mb-8` — within a section
* `mb-5` — before a section label
* `mt-3` — between eyebrow and h1
* `gap-4` — text rows, content stacks
* `gap-6` — row internals (image to text)
* `gap-10` — main grid columns
* `py-4` / `py-5` — row vertical padding

Arbitrary `clamp()` and `letterSpacing` values are acceptable for fluid typography (`--page-title-size`, hero clamp sizes, `0.07em`/`0.1em` pill tracking). The grid is the spirit, not a religion.

---

## 5. MATERIALITY — FLAT, BORDERED

* **Cards are rare and almost always flat (no radius).** Playlist cards, song rows, dialog containers, panel covers, album art — all square corners. Active state communicated by `border-left: 2px solid var(--t-primary)`, not elevation.
* **1px borders only.** `theme-border-color` (or `0.5px solid` on small pills for crispness). Use `border-b` / `border-t` per row; never `divide-y`.
* **Radii actually in use** — match these, don't invent new ones:
  * **square** — cards, rows, dialogs, song titles, album art, primary/secondary/ghost buttons
  * `rounded-full` — UserAvatar, `Button surface`, play button, sync-status dot, demo badge
  * `rounded-lg` — `Button card`, HorizontalJourney content card
  * `rounded-xl` — paywall CTA container
  * `rounded-sm` — kbd
  * inline `borderRadius: 4` (journey arrows), `12` (genre pills), `24` (walkthrough CTA)
* **Shadows almost absent.** `shadow-md` on the play button + fan-spread album. `shadow-xl` on detail cover. Inset 1px image outlines via `.image-outline`. No drop shadows on cards.
* **No glassmorphism, no gradients on text, no neon glows.**

---

## 6. INTERACTION & MOTION

### 6.1 Standard transition

* **Default:** `transition-[<specific props>] duration-150 ease-out` — list specific props, not `transition-all`.
* **Rapid:** `duration-100` (icon buttons, fast feedback).
* **Slow:** `duration-300` ceiling (panel open/close).
* Always animate `transform` and `opacity` (or specific background-color / color). Never `top`, `left`, `width` (except `padding-right` on the list-area push, which is intentional and easing-tuned).

### 6.2 House easings

Reference these by name; don't invent new curves:

| Name                  | Definition                                | Used for                                  |
| --------------------- | ----------------------------------------- | ----------------------------------------- |
| `var(--ease-out-quart)` | (in styles.css)                         | Drawer panel slide, list-area push        |
| `var(--ease-out-expo)`  | (in styles.css)                         | Playlist detail open, view transitions    |
| `cubic-bezier(0.165, 0.84, 0.44, 1)` ("silk") | inline                  | Framer Motion enter/exit, play button scale |
| `ease-out`            | Tailwind default                          | Most CSS transitions                      |

### 6.3 Hover & active

* **Cards & rows: background-only hover.** `hover:bg-[var(--t-surface)]` via `.theme-hover-surface`, or a CSS-var mix like `color-mix(in oklch, var(--t-text) 6%, transparent)`. **No `hover:scale-*` on cards or rows.**
* **Buttons:** active feedback only. `active:scale-[0.98]` on Button base. Cards: `active:scale-[0.995]`. Icon button: `active:scale-[0.9]`. Close X: `active:scale-[0.96]`.
* **Arrow nudge** on link/CTA: `motion-safe:group-hover:translate-x-1`, never a scale.
* **Play button** is the exception that proves the rule: `group-hover:scale-110` because it's a primary affordance on a media surface.

### 6.4 Reduced motion is mandatory

Every non-trivial animation:

* Gate with `motion-safe:` / `motion-reduce:transition-none` on the Tailwind side.
* Or call `useReducedMotion()` (from `framer-motion`) and fall back to a no-op render.
* Keyframe animations check `@media (prefers-reduced-motion: reduce)` and cancel.

### 6.5 Framer Motion is permitted

Contrary to a stricter v3 stance, Framer Motion is in the codebase and welcome for orchestrated multi-element transitions:

* `AnimatePresence` for step transitions (onboarding `mode="wait"`)
* `motion.div` with staggerChildren (`StaggeredContent` wrapper, used by dashboard)
* Enter/exit with `initial`/`animate`/`exit` translates (matching `SongSection`, `MatchesSection`)

**Always pair with `useReducedMotion`** and a static fallback. Don't add Framer for a single hover scale — CSS is cheaper.

### 6.6 Named keyframes (already defined)

Compose with these before inventing new ones:

* `hearted-slide-fwd` / `hearted-slide-back` — ±12px slide + fade
* `hearted-fade` — opacity transitions
* `hearted-push-up` / `hearted-push-down` — translateY ±14px
* `hearted-tick-pulse` — checkmark pulse
* `playlist-track-enter` — staggered 4px lift + fade for track lists
* `walkthrough-pulse` / `walkthrough-arrow-nudge` / `walkthrough-hint-in` — onboarding teaching states
* `dialog-backdrop-in` / `dialog-content-in` — modal entry

Stagger: 60ms delay, 250ms duration (`panel-constants.ts`).

### 6.7 Native View Transitions

Used for shared-element morphs between playlist card → detail (`playlist-cover`, `playlist-title`, `playlist-description` view-transition names). Use the View Transitions API, not Framer Motion, for shared-element transitions.

---

## 7. COMPONENT PRIMITIVES

Import from source files — no barrel exports.

### 7.1 Button (`src/components/ui/Button.tsx`)

Seven variants, two sizes (`sm`, `md`). **Use the variant prop; don't restate className strings.** Read `Button.tsx` for current class compositions — it is the source of truth.

| Variant     | Use it for                                                              |
| ----------- | ----------------------------------------------------------------------- |
| `primary`   | Solid filled CTA, square, `theme-primary-action`, uppercase tracking-widest |
| `secondary` | Bordered text button, sm uses uppercase tracking-widest                  |
| `ghost`     | Low-emphasis text-only action, muted color                               |
| `surface`   | Subtle pill, `rounded-full`, `hover-border-brighten`                     |
| `icon`      | Square icon-only, scales `0.9` on press                                  |
| `link`      | Underline-style text action; sm variant is a tracking-widest mini-CTA    |
| `card`      | Block-level bordered container button (`rounded-lg`, full-width)         |

### 7.2 Other primitives in `src/components/ui/`

* `UserAvatar` — `rounded-full` image or initials on `theme-surface-dim-bg`. Sizes: `sm` (h-8), `md` (h-12).
* `kbd` + `KbdGroup` — keyboard glyph styled via `--kbd-*` CSS vars. `rounded-sm border h-5 min-w-5 text-xs`.
* `AlbumPlaceholder` — SVG square, `var(--t-surface-dim)` background with a `♫` glyph in `var(--t-text-muted)`.
* `CDCase` — composite that frames album art in a CD jewel-case SVG overlay (low-opacity `var(--t-text)`). Purely presentational.
* `PlaylistMatchRow` — bottom-bordered row with score / name / action slots. Two sizes (`sm`, `lg`).
* `HeartRippleBackground` + `LazyHeartRippleBackground` + `HeartRipplePlaceholder` — WebGL shader background used on landing and 404. Respects `prefers-reduced-motion` (single frame). Lazy-loaded.

### 7.3 Feature-level reusable patterns

* `StaggeredContent` (`src/features/onboarding/components/`) — wraps any page-level content list for staggered Framer fade-in. Use on any new page that lists ≥3 elements.
* `SongDetailPanel` (`src/features/liked-songs/`) — the canonical drawer pattern. Reuse this rather than rolling a new sheet/modal.

### 7.4 Iconography

* `@phosphor-icons/react`. Use the `weight` prop, **not** stroke widths.
  * `weight="regular"` — default
  * `weight="light"` — de-emphasized contexts (locked panel)
  * `weight="bold"` — close X
  * `weight="fill"` — primary media controls (play)
* No fixed icon size scale. Match the context's text size (12 for inline labels, 14 for buttons, 16 for primary CTAs, 20+ for affordances).
* The `Nav.tsx` chevrons in the panel are raw inline SVG with `strokeWidth="1.5"` — that's the only place stroke widths apply, and only because they're not Phosphor.

---

## 8. COPY & VOICE

**Voice is owned by the brand docs.** Do not duplicate it here.

* `/v1_hearted_brand/brand/VOICE-AND-TONE.md` — voice characteristics, tone-by-context matrix, core patterns (songs-have-agency, poetic minimalism, compound moods, evocative fragments, direct interpretation), banned words.
* `/v1_hearted_brand/brand/COPY-GUIDE.md` — per-surface copy: landing, onboarding, song analysis, matching (including match quality labels), dashboard, playlists, settings, errors, loading, microcopy reference.

### 8.1 The two patterns to bake into every component

1. **Mid-sentence italic emphasis.** Wrap the emotional word in `<em>` rendered in Instrument Serif italic: `Pick their <em>homes</em>` / `Tell hearted what this is <em>for</em>`. This is the most distinctive voice mechanic visible in the live UI.
2. **Lowercase ellipsis character (`…`), not three dots.** `"Listening for your playlists…"` not `"Listening for your playlists..."`.

### 8.2 Canonical strings appendix (verbatim, by source)

Where the brand spec and the live codebase agree, use the brand spec. Where they currently diverge, the codebase wins **only if** the brand spec hasn't yet been adopted there (note the gap rather than inventing a third option).

| Surface                  | Use this                                                            | Source                                  |
| ------------------------ | ------------------------------------------------------------------- | --------------------------------------- |
| Loading (sync)           | `"Listening to your library…"`                                      | Brand                                   |
| Loading (analyze)        | `"Finding the story…"`                                              | Brand                                   |
| Loading (match)          | `"Looking for the right home…"`                                     | Brand                                   |
| Loading (generic)        | `"One moment…"`                                                     | Brand + codebase                        |
| Empty (liked songs)      | `"Nothing yet"` / `"Like a song on Spotify."` / `"Your liked songs will land here as soon as you tap the heart."` | Codebase   |
| Empty (matching, all done)| `"Your songs have found their home."` (final word in `<em>`)        | Codebase                                |
| Error (generic)          | `"Something went sideways. Let's try that again."`                  | Brand                                   |
| Success (matched)        | Brand: `"Found its home"`. Codebase currently ships: `"Added"`. Prefer brand when introducing new surfaces. | Brand (target) |
| Skip / dismiss           | Brand: `"Not this one"`. Codebase matching currently ships: `"Dismiss"`. Prefer brand. | Brand (target) |
| Match quality labels     | `"Perfect fit"` (90+) / `"Strong match"` (80–89) / `"Good match"` (70–79) / `"Worth considering"` (60–69) / hide below 60. Codebase currently shows raw `N%` via `NumberFlow`. Add the verbal label when extending. | Brand (target) |
| Walkthrough CTA          | `"See where this song belongs →"`                                   | Codebase                                |
| Description prompt       | `"Tell hearted what this is for, songs find their way here →"` (`for` in `<em>`) | Codebase                |
| Landing CTA              | `"Show me mine"`                                                    | Brand                                   |
| Discovery CTA            | `"See what's inside"`                                               | Brand                                   |

### 8.3 Punctuation

One exclamation max per screen. Sentence case for UI. Commas over em-dashes. Ellipses only for trailing thoughts and loading copy (use `…` U+2026, not `...`).

---

## 9. THE HEARTED AI TELLS (forbidden patterns)

### Visual
* No neon glows, no AI-purple aesthetic, no gradient text
* No pure black; dark mode uses derived HSL per theme
* No oversaturated accents — stay in 12–32% saturation
* No `divide-y`; use `border-b` per row
* No `rounded-md`/`rounded-2xl` defaults — pick from §5's actual radii
* No drop shadows on cards
* No shadcn/ui defaults; customize or skip
* No raw Tailwind color classes (`zinc-*`, `gray-*`, `neutral-*`, `slate-*`) anywhere — including in dev tooling

### Typography
* No Inter
* No `font-bold` / `font-semibold` on display headings — use `font-extralight` (200) or `font-light` (300)
* No `italic` Tailwind class on a heading wrapper — italic via `<em>` only
* No oversized H1s that "scream"

### Layout
* No three-column equal-card feature rows
* No mobile breakpoints / `md:` responsive prescriptions — desktop only
* No centered hero for editorial sections — left-aligned or split
* No `min-h-[100dvh]` — codebase uses `min-h-screen`; match it

### Motion
* No `transition-all` (specify the props)
* No `duration-500`+ for UI feedback (panels excepted, capped at 300ms)
* No `hover:scale-*` on cards or rows
* No Framer Motion without `useReducedMotion`
* No infinite loops, no scroll hijack, no parallax

### Interaction & Forms
* Label above input, never placeholder-as-label
* Helper text rendered in markup even if visually hidden
* Error text below the field
* Focus visible via `focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)]`

### Iconography
* No stroke-width prop on Phosphor (it doesn't exist) — use `weight`
* No emoji icons; no Material/Heroicons mixed in

### Copy
* No clinical analysis language ("Sentiment: Positive", "Genre: Pop")
* No passive voice on song analysis ("The song was analyzed")
* No hedging ("might", "possibly", "could be")
* No corporate verbs ("leverage", "utilize", "optimize", "unlock", "supercharge")
* No generic placeholder names ("Acme", "Song Title", "Playlist 1")
* No broken image URLs — use `https://picsum.photos/seed/{realistic_string}/800/600`

---

## 10. PRE-FLIGHT CHECK

Before outputting any UI code, verify:

- [ ] Tokens consumed via `.theme-*` utility classes — no `var(--t-*)` arbitrary-value Tailwind unless inside `style={{}}`
- [ ] No raw Tailwind color classes; no hex literals (allowed exceptions in §2.3 only)
- [ ] Instrument Serif via `style={{ fontFamily: fonts.display }}` for display; Geist via `fonts.body` (or default body inheritance)
- [ ] Display headings: 200/300 weight, never bold
- [ ] Italic via `<em>` only — never `italic` class on a heading wrapper
- [ ] Transitions name specific props, ≤300ms, `ease-out` or a house easing
- [ ] No `hover:scale-*` on cards or rows; hover is background-only
- [ ] `motion-safe:` / `motion-reduce:transition-none` on every animation; `useReducedMotion` if using Framer
- [ ] Borders are 1px (`theme-border-color`); rows separated by `border-b`, not `divide-y`
- [ ] Radii drawn from §5's actual set (square / `rounded-full` / `rounded-lg` / `rounded-xl` / `rounded-sm`)
- [ ] Phosphor icons use `weight=` prop (regular/light/bold/fill)
- [ ] Voice rules read from `/v1_hearted_brand/brand/VOICE-AND-TONE.md` and `COPY-GUIDE.md`
- [ ] Mid-sentence emphasis word wrapped in `<em>` where appropriate
- [ ] Ellipsis is `…` (U+2026), not `...`
- [ ] Reusing `Button`, `UserAvatar`, `SongDetailPanel`, `StaggeredContent`, `PlaylistMatchRow` from source — not re-rolling
- [ ] Desktop layout only; no `md:`/`lg:` mobile prescriptions added (codebase is `lg:` for two-column composition, that's the exception)
- [ ] `min-h-screen` (not `min-h-[100dvh]`) for full-height shells
