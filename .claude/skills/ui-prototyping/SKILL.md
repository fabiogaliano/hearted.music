---
name: ui-prototyping
description: How to prototype and experiment when designing a NEW UI or refactoring an existing one in Hearted — a Ladle-first, React-only diverge/converge workflow. Explore many directions as LOOSE real React components in Ladle, then tighten the winners into close-to-prod components, built as small, named, composable pieces (atoms → wholes) so directions are easy to swap and each component is easy to address and edit by name. Covers picking the unit of variation, decomposition into small components, the Ladle story setup, view-models + fixtures, verification, and promoting a winner to prod. Use when starting a redesign, exploring layout/interaction directions, building a component lab, comparing UI variations, or before committing to a single design. Triggers on: 'prototype a UI', 'explore variations', 'redesign this view', 'try a few directions', 'component lab', 'Ladle stories', 'experiment with the layout', '/ui-prototyping'.
---

# UI Prototyping & Experimentation

How to explore UI directions in this project without thrashing prod and without
spending tokens iterating in the wrong medium. Pairs with `hearted-design` (the
taste system — *what* good looks like) and `ui-ux-review` (auditing a finished
component). This skill is about the *process* of getting from a vague idea to a
chosen, close-to-prod design.

> Ground rule: **diverge loosely, converge faithfully — both in Ladle, with real
> React.** Most wasted effort comes from converging too early (locking a component's
> API before you know the direction is right) or from building throwaway scaffolding
> (static HTML mockups) you'll only have to rebuild. The two phases differ in the
> **fidelity of the React**, not the medium.

---

## 1. LADLE-FIRST, REAL REACT: DIVERGE LOOSE, CONVERGE TIGHT

This project already wires React, Tailwind v4 tokens, the real fonts, the four
themes, breakpoints, and hot reload into Ladle. So rendering a *real* component
costs almost nothing — explore with real React components from the first cut:

| Phase | Goal | What the React looks like |
| ----- | ---- | ------------------------- |
| **Diverge** | Compare many *directions* side by side | **Loose** — minimal/no props, shared inline fixtures, don't bother with clean view-model types or prop interfaces yet. Ladle just renders React; `typecheck` is a separate gate you haven't hit. Reuse shared atoms (§3) so directions stay comparable and cheap to spin up. |
| **Converge** | Make the 1–3 winners *close to prod* | **Tight** — real primitives, clean view-models, documented DB mapping, proper props, passing `typecheck` (§4–6). |

Divergence is cheap because the React is **loose**, not because you dropped to a
lower-fidelity medium. You get real tokens / fonts / motion / theme-switching for
free, and never pay a transpose.

Why not a static HTML mockup first? The setup is *already done* — a mockup would
only **recreate** what Ladle gives you (copy the `--t-*` tokens, rebuild chrome,
re-author motion), couldn't use the real `Button` / fonts helper / `ThemeHueProvider`,
and would force you to rebuild every winner in React anyway. More work, lower
fidelity. Stay in real React.

**Refactors** start tight-ish: you have a working baseline, so build the
alternative beside the original in Ladle. **New UIs with no precedent** start loose:
spray several rough directions in Ladle, throw most away, tighten the survivor.

---

## 2. BEFORE YOU GENERATE ANYTHING: PICK THE UNIT OF VARIATION

The most common failure mode here is varying the wrong thing. Decide *what a single
variation is* before producing any:

- For a **listing**, the unit is the whole list composition (cover-flow vs rail vs
  gallery), not a single row restyled.
- For a **detail view**, the unit is the **whole panel** (hero + body + actions
  together), not just the inner writing surface. A past round failed because it
  iterated only on the inner sub-piece (`#wsMount`) and merely recolored the header
  that was being critiqued — the actual ask was new whole-panel directions.
- "Give me more variations" means **net-new directions**, not re-skins of the same
  two or three. If asked for more, add genuinely different compositions; don't
  re-theme existing ones.

Note the unit of *variation* (the whole composition) is larger than the unit of
*construction* (small components, §3). You vary at the composition level by
recombining and swapping the small pieces underneath.

