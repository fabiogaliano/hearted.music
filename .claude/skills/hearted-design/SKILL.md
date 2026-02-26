name: hearted-design
description: High-agency frontend taste system for Hearted. Enforces editorial-minimal aesthetic, Hearted brand voice, and project design tokens. Use when building any UI component, page, or reviewing existing frontend work. Prevents AI slop, enforces warm-pastel design system, and bakes in Hearted's curious/observant voice. Triggers on: 'build UI', 'create component', 'design', 'review UI', '/hearted-design'.
license: MIT

---

# Hearted Design Taste System

**Calibrated for:** hearted. — editorial, typography-driven, warm-pastel music exploration app.

## 1. ACTIVE BASELINE CONFIGURATION

* DESIGN_VARIANCE: 6 (Offset — editorial asymmetry, not chaos)
* MOTION_INTENSITY: 4 (Subtle CSS fluid — max 0.3s, no Framer physics unless asked)
* VISUAL_DENSITY: 2 (Art Gallery / Airy — minimal chrome, whitespace dominant)

**AI Instruction:** These values are calibrated to Hearted's editorial-minimal character. Do not drift toward higher variance or heavier motion unprompted. Adapt if user explicitly requests richer animation or denser layouts. All downstream rules in Sections 3–7 derive from these dials.

---

## 2. PROJECT ARCHITECTURE & CONVENTIONS

* **Stack:** TanStack Start + React + Vite + Bun. Use `createFileRoute()` for routes. Server Components where possible; `"use client"` only for interactivity.
* **Styling:** Tailwind CSS (v3). Check `package.json` before importing any library. Never assume a dep exists.
* **DEPENDENCY RULE:** Output install command before any code using an unconfirmed dependency.
* **Theme Tokens:** ALWAYS use semantic tokens — never hardcode colors. Available tokens per theme: `bg`, `surface`, `surfaceDim`, `border`, `text`, `textMuted`, `primary`, `primaryHover`. Applied via CSS vars or Tailwind config.
* **Four Color Themes:** `blue` (218°), `green` (135°), `rose` (340°), `lavender` (300°) — HSL monochromatic, saturation 12–32%.
* **Dark Mode:** Derives 15 HSL colors from a single hue via `getThemedDarkColors(theme)`. Child components must receive color props from parent rather than calling `useTheme()` directly — avoids the contrast bug where children get light-mode colors inside dark panels.
* **Icons:** Use `@phosphor-icons/react`. Stroke width: consistently `1.5`. No emoji substitutes for icons.
* **No Barrel Exports:** Import directly from source files.
* **ANTI-EMOJI POLICY:** NEVER use emoji in markup, code, or alt text. Use icons or SVG primitives instead. Exception: the single ♡ heart glyph in brand moments only.

---

## 3. DESIGN ENGINEERING DIRECTIVES

**Rule 1: Typography — Instrument Serif + Geist**

This is an editorial product. The font pairing is the core identity signal.

* **Display / Headlines:** `Instrument Serif` (400, Italic) — page titles, section headers, card titles, large editorial moments.
  * Page titles: `text-[48px] md:text-[56px] font-extralight tracking-tight leading-none` (200 weight with display font reads elegantly light)
  * Section headers: `text-[32px] md:text-[40px] font-light` (300)
  * Card titles: `text-[20px] md:text-[24px] font-light` (300)
  * **Italic is intentional** — use `italic` on display headings for editorial character.
* **Body / UI:** `Geist` (100–900) — body text, labels, buttons, metadata.
  * Primary body: `text-base font-normal` (400)
  * Metadata / secondary: `text-sm text-[textMuted]` (14px)
  * Small / UI: `text-xs text-[textMuted]` (12px)
  * Buttons: `text-sm font-medium uppercase tracking-widest` (primary) / `text-xs font-normal uppercase tracking-widest` (secondary)
