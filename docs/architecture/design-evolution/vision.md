---
status: proposed
updated: 2026-07-31
---

# Design Vision: Warm Tactile Materiality

Evolving hearted.'s visual identity from flat editorial surfaces to warm, tactile materiality — without abandoning the calm, typography-driven foundation.

The current system (SKILL.md) is the base: monochromatic pastel palettes, Instrument Serif + Geist type pairing, flat materials, whitespace-dominant art-gallery density. This proposal layers four treatments on top of that base. Each is independently adoptable; together they form a coherent evolved identity.

Ladle prototypes: `bun run ladle` →
- Unified comparison (Current vs Evolved): `?story=vision--unified--vision`
- Individual directions below

## 1. Color Temperature Depth

**Replace shadows and borders with oklch warmth/coolness shifts.**

Raised/interactive elements are slightly warmer and lighter than the surface. Recessed/passive elements are slightly cooler and darker. One property (color temperature) encodes spatial hierarchy — no shadow, no border, no gradient needed.

```css
/* Raised / interactive */
background: oklch(from var(--t-surface) calc(l - 0.025) calc(c + 0.003) calc(h + 3));
/* Recessed / passive */
background: oklch(from var(--t-surface) calc(l - 0.05) calc(c + 0.002) calc(h - 3));
/* Hover: warmer still */
background: oklch(from var(--t-surface) calc(l - 0.015) calc(c + 0.005) calc(h + 6));
```

**Why it fits:** hearted. already bans shadows on interactive elements. This replaces the current grayish `color-mix(--t-text 7%)` chip fill — which fights the warm palette — with hue-matched depth that adapts automatically to every theme. The warmth shift also echoes the brand's "warm, intimate" character at a material level.

**Where it applies:** chip/pill fills (genre, artist, filter options, theme tags), secondary buttons, card backgrounds, input fields, segment control wells.

Ladle: `?story=vision--color-temperature--color-temperature`

## 2. Squircle Geometry

**Replace standard border-radius with continuous-curvature corners.**

CSS `corner-shape: squircle` (shipping 2026) gives Apple-style superellipse corners where the curve transition is smoother than a standard radius arc. The difference is subtle but reads as more considered.

```css
.pill {
  corner-shape: squircle;
  border-radius: 999px; /* fallback */
}
.card {
  corner-shape: squircle;
  border-radius: 18px;
}
```

**Why it fits:** highest-leverage, lowest-risk upgrade. Doesn't change colors, spacing, or typography. Just makes every rounded shape feel more intentional. Progressive enhancement — falls back to standard radius in older browsers.

**Where it applies:** pills/chips, buttons, cards, album art thumbnails, segment controls, input fields.

Ladle: `?story=vision--squircles--squircles`

## 3. Track-Derived Ambient Glow

**The page breathes with the music.**

Extract the dominant color from album artwork and bleed it as a large, heavily blurred, low-opacity radial gradient behind the content area. The song literally colors the space — fitting the brand voice where "songs have agency."

```css
.ambient-glow {
  position: absolute;
  inset: -10%;
  background: radial-gradient(closest-side, var(--glow-color) 0%, transparent 70%);
  filter: blur(80px);
  opacity: 0.20;
  transition: background 800ms ease;
  pointer-events: none;
}
```

**Why it fits:** adds warmth and life without abandoning flatness. The glow sits *behind* content, never on it. Keeps saturation low so it stays pastel — the base palette still dominates. The slow 800ms transition feels organic, not reactive.

**Where it applies:** playlist studio (behind the tracklist), song detail page (behind the album art), now-playing surfaces. Not system-wide — reserved for music-focused contexts.

Ladle: `?story=vision--ambient-glow--ambient-glow`

## 4. Ceramic Matte Grain

**Flat surfaces feel material, not plastic.**

A barely-perceptible noise texture over surfaces — like the difference between matte and glossy paper, or an exhibition catalog printed on textured stock.

```css
/* Inline SVG with feTurbulence, overlaid on surfaces */
<svg style="position:absolute; inset:0; width:100%; height:100%;
            pointer-events:none; opacity:0.08; mix-blend-mode:overlay;">
  <filter id="grain">
    <feTurbulence type="fractalNoise" baseFrequency="0.65"
                  numOctaves="4" stitchTiles="stitch" />
  </filter>
  <rect width="100%" height="100%" filter="url(#grain)" />
</svg>
```

**Why it fits:** reinforces the "exhibition catalog" vibe without skeuomorphism. The texture is felt more than seen. Uses `overlay` blend mode so it interacts with the surface's own color. Each SVG instance needs a unique filter ID to avoid collisions.

**Where it applies:** page background, card/panel surfaces. Interactive elements (chips, buttons) sit above the grain layer (`z-index: 2`) so legibility is never degraded.

Ladle: `?story=vision--ceramic-grain--ceramic-grain`

## How They Compose

The four directions target different perceptual channels:

| Direction | Channel | Replaces |
| --- | --- | --- |
| Color temperature | Spatial hierarchy | Shadows, borders, gray fills |
| Squircle geometry | Shape language | Standard border-radius |
| Ambient glow | Emotional atmosphere | Static backgrounds |
| Ceramic grain | Surface materiality | Flat/plastic feel |

No two compete. Color temperature defines *what's interactive*. Squircles define *shape*. Glow defines *mood*. Grain defines *texture*. They layer without conflict.

## Adoption Order

1. **Color temperature** — immediate. Replaces the current `color-mix(--t-text 7%)` chip fill that clashes with the warm palette. Scoped to playlist creation first, then system-wide.
2. **Squircle geometry** — immediate. Progressive enhancement, zero visual risk. Apply via a shared style object.
3. **Ambient glow** — prototype on the playlist studio tracklist area, then song detail. One surface at a time.
4. **Ceramic grain** — prototype on the page background first, then card surfaces. Tune opacity per-theme.

## What This Is Not

- Not glassmorphism (explicitly banned in SKILL.md, and rightfully so)
- Not neumorphism (no raised/sunken shadow pairs)
- Not gradient text or neon glows
- Not a departure from the editorial, typography-driven base — it's a material evolution of the same identity
