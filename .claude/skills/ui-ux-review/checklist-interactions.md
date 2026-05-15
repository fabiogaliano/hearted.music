# Interaction Design Checklist

## Button States

Every interactive button must implement these states. Missing states erode user trust.

### 5 Core States (required)

| State | Visual Treatment | CSS/Implementation | Common Mistakes |
|---|---|---|---|
| **Default** | Base color, full opacity, standard border | Base styles | Buttons that don't look clickable ("mystery meat navigation") |
| **Hover** | Subtle color shift or shadow lift | `:hover` or `onMouseEnter` | Overdoing it with dramatic color swaps or heavy motion |
| **Active/Pressed** | Darker fill, slight scale-down (~0.98) | `:active` or press feedback | No tactile feedback on click/tap |
| **Focus** | Visible focus ring (3px outline + offset) | `:focus-visible` | Suppressing focus ring with `outline: none` without custom replacement |
| **Disabled** | Muted fill, reduced opacity, `not-allowed` cursor | `:disabled` or `aria-disabled` | Disabled with no explanation of why |

### Functional States (for async operations)

| State | When | Visual Treatment | Key Rule |
|---|---|---|---|
| **Loading** | After click, awaiting response | Spinner or progress bar, button disabled | Prevent duplicate submissions |
| **Success** | Action completed | Green fill + checkmark, brief animation | Use specific labels: "Saved", "Sent", "Done" — not generic "Success" |
| **Error** | Action failed | Red fill/border + warning icon | Must include recovery path: what went wrong + what to do next |
| **Selected/Toggled** | Toggle/filter active | Filled or inverted style | Use `aria-pressed="true"` |

### Button Anti-patterns to Flag

- Buttons that only reveal interactivity on hover
- No visual hierarchy between primary and secondary actions
- Disabled buttons without inline explanation of the blocking condition
- Focus ring removed without custom replacement
- Hover-only tooltips (unreachable on touch devices)
- Over-animated state transitions (keep to 100–200ms)
- Loading states that don't disable the button (causes duplicate submissions)

## Feedback & System Status

From Shneiderman's 8 Golden Rules of HCI:

- **Every action must produce visible feedback.** Progress bars for downloads, color changes for success, spinners for loading.
- **Dialogue on completion.** Clear language like "Purchase Confirmed" — not silent success.
- **Error handling with guidance.** "Payment failed. Check your card details and try again" > red button with no context.
- **Reversal/Undo.** Destructive actions need confirmation or undo (e.g., undo-send, trash instead of permanent delete).
- **User control.** Let users customize and decide how they interact. Don't force single paths.
- **Reduce memory load.** Use filters, search, and smart defaults. Don't make users remember state across screens.

## Navigation

### Hamburger Menu Rules
- Use the standard three-line icon — don't invent custom icons
- Place consistently: top-left or top-right, same across all screens
- Organize items by priority: most-used actions at the top
- Provide visual feedback on selection (color change, animation)
- Add ARIA labels: `aria-label="Toggle navigation menu"`
- Ensure keyboard navigability (Tab, Enter, Escape to close)
- Consider alternatives when appropriate: tab bar, bottom nav, side nav

### Navigation Anti-patterns
- Hiding primary actions behind hamburger menus on screens with room for them
- Inconsistent menu placement across pages
- No keyboard navigation support
- Missing ARIA labels on navigation toggles
- Pop-ups blocking content on mobile (avoid pop-ups on mobile entirely)

## Forms

- Submit button must be visually prominent and larger than surrounding elements
- Input fields, checkboxes, and all clickable areas must meet touch target minimums (44×44px)
- Use inline validation — show errors as the user fills fields, not only on submit
- Tab order must follow visual order
- Labels must be programmatically associated with inputs (not just visually adjacent)

## Call-to-Action (CTA) Patterns

- Use color contrast to make CTAs visually distinct from surrounding elements
- Position primary CTAs above the fold and/or sticky
- Use action verbs: "Get Started", "Shop Now", "Book a Demo" — not "Submit" or "Click Here"
- Provide multiple CTA entry points on long pages (top, mid, bottom)
- Match CTA specificity to user's journey stage (broad early → specific late)
- For side-by-side CTAs: primary gets visual weight, secondary is subdued
- Surround CTAs with social proof (ratings, testimonials) where purchase hesitation is highest

## Cognitive Load Reduction

- **Fitts' Law:** Larger targets closer to the user's starting point are faster to reach. Primary actions should be big and within thumb/cursor zone.
- **Hick's Law:** Decision time increases with number and complexity of choices. Limit options; use progressive disclosure.
- **3–5 tap rule:** Users should complete core tasks within 3–5 interactions.
- **Progressive disclosure:** Break complex flows into digestible steps. Show a progress indicator so users know where they are.
- **Familiarity:** Use established patterns (hamburger = menu, trash can = delete, heart = favorite). Don't reinvent conventions.