Also decide up front:

- **How many directions** to produce (5–7 listing directions and ~6 detail
  directions was a good spread for a wide space).
- **What's fixed vs free**: which design tokens / copy / data are held constant so
  variations are comparable, and which axes are actually being explored.
- **Responsive or desktop-only**: `hearted-design` is desktop-first, but a specific
  exploration may explicitly target responsive — confirm and let that decision
  override the default, rather than silently picking one.

---

## 3. BUILD SMALL, NAMED, COMPOSABLE COMPONENTS

Decompose every direction into small, single-purpose components — each in its own
named file — and assemble them. Avoid big monolithic components. This is the
backbone of the whole workflow; it pays off three ways:

1. **Composition & replacement.** A direction is assembled from atoms, so trying a
   new one means swapping a piece (a different row, a different hero), not rewriting
   a screen. Shared atoms (`Cover`, `GenreChip`) are reused across every direction,
   so they stay consistent and you change them in one place.
2. **Addressable at edit time.** A small, well-named component is a precise edit
   target. You — or the user — can say "make `RailRow` denser" or "tighten
   `VoicesLine`'s pull meter" and the change is surgical, the diff is small, and
   there's no hunting inside a 300-line monolith. **Names are the interface for
   iteration**, so name pieces for what they are, by role, not `Section2`.
3. **Tunable in isolation.** Each component gets its own story (§4.2), so you can
   refine one piece without the rest of the screen in the way.

Concretely, from this project's playlists explorations — nothing is one big
component:

```
SpotlightPanel        # frame + open/close + draft state (thin assembler)
 └ SpotlightHero      # cover + kicker/title/sub
    └ TargetToggle    # the in-matching / add toggle
 └ VoicesLine         # description sentence + pull meter
 └ WritingSurface     # editable description + genres (thin assembler)
    └ GenrePicker     # input + chips + suggestions
       └ GenreChip    # one chip
 └ TrackList          # rows + "+N more"
 └ Cover              # cover image / ♫ placeholder  (shared atom)

RailPlaylists         # thin assembler
 └ SegmentedFilter    # all / matching / library
 └ RailRow            # one row
    └ Cover           # (same shared atom)
```

Heuristics for where to cut:

- If a sub-element has **its own state, hover/interaction, or you'd name it with a
  noun** ("the row", "the chip", "the meter"), it deserves its own file.
- **Wholes stay thin** — composition + wiring (state, callbacks, layout grid), not
  layout minutiae. The minutiae live in the small components.
- Prefer **composing many small components** over prop-configuring one big one with
  a dozen booleans.
- But don't over-atomize: a one-line wrapper that only forwards props adds
  indirection without a real seam. Extract at genuine seams — a reusable atom, an
  independently-tunable piece, or a swappable variation point.

In the **loose** divergence phase, you still build on shared atoms, but a direction's
top-level composition can stay rough; you split it into named pieces as it firms up.

---

## 4. CONVERGE — TIGHTEN WINNERS INTO CLOSE-TO-PROD COMPONENTS

Once directions are chosen, harden the loose exploration React into real components —
real primitives, clean view-models, proper props — so they're genuinely "close to
prod" and tweakable in isolation. Same Ladle medium as divergence; you're raising
fidelity, not switching tools.

### 4.1 Where exploration code lives

```
src/features/<feature>/components/explorations/
  types.ts          # clean camelCase view-models for the prototype
  fixtures.ts       # sample data (real covers / real-shaped records)
  <feature>-explorations.css  # keyframes + classes, behind prefers-reduced-motion
  <Atom>.tsx        # small shared atoms (Cover, GenreChip, …) — one file each
  <Piece>.tsx       # named sub-components (RailRow, SpotlightHero, …)
  <Whole>.tsx       # thin assemblers (the listing, the detail panel)
  <Whole>.stories.tsx
  <Piece>.stories.tsx
```

Keep explorations **self-contained**: compose only generic primitives (`Button`
from `@/components/ui/Button`, fonts from `@/lib/theme/fonts`, the `.theme-*`
utility classes). This lets you iterate freely without touching production code, and
makes the eventual promotion a deliberate copy rather than an entangled edit.

