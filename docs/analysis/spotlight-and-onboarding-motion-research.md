# Spotlight & onboarding-motion research

Reference notes compiled while reworking the onboarding **spotlight / coach-mark** (the
`flag-playlists` step-2 rehearsal on `/playlists`) and, more broadly, for reviewing motion
across the whole onboarding journey.

Sources:

- **animations.dev** (Emil Kowalski's course) — 19 lessons mined and distilled (animation
  theory, CSS animations, framer-motion, Dynamic Island morph, Family Drawer, good-vs-great).
  These are paid lessons; what's below is distilled principles, not transcripts.
- General web research — Ahmad Shadeed's cut-out article, driver.js, coach-mark UX writing.
- **InterfaceCraft.dev** — captured live through the logged-in Chrome session via CDP (after
  standalone tokens kept bouncing to `/library/welcome`). 12 articles mined: the 10 "Working
  Knowledge" concepts + the two "Refining" worked examples. Distilled in §6.

The companion to this doc is the live lab: `Onboarding › Explorations › Spotlight` in Ladle
(`bun run ladle`) — five variant leaves (Current / Soft halo / Quiet rounded / Frosted glass /
Halo frost) plus a **Playground** with every knob, a beat switcher, and auto-cycle to watch the
morph. The variants split across three renderers by `technique`: `box-shadow` (`MaskSpotlight` —
soft-halo, quiet-rounded), `frost` (`FrostSpotlight` — SVG-mask + feGaussianBlur), and
`gradient-frost` (`HaloFrostSpotlight` — the prod crossed-gradient fog + frost, spring-morphed,
with the halo on top: "current × soft-halo").

---

## TL;DR — what to actually change in our spotlight

The current prod `SpotlightOverlay` (crossed linear-gradient mask, square corners, re-measured
every frame, snaps between targets) has three weaknesses the research points straight at:

1. **Square corners.** Fix with a rounded cutout. Best technique: **`clip-path: inset(... round Rpx)`**
   on a full-screen dim layer — GPU-composited, natively rounded, cleanly animatable. (The lab's
   `MaskSpotlight` prototype uses a `box-shadow` cutout instead — simplest, rounded for free, but
   it *can't* frost the backdrop. SVG `<mask>` + `feGaussianBlur` is the option that does rounded
   **and** feather **and** frost, at more complexity.)
2. **It snaps between targets.** Fix with a **spring morph**. Strongest approach: framer-motion
   **`layout` / `layoutId`** rather than manually springing `top/left/width/height` (which the
   prototype does) — `layout` animates via `transform` (GPU, no per-frame layout thrash).
3. **Per-frame `getBoundingClientRect`.** This forces synchronous layout every frame. Switch to
   **`ResizeObserver` + scroll listener** (measure on change, not on a rAF treadmill).

Plus two polish wins: a subtle **accent halo** (reads as a warm spotlight, not a punched hole),
and a **caption crossfade** that lags the morph by ~80ms so the window leads.

---

## 1. The cutout technique (rounded, maybe feathered)

| Technique | Rounded? | Soft/feathered edge? | Frost (backdrop-blur)? | Animatable | Notes |
|---|---|---|---|---|---|
| **clip-path `inset(round)`** | ✅ native `round Rpx` | ❌ hard edge only | ❌ | ✅ GPU, no layout shift | Course's pick for animatable cutouts. One value gives rounded corners. |
| **box-shadow `0 0 0 100vmax`** | ✅ via border-radius | ~ blurred 2nd shadow approximates | ❌ can't frost | ✅ trivially (animate the element) | The lab prototype. Simplest; rounded + glow + morph for free. |
| **SVG `<mask>` + `feGaussianBlur`** | ✅ any shape | ✅ true feather | ✅ (mask a backdrop-filter layer) | ⚠️ verbose to animate | Shadeed's "winner"; the only one doing rounded + feather + frost together. |
| **CSS mask radial-gradient** | ✅ | ✅ soft vignette | ✅ | ✅ | Fades the target out rather than a clean window — atmospheric, not precise. |
| **crossed linear-gradients** (current prod) | ❌ square only | ✅ feather | ✅ | ✅ per-frame | What we have. Soft edges, but can't round. |

