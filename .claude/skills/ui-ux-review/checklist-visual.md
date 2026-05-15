# Visual Design Checklist

## Visual Hierarchy

The arrangement of elements in order of importance, directing user attention to content that meets their needs.

### 7 Hierarchy Principles to Verify

1. **Size** — More important elements are larger. H1 > H2 > body. Primary buttons > secondary buttons.
2. **Color & Contrast** — Key elements use higher luminance/contrast. Destructive actions in red. CTAs in brand accent color.
3. **Alignment** — Related elements share alignment. Content follows a grid. Nothing floats arbitrarily.
4. **Proximity** — Related items are grouped together. Unrelated items have clear separation. (Gestalt: proximity)
5. **Spacing** — White space between sections creates breathing room. Dense layouts overwhelm; "a little goes a long way."
6. **Weight** — Bold/heavy fonts for headings and labels. Regular weight for body text. Weight creates scan points.
7. **Time/Animation** — Animations guide attention to changes. Progress indicators set expectations. Motion is purposeful, not decorative.

### Hierarchy Checks

- [ ] Is there a single clear focal point on the screen? If everything is emphasized, nothing is.
- [ ] Does the visual order match the content priority? (What the user cares about most should be most prominent)
- [ ] Are primary and secondary actions visually distinct? (Primary: filled/bold, Secondary: outlined/subdued)
- [ ] Is the destructive action (delete, remove) visually different from safe actions?
- [ ] Does progressive disclosure hide secondary information behind expandable sections?

## Color

### Rules

- **60-30-10 rule:** 60% dominant/background color, 30% secondary, 10% accent.
- **WCAG contrast minimums:** 4.5:1 for normal text, 3:1 for large text (≥18px or ≥14px bold).
- **Never rely on color alone** to convey state changes. Pair color with icons, border changes, or text labels. (~1 in 12 men are color blind.)
- **Semantic color usage:**
  - Red = destructive/error/danger
  - Green = success/confirmation
  - Yellow/amber = warning/caution
  - Blue = informational/trust
- **Grayscale-first:** Design should make sense in grayscale before color is applied. If hierarchy breaks without color, the layout needs work.

### Color Anti-patterns

- Using only color to differentiate states (hover, error, success)
- Low contrast text on colored backgrounds (especially light gray on white)
- Inconsistent color meaning across the app (red means delete on one page, "premium" on another)
- Too many accent colors competing for attention

## Typography

### Measurable Standards

| Property | Target | Notes |
|---|---|---|
| Body text size | 16px minimum | Standard web convention; below this causes squinting on mobile |
| H1 heading | ~48px (3× body) | Can flex with design system, but must be clearly largest |
| Line height (leading) | 1.125–1.2× font size | Tight leading reduces readability; too loose wastes space |
| Line length | 40–60 characters | Beyond 60 chars, increase line height. Below 40, text feels choppy |
| Font weight scale | 100–900 | Regular (400), Medium (500), Semi-Bold (600), Bold (700) |
| Tracking (letter-spacing) | Increase for ALL CAPS text | ALL CAPS without extra tracking is harder to read |

### Typography Checks

- [ ] Is there a clear type hierarchy? (H1 > H2 > H3 > body > caption)
- [ ] Are no more than 2–3 typeface families used?
- [ ] Is body text at least 16px?
- [ ] Do line lengths stay within 40–60 characters on desktop?
- [ ] Is line height between 112.5%–120% of font size?
- [ ] Are fonts web-optimized? (Inter, Roboto, Open Sans, Poppins, etc.)
- [ ] Does fluid typography scale between breakpoints? (CSS `clamp()`)
- [ ] Is ALL CAPS used only for labels/buttons, never for long-form text?

## Layout & Grid

### Principles

- Use a consistent grid system (8px base unit is standard)
- Content should flow in a single column on mobile, expanding to multi-column on larger screens
- Card layouts, grid layouts, and split-screen layouts each suit different content types
- F-pattern and Z-pattern eye tracking: place critical content top-left and along the top edge
- White/negative space is a feature, not wasted space — it creates focus and reduces cognitive load

### Layout Checks

- [ ] Does the layout follow a consistent grid? (Check for alignment to 8px increments)
- [ ] Are related items grouped in clear visual regions? (Gestalt: common region)
- [ ] Is there sufficient padding between interactive elements? (Prevents mis-taps)
- [ ] Does the most important content appear "above the fold" (visible without scrolling)?
- [ ] Is there a "back to top" pattern on long scrolling pages?

## UI Consistency

- Every button of the same type must behave and look the same across all screens
- Limit the palette: 2–3 typefaces, 1–2 primary colors, consistent icon style
- Use a design token system: spacing, color, and typography values should come from shared constants, not magic numbers
- Deviations from patterns require justification — inconsistency adds cognitive load
- Logo should always link to homepage