* **SERIF IS APPROPRIATE HERE.** This is an editorial-creative product, not a SaaS dashboard. Instrument Serif on headers is mandatory brand identity. The generic "Serif banned on apps" rule does NOT apply to Hearted.
* **Letter-spacing:** `tracking-tight` for display headlines. `tracking-widest` for all uppercase UI labels.
* **NO Inter.** Geist is the Hearted body font.

**Rule 2: Color — Theme Tokens Only**

* **Always use semantic tokens.** No `bg-zinc-900`, no `text-gray-600`. Use `bg-[var(--color-bg)]` or token class equivalents.
* **Max 1 accent per screen.** The `primary` token IS the accent — never add a second accent.
* **No neon gradients, no purple glows.** The palette is muted pastels — saturation stays 12–32%.
* **No pure black.** Dark mode uses derived HSL dark, not `#000000`.
* **Color consistency:** Stay within the active theme's monochromatic range. No warm/cool mixing inside a single theme.

**Rule 3: Layout — Editorial Offset**

* At DESIGN_VARIANCE 6: prefer **left-aligned headers**, **split-screen 40/60 or 50/50**, or **asymmetric whitespace** over centered layouts for hero moments.
* Dashboard areas (song list, matching view): structured grid, not freeform.
* **No 3-column equal-card layouts.** Use 2-column zig-zag, or horizontal scroll, or asymmetric grid instead.
* **Mobile:** Any asymmetric layout must collapse to single-column `w-full px-4 py-8` on `< 768px`.
* Layout dimensions: sidebar 64px + flex-1 main (max-w 1400px). Matching view: 40% focus / 60% recommendations.

**Rule 4: Materiality — Minimal Cards**

* At VISUAL_DENSITY 2, cards are used sparingly. Default to **negative space and `divide-y` / `border-t`** to separate content.
* When a card IS used: `rounded-[8px] border border-[var(--color-border)]` (1px border). Pill shapes: `rounded-[24px]`.
* Shadows: if used, tint to background hue. No default box-shadow drop shadows.
* No glassmorphism unprompted. No holographic foil unprompted. Keep it clean.

**Rule 5: Interaction States — Subtle and Complete**

All components MUST implement full cycles:
* **Hover:** `scale-[1.05] brightness-[0.95] transition-all duration-[200ms]` — subtle, tactile.
* **Active / pressed:** `scale-[0.98]` or `-translate-y-[1px]` for push feel.
* **Loading:** Skeletal loaders matching layout geometry. Use Hearted loading copy: `"Listening to your library..."` / `"Finding the story..."` / `"Looking for the right home..."`
* **Empty states:** Beautifully composed. Use Hearted encouraging voice: `"Nothing here yet, your liked songs are waiting."`
* **Error states:** Human and calm. Use Hearted error copy: `"Something went sideways. Let's try that again."`
* **Never generate static-success-only components.** All three states (loading, empty/error, success) must exist.

**Rule 6: Spacing — 8px Grid**

All spacing in multiples of 8px:
* xs: 4px / sm: 8px / md: 16px / lg: 24px / xl: 32px / 2xl: 48px / 3xl: 64px

Use Tailwind spacing scale that maps to this grid. No arbitrary pixel values outside the grid.

---

## 4. MOTION SYSTEM — MAX 0.3s

At MOTION_INTENSITY 4, motion is **CSS only**. No Framer Motion unless explicitly requested.

* **Standard:** `transition-all duration-200 ease-in-out`
* **Rapid:** `duration-100`
* **Slow:** `duration-300` — never exceed 300ms.
* **Hardware acceleration:** `transform` and `opacity` only. Never animate `top`, `left`, `width`, `height`.
* **No perpetual loops, no parallax, no scroll hijacking** at this motion level.
* **Spring physics, magnetic cursors, Framer Motion choreography** — only if user explicitly requests richer motion.

---

## 5. HEARTED BRAND VOICE (Copy & Microcopy)

When generating any user-facing text — labels, empty states, tooltips, loading messages, error states, button text — apply Hearted's voice.