**Recommendation:** if we want to keep the current frosted look **and** gain rounded corners,
go **SVG mask + feGaussianBlur**. If we're willing to drop the frost for a cleaner, more
animatable result, **clip-path inset(round)** (crisp) or **box-shadow** (crisp + free glow) are
both great and far simpler. Decide frost-vs-simplicity first; it picks the technique.

`clip-path` reveal pattern (for reference):

```css
.dim { clip-path: inset(0 0 100% 0); }
@keyframes reveal { to { clip-path: inset(0 0 0 0 round 16px); } }
/* animated dynamically: inset(<top>px <right>px <bottom>px <left>px round 16px) */
```

Feathering note: `clip-path` is **hard-edged by definition**. For a soft edge you need an SVG
`feGaussianBlur` mask, a `mask-image` radial-gradient, or the box-shadow trick. Keep any
`filter: blur()` **under ~20px** — it gets very laggy on Safari above that.

---

## 2. Motion — springs, easing, timing

### Springs vs easing
- **Spring** when there's real spatial movement (position/size morph) or it must be
  **interruptible** (re-targets carrying current velocity — a CSS transition would jump). Our
  spotlight window moving between targets is the textbook case.
- **Easing/tween** for non-spatial props (opacity, color) and where bundle size matters.
- framer-motion auto-picks: physical props (`x`, `scale`, layout) → spring; `opacity`/`color` →
  tween. Override via `transition`.

### Spring config
- Prefer the **`duration` + `bounce`** API over raw stiffness/damping when you can — more
  intuitive. Default posture: **zero / near-zero bounce**. Bounce only earns its place when the
  user applied physical force (a drag), never on a tap/click step-through.
- For a **viewport-scale** window move (our case): lower stiffness, near-zero bounce so it reads
  as *decisive settlement*, not a spring toy. Starting point:
  `{ type: "spring", stiffness: 280, damping: 32, mass: 0.9 }` (≈ `bounce 0.1–0.15`). Keep
  `bounce ≤ 0.15`.

### The easing blueprint (for the non-spring bits — backdrop fade, caption)
| Curve | Use for |
|---|---|
| **ease-out** | things appearing/disappearing (backdrop fade-in, caption-in) — fast start reads as responsive |
| **ease-in-out** | things already on screen that move/morph |
| **ease** (native) | gentle hover, small color/opacity changes |
| **linear** | progress/time indicators only |
| **ease-in** | avoid in UI (sluggish) |

Custom `cubic-bezier()` beats the built-ins (which are "not strong enough"). Our house tokens
already encode this: `--ease-out-quart`, `--ease-out-expo`, `--ease-in-out-sine`.

### Duration & frequency
- **< 300ms** for standard UI; larger/heavier elements get slightly more time.
- Duration should scale with **how often** a thing is seen: 100×/day → instant; once/session
  (onboarding!) → can be slower and more expressive. The spotlight is first-run, so its morph
  (~350–450ms) and a touch of expressiveness are *earned*.
- **Never animate keyboard-triggered navigation** (highlight must track the keypress).
- Stagger only on infrequently-seen elements. "One entrance per container" — don't animate a
  parent *and* stagger its children.

---

## 3. Morphing — the Dynamic Island / Family Drawer playbook

The single highest-leverage upgrade for the spotlight is making the move between targets feel
like **one continuous object morphing**, not two states swapping.

- **Use framer-motion `layout`** on the window instead of manually springing
  `top/left/width/height`. `layout` interpolates via `transform` (GPU-composited, no layout
  thrash) and the API is just "change where it is in the DOM, FM tweens the rest." Use
  **`layoutId`** if the window unmounts/remounts between targets (true shared-element morph).