### 4.2 One story per component, grouped Composable / Components

Give each **assembled whole** a story (the full listing, the full detail panel —
with a harness wiring listing → panel so the interaction is real) *and* each
**small component** its own story (a row, a chip, a toggle, the writing surface).
Wholes prove the composition; per-piece stories make every component independently
tunable and double as the named edit targets from §3.

**Group the sidebar so the two kinds don't read as one flat list.** Split the title
into a `Composable` bucket (the assembled views) and a `Components` bucket (the
building blocks):

```
Playlists/Explorations/Composable/CoverFlow      ← whole listing
Playlists/Explorations/Composable/Rail
Playlists/Explorations/Composable/SpotlightPanel ← whole detail panel
Playlists/Explorations/Components/RailRow         ← pieces
Playlists/Explorations/Components/GenreChip
Playlists/Explorations/Components/WritingSurface
…
```

The `/`-segments become sidebar tree levels, so this reads as
`Explorations › Composable › …` / `Explorations › Components › …` instead of a
dozen leaves jumbled together.

**Minimize the number of stories — expose variants through controls, not extra
exports.** One story per component, with Ladle `args` + `argTypes` (§5.1) for the
axes that vary. A `TargetToggle` is one story with an `isTarget` boolean, not
`Matching` + `NotMatching`; a `TrackList` is one story with a `set` select and a
`songCount` range, not three exports. Fewer stories means each component has a
single addressable entry you tweak via controls — easy to find, easy to swap.

### 4.3 View-models, not raw DB rows

Define clean camelCase interfaces in `types.ts` (e.g. `PlaylistSummary`,
`PlaylistTrackVM`) and **document the mapping back to the real DB fields** in
comments (`Tables<"playlist">`: `match_intent`, `genre_pills`, `image_url`, …).
Prototyping against a tidy VM keeps the components readable; the documented mapping
makes promotion mechanical. Fixtures should use real-shaped data (real Spotify
covers, plausible counts) so layouts are judged under realistic content, including
long titles and empty states.

### 4.4 Fresh rebuild vs reuse-prod

When an exploration overlaps an existing prod component (e.g. a writing surface that
already exists), choose explicitly:

- **Reuse prod** when you're refining around an unchanged component and want true
  fidelity.