**Voice:** Curious friend who pays attention to music the way you do. Not a robot. Not a teacher. Not a salesperson.

**Traits:**
| Trait | Do | Don't |
|---|---|---|
| Curious | "Ever wonder why you love this one?" | "This song has been categorized" |
| Observant | "There's something bittersweet in the bridge" | "Sentiment analysis: mixed" |
| Warm | "This song gets it" | "This song has been analyzed" |
| Confident | "This belongs in your workout playlist" | "This might possibly fit..." |
| Playful | "Your shuffle called. It's exhausted." | "Shuffle creates suboptimal experiences" |

**Copy Patterns:**

* **Songs have agency:** "It found you. You kept it." / "Your songs have been trying to tell you something."
* **Poetic minimalism:** Short fragments. Emotional word lands last or in italics. "the stories inside your *Liked Songs*"
* **Compound moods:** [Modifier] + [Core Emotion]. Examples: Anxious Nostalgia, Bittersweet Anger, Wry Tenderness, Sardonic Clarity, Euphoric Liberation, Tender Desperation, Brooding Desire, Unhinged Sweetness.
* **Evocative fragments for journey steps:** "Synths pulse like a racing heartbeat." / "The dam breaks, all the anxiety floods out." — NOT "The verse establishes a melancholic tone."
* **Direct interpretation:** "The isolating realization that growing up means growing apart." — NOT "This song is about the struggles of growing up."
* **Themes:** lowercase, human, specific. "letting go", "self-sabotage", "late-night honesty" — NOT "Loss", "Relationships", "Identity"

**Permitted words/phrases:** "See what's inside", "Here's what we found", "This belongs in...", "Found its home", "Your hearted songs", "Your taste", "Start exploring", "Show me mine", "Ready to match", "Not this one", "Get more credits"

**BANNED words/phrases (Hearted):** "Sort your songs", "Organize your music library", "Analysis complete", "AI-powered" (overuse), "Utilize/leverage/optimize", "Unlock/supercharge", "This song is about...", "The artist expresses...", "might/possibly/could be", "Elevate", "Seamless", "Unleash", "Next-Gen"

**Copy by context:**
* Loading: `"Listening to your library..."` / `"Finding the story..."` / `"Looking for the right home..."` / `"One moment..."`
* Error generic: `"Something went sideways. Let's try that again."`
* Success / matched: `"Found its home"` (restrained, no exclamation)
* Empty: `"Nothing here yet, your liked songs are waiting"`
* Match quality labels: `"Perfect fit"` (90%+) / `"Strong match"` (80–89%) / `"Good match"` (70–79%) / `"Worth considering"` (60–69%)

**Punctuation rules:**
* One exclamation mark max per screen
* Sentence case for all UI copy
* Commas preferred over em dashes
* Ellipses only for trailing thoughts

---

## 6. TECHNICAL REFERENCE (Dial Definitions — Hearted Context)

### DESIGN_VARIANCE: 6 (Offset)
* Left-aligned editorial headers
* Split-screen layouts (40/60 song focus / playlist recommendations)
* Varied image aspect ratios, offset card grids
* Asymmetric whitespace in hero moments
* Mobile: always single-column `w-full px-4`

### MOTION_INTENSITY: 4 (Fluid CSS)
* `transition-all duration-200 ease-in-out` everywhere
* `animation-delay` cascades for list/grid load-ins on mount
* Only `transform` and `opacity`
* `will-change: transform` sparingly, only when needed
* No infinite loops, no scroll-based animations at this level

### VISUAL_DENSITY: 2 (Art Gallery)
* Generous whitespace. Large section gaps.
* Whitespace IS the layout. Let Instrument Serif breathe.
* Divide content with negative space and `border-t` / `divide-y`, not cards
* Cards only when elevation communicates hierarchy

---

## 7. THE HEARTED AI TELLS (Forbidden Patterns)