- **Hold `borderRadius` constant** via `style` (don't animate it) — animating radius *while*
  layout animates creates compound visual noise. The rounded frame is the spotlight's identity;
  let position/size tell the story.
- **`overflow: hidden`** on the window so prior content doesn't bleed past the radius mid-morph.
- **Crossfade the caption**, don't hard-swap it. Delay the incoming caption ~80ms so the window
  is visibly *en route* before the text appears (let the container move first):

```tsx
<AnimatePresence mode="wait">
  <motion.span key={beatId}
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0, transition: { delay: 0.08 } }}
    exit={{ opacity: 0, y: -6 }}
    transition={{ duration: 0.15, ease: "easeOut" }}>
    {caption}
  </motion.span>
</AnimatePresence>
```

- **Blur bridges states.** A brief `filter: blur(4px) → blur(0)` on incoming content (and/or a
  soft edge on the window) makes the morph read as continuous rather than a cut. (Keep blur low —
  Safari.)
- **Same spring for everything** moving at once (window + caption + any content) so they settle
  together and read as one object.

---

## 4. Performance & accessibility (applies to the spotlight specifically)

- **Per-frame `getBoundingClientRect` forces layout.** Our overlay re-measures every frame in a
  rAF loop — a perf smell. Prefer **`ResizeObserver`** (fires on geometry change) + a scroll
  listener over polling; the recent "idle after 12 stable frames" tweak mitigates but doesn't
  remove it.
- Animate **only `transform` + `opacity`** for the cheap (composite-only) path. `top/left/width/height`
  (what the prototype springs) hit layout+paint — another reason to move to `layout`/transform.
- **Don't update a CSS variable on a parent every frame** — it recalculates styles for *all*
  descendants. Mutate the element's own `style`/transform directly.
- `will-change: transform` (or `clip-path`) sparingly, only on the element that actually animates,
  to avoid CPU↔GPU hand-off jitter.
- **Reduced motion:** the dim + cutout *stay* (they convey focus); **cut the morph** — instant-jump
  the window, keep only an opacity fade. `useReducedMotion()` → near-instant spring / `duration 0`.
  Don't merely slow it down.
- **Focus management:** for a modal-ish blocking overlay, trap focus + honor Escape + `aria-modal`
  (the prod overlay's coach-mark already moves focus in / traps / Escape — keep that).

---

## 5. General onboarding-motion principles (for reviewing the whole journey)

- **Earn every animation.** It must prevent a jarring jump, maintain spatial consistency, give
  feedback, or explain a concept. If it does none, cut it.
- **Restraint compounds.** The more you animate, the less each one means. Pace motion across the
  flow; the best transition is sometimes none.
- **Animation as proof of care.** Users can't audit the code, but they *feel* whether it was made
  with care — well-crafted motion (even unnoticed) builds subconscious trust. Go one step further
  than necessary, never two.
- **The big little details:** scale from `~0.8`, never `scale(0)`; a hair of blur on enter/exit
  hides imperfections and adds depth; vary timing by hierarchy (important elements slightly
  slower to pull the eye); ship, sleep on it, scrub frame-by-frame, then refine.
- **Taste is trainable** — articulate *why* ("ease-out starts fast → reads responsive"), don't
  just label "snappier." Recreate animations you admire until the replica satisfies you.

---

## 6. Interface Craft — design-craft philosophy

### Core concepts

- **Noticing** — The most important design skill is sustained, deliberate attention. Your first read of any interface is shallow; meaning lives in the second and third look — the hesitation, the expectation gap, the moment the mood shifts. Noticing is trained like a muscle, not granted.
- **Conceptual Range** — Before committing to depth on any direction, explore fundamentally different structural alternatives, not just variations of the same idea. True range means questioning the constraint itself ("what if users don't have to do anything at all?"), not reskinning the same interaction.
- **Conceptual Depth** — Once a direction is chosen, most work stops at levels 1–3 on an imaginary 1–10 spectrum. The early levels fix obvious gaps; the later levels require invention and relentless reduction. Great work pushes past the point where it "seems done."
- **Live Tuning** — Rather than save→refresh→inspect cycles, expose key parameters (duration, spacing, easing, blur, scale) as real-time controls so you *feel* the difference instantly. Builds calibrated intuition and surfaces combinations you'd never reach by guessing.
- **Uncommon Care** — The gap between good and great is almost always care, not capability. Care shows up in edge cases, error states, and moments users don't expect to be noticed — exactly the work no one would blame you for skipping.
- **Separation of Concerns** — Before implementing, name the single question you're answering now (confidence in an interaction? visual direction? density?), then produce the minimum artifact that resolves it. Polishing everything at once causes rabbit holes and rework.
- **Facets of Quality** — Generic attributes ("polished", "clean") give no traction. Define the 4–6 product-specific qualities you want users to *feel*, score them honestly (1–5), and use that radar to drive critique and release priorities.
- **Less, but Better** — Restraint is a design act. Fewer things executed to an uncommon standard beat more things done adequately. The question is what can be removed without loss.
- **Recreate Everything** — When something catches your eye and you don't know how it works, rebuild it immediately, roughly and quickly — to close the gap between inspiration and capability, not to make a polished copy.
- **Industry Standards** — Mainstream apps (iOS, Linear, Figma, Notion) set an invisible floor. Fall below it and users reject silently — they won't explain why, they just leave. The standard is the floor, not the goal: start from the platform default, then innovate upward.

### Refining (worked examples)

- **Refining Today** (a daily planner already near industry standard): a cluster of small incoherencies — filled Create icon vs. outline elsewhere, four competing vertical-alignment rules, a toolbar container adding weight for no function, dividers in one list but not another, category labels too small/bright. Every fix was a *reduction/unification* move (strip the toolbar container, standardize icon strokes, collapse alignment to two rules, replace dividers with tighter padding, style category labels as tokens). Same information, far less noise → reads as native iOS, not iOS-adjacent.
- **Refining Presscut** (an analytics dashboard reading below standard): redundant subtitle, scoreboard cards with bloated padding + three-line metrics, chart fighting dashed gridlines and crowded x-axis, an overloaded table, decorative serif used inconsistently, progress bars too narrow to mean anything. Sequence: collapse four cards into one row → embed it as the interactive chart header → reduce x-axis to five key dates → swap serif for body on section headers → reuse scoreboard icons as column headers (cross-reference) → replace inline bars with row-background fill → drop the redundant "Edition" column. The data starts to speak.

### >>> How this maps to our work

- **Live Tuning → the Ladle Playground.** The Playground story *is* this principle. Every new spotlight/coach-mark parameter should ship first as a live dial, not a guessed value — that's how we build intuition for what "right" feels like vs. what "plausible" looks like.
- **Conceptual Range → diverge.** Before locking the spotlight, generate ≥3 *structurally different* directions, not blur-more-vs-less: no overlay at all (just a pulse)? the coach-mark IS the highlight border? focus via motion rather than masking?
- **Conceptual Depth → converge.** Don't ship the spotlight at level 3. Schedule explicit "push further" passes: level 5 (timing natural, dismiss satisfying), level 7 (an entry micro-beat that orients; a pulse that carries meaning).
- **Industry Standards + Noticing → the journey audit.** Walk the full onboarding asking first "does this belong on this platform?" (floor), then sit with each screen longer than feels necessary and name the exact moment you hesitate — that annotation is the input to the next fix round.
- **Facets of Quality → a review rubric.** Define 4–5 qualities a first-time hearted user should feel (*understood, trusted, curious, in control, delighted*), score the current flow, and prioritize revision passes from the gaps.
- **Separation of Concerns → decomposition.** Spotlight, coach-mark, pulse, and orchestrator are separate concerns → separate components, each its own Ladle story. Tuning the pulse shouldn't mean touching coach-mark copy or overlay opacity.
- **Uncommon Care → the small moments.** The skip path, the dismiss affordance, the post-onboarding empty state, the demo→real cliff at `install-extension` — the boilerplate moments are where care accumulates into something users tell others about.

---

## 7. References

- animations.dev — animation-theory (feel-right, springs, easing-blueprint, timing-and-purpose,
  taste), css-animations (clip-path, transitions, transforms), good-vs-great
  (big-little-details, performance, accessibility), framer-motion (basics, hooks), dynamic-island
  (morph-effect), family-drawer (crossfade, finishing-touch), guest (animations-as-proof-of-care).
- Ahmad Shadeed — "Thinking About The Cut-Out Effect: CSS or SVG?"
  https://ishadeed.com/article/thinking-about-the-cut-out-effect/
- driver.js — styling-overlay (stagePadding/stageRadius, animated SVG path cutout).
  https://driverjs.com/docs/styling-overlay
- Atlassian Design — Onboarding (spotlight) component guidance.
- Plotline / Chameleon — coachmark & spotlight UX best practices.
- Interface Craft (interfacecraft.dev/library) — Working Knowledge: Noticing, Conceptual Range,
  Conceptual Depth, Live Tuning, Uncommon Care, Separation of Concerns, Facets of Quality, Less
  but Better, Recreate Everything, Industry Standards; plus Refining Today / Refining Presscut.