- **Rebuild it in `explorations/`** when the component itself is part of what's
  being redesigned, so you can change it without risking prod. (This was the right
  call when the writing surface's own layout was in scope.)

State which you picked and why; don't silently fork a prod component.

---

## 5. LADLE MECHANICS (this project)

- **Run:** `bun run ladle` (serve) · `bun run ladle:build` (production build —
  doubles as a compile check that every story imports cleanly).
- **Stories:** `src/**/*.stories.tsx`. Default export `{ title: "Feature/Group/Sub/Name" }`;
  named arrow exports are stories; optional `Story.meta = { description }`. Group
  explorations as `Playlists/Explorations/Composable/<Name>` and
  `…/Components/<Name>` (§4.2). Prefer **one control-driven story** per component
  over many exports (§5.1).
- **Global Provider** (`.ladle/components.tsx`) already wraps every story in
  QueryClient → `ThemeHueProvider` → `KeyboardShortcutProvider` → an in-memory
  `StoryRouter`. Don't re-add these per story. Stories needing seeded query data
  nest their own `QueryClientProvider` on top.
- **Theme control:** a `theme` select (`blue` Hush / `green` Bloom / `rose` Ember /
  `lavender` Reverie) switches the active hue live — always click through all four,
  since a single accent per screen is a design invariant.
- **Width addon:** `mobile 414 / tablet 768 / desktop 1280` — use it to check a
  responsive exploration at each breakpoint.
- Sidebar order is journey-based (`.ladle/config.mjs storyOrder`), with a trailing
  `*` catch-all so new groups still appear.

A story harness owns the interactive state the component expects (selection,
open/close, draft text) via `useState`, mirroring how a real route would wire it.

### 5.1 Controls (args / argTypes)

Drive variants from controls so each component stays a single story. Type the
story `Story<Args>`, set `.args` (defaults) and `.argTypes` (control config):

```tsx
import type { Story } from "@ladle/react";

export const Default: Story<{ set: string; songCount: number }> = ({ set, songCount }) => (
  <TrackList tracks={SETS[set] ?? []} songCount={songCount} />
);
Default.args = { set: "mce", songCount: 6 };
Default.argTypes = {
  set: { options: ["mce", "dubolt", "empty"], control: { type: "select" } },
  songCount: { control: { type: "range", min: 0, max: 40, step: 1 } },
};
```

Shape gotcha (this fork): `type`/`min`/`max`/`step` live **nested under
`control`**; `options` and `defaultValue` are **flat** on the argType. Control
types: `text`, `boolean`, `number`, `range`, `select`, `radio`, `multi-select`,
`color`, `date`.

**Stateful-harness caveat.** A harness that seeds `useState` from an arg won't
reset when the control changes — `useState` only reads its initial on mount. Key
the harness to the seeding args so changing a control remounts it:

```tsx
export const Default: Story<{ isTarget: boolean }> = ({ isTarget }) => (
  <Harness key={String(isTarget)} initial={isTarget} />
);
```

Purely presentational components (no internal state) need no key — they read the
args directly each render.

---

## 6. VERIFY BEFORE HANDING BACK

Run both, every time, before reporting an exploration as ready:

```bash
bun run typecheck       # tsgo --noEmit — 0 errors
bun run ladle:build     # every story compiles & bundles
```

For visual confidence, drive Playwright over the served Ladle page (`bun run ladle`),
navigating to each story (Ladle exposes per-story URLs; append `&mode=preview` for a
chrome-less capture). The `webapp-testing` skill has Playwright helpers. Note: in zsh
the pipe exit status is `$pipestatus` (lowercase), not `$PIPESTATUS` — rely on the
tool's own success line ("Ladle finished the production build") rather than a
possibly-empty `$?` after a pipe.

---

## 7. PROMOTING A WINNER TO PROD

Explorations are deliberately decoupled, so promotion is a conscious move, not a
drift:

1. Confirm the chosen direction against `hearted-design` (tokens, typography,
   materiality, motion) and run `ui-ux-review` on it.
2. Replace the VM with the real types, using the mapping documented in `types.ts`
   to wire real DB fields / loaders / server functions.
3. Swap fixtures for real data sources; remove sample-only props.
4. Decide the fate of any `explorations/` rebuild — either land it as the new prod
   component or fold its changes into the existing one. The small-component split
   makes this granular: promote piece by piece.
5. Keep or delete the `explorations/` folder intentionally. It's fine to keep it as
   living reference while iterating; delete it once the design has fully landed so it
   doesn't rot into a second source of truth.

---

## 8. ANTI-PATTERNS (learned here)

- **Converging too early** — locking one direction's component API / clean types
  before comparing alternatives. Diverge with loose React first.
- **Monolithic components** — one 300-line component for a whole screen. You can't
  swap a direction without a rewrite, can't tune a piece in isolation, and edits
  aren't addressable by name. Extract small, named components (§3).
- **Over-atomizing** — one-line wrapper components that forward props without a real
  seam. Cut at genuine seams, not everywhere.
- **Varying a sub-piece when the whole is the unit** — recoloring a header instead
  of producing new whole-panel directions.
- **Re-skins masquerading as "more variations"** — same composition, new paint.
- **A story per state** — five exports for one component instead of one story with
  controls. Multiplies the sidebar and the diff; use `args`/`argTypes` (§5.1).
- **Flat, ungrouped story lists** — a dozen leaves under one node. Split the title
  into Composable / Components so the tree is readable (§4.2).
- **Static HTML mockups** — they recreate Ladle's infra at lower fidelity and force
  a rebuild. Use real React from the first cut.
- **Entangling explorations with prod** — importing/editing prod components from the
  exploration so you can't iterate without risk. Compose generic primitives only.
- **Skipping the four-theme + breakpoint pass** — a layout that only works in one
  hue or one width isn't done.