In addition to the universal anti-patterns, these are Hearted-specific slop signatures to avoid:

### Visual
* No neon glows, no purple/AI-purple aesthetic
* No pure black — use dark HSL derived from theme hue
* No oversaturated accents — muted pastels only (12–32% saturation)
* No gradient text on headlines
* No decorative emojis — use Phosphor icons or ♡ in brand-specific moments only
* No shadcn/ui in default state — customize radii, colors, shadows to match

### Typography
* No Inter font — Geist for body, Instrument Serif for display
* No oversized H1s that "scream" — hierarchy via weight and color
* No `font-bold` on display headings — use `font-light` (300) or `font-extralight` (200)

### Layout
* No 3-column equal-card feature rows
* No centered hero for editorial sections (use left-aligned or split)
* No horizontal overflow — all asymmetric layouts must collapse on mobile

### Content & Copy
* No clinical analysis language: "Sentiment: Positive", "Genre: Pop"
* No passive voice: "The song was analyzed..." — use active agency
* No hedging: "might", "possibly", "could be"
* No corporate speak: "AI-powered", "leverage", "optimize", "seamless"
* No generic placeholders: "Song Title", "Artist Name", "Playlist 1"
* No startup slop: "Acme", "Nexus", "SmartFlow" for any placeholder brand names
* No broken image URLs — use `https://picsum.photos/seed/{realistic_string}/800/600`

### Forms & Inputs
* Label above input (never placeholder-as-label)
* Helper text in markup even if visually hidden
* Error text below the input field
* Standard `gap-2` for input blocks

---

## 8. COMPONENT PATTERNS (Hearted-Specific)

**Buttons:**
* Primary: `text-sm font-medium uppercase tracking-widest bg-[primary] text-[bg] rounded-[24px] px-6 py-2 border border-transparent hover:brightness-95 transition-all duration-200`
* Secondary: `text-xs font-normal uppercase tracking-widest border border-[border] text-[text] rounded-[24px] px-4 py-1.5 hover:bg-[surface] transition-all duration-200`
* Destructive / reject: "Not this one" styling — same as secondary, muted

**Cards:**
* `rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4` (minimal)
* Hover: `hover:scale-[1.02] hover:brightness-[0.98] transition-all duration-200`

**Badges:**
* "New" / "Explored" / "Matched" / "Active"
* `rounded-[24px] px-3 py-0.5 text-xs font-medium uppercase tracking-widest border`

**Match quality display:**
* Show percentage + label: `"Strong match · 83%"` — NOT just a number
* Below 60%: do not show match at all

**Song analysis components:**
* Compound mood: largest typographic element, Instrument Serif Italic, prominent placement
* Interpretation: body text, `text-base font-normal`, no attribution framing
* Themes: horizontal pills, lowercase, `text-xs tracking-widest`
* Journey steps: evocative fragments, `text-sm text-[textMuted]`, separated by subtle dividers
* Key lines: `{line, insight}` — display the line first (larger), insight below (muted, smaller)

---

## 9. PRE-FLIGHT CHECK

Before outputting any UI code, verify:
- [ ] Theme tokens used everywhere — no hardcoded colors
- [ ] Instrument Serif for all display headings, Geist for everything else
- [ ] All transitions ≤ 0.3s, only `transform` and `opacity` animated
- [ ] Mobile collapses to single-column `w-full px-4` for any offset layout
- [ ] Full interaction states: loading, empty, error — not just success
- [ ] Hearted copy voice: warm, confident, observational — no clinical language
- [ ] No emoji (exception: isolated ♡ in brand contexts)
- [ ] `min-h-[100dvh]` for full-height sections (never `h-screen`)
- [ ] 1px borders throughout (`border` not `border-2`)
- [ ] 8px spacing grid honored (xs:4 sm:8 md:16 lg:24 xl:32 2xl:48 3xl:64)
- [ ] Serif italic used intentionally on display elements — not applied to body or UI text
