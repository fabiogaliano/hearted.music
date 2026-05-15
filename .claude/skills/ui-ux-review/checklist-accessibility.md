# Accessibility Checklist

Based on WCAG 2.2 standards and inclusive design principles. Vision impairments affect more than 1 in 4 users worldwide. 1 in 12 men have some form of color blindness.

## Color & Contrast

- [ ] Normal text meets 4.5:1 contrast ratio against its background (every state, not just default)
- [ ] Large text (≥18px or ≥14px bold) meets 3:1 contrast ratio
- [ ] State changes are never communicated through color alone — always pair with icons, borders, underlines, or text
- [ ] Error states use red + warning icon + descriptive text (not just red)
- [ ] Success states use green + checkmark + label (not just green)
- [ ] Design remains understandable in grayscale (test by desaturating)

## Focus Management

- [ ] All interactive elements have visible focus indicators (never `outline: none` without replacement)
- [ ] Focus ring has sufficient contrast (WCAG 2.2 requires minimum size and contrast thresholds)
- [ ] Prefer `:focus-visible` over `:focus` to skip mouse-click focus rings while preserving keyboard focus
- [ ] Tab order follows visual/logical reading order
- [ ] Focus is trapped within modals/dialogs when open (and restored on close)
- [ ] Skip-to-content link is available for keyboard users

## Keyboard Navigation

- [ ] All functionality is operable via keyboard (Tab, Enter, Space, Escape, Arrow keys)
- [ ] Hamburger menus and dropdowns are keyboard-navigable
- [ ] Escape closes modals, dropdowns, and popovers
- [ ] No keyboard traps — users can always tab away from any element
- [ ] Custom components implement expected keyboard patterns (e.g., arrow keys in tab lists, space for checkboxes)

## Screen Reader Support

- [ ] All images have descriptive `alt` text (or `alt=""` for decorative images)
- [ ] Navigation elements have ARIA labels (`aria-label="Main navigation"`)
- [ ] Toggle buttons use `aria-pressed="true|false"`
- [ ] Loading states announce via `aria-live` regions
- [ ] Form inputs have associated `<label>` elements (not just placeholder text)
- [ ] Error messages are programmatically linked to their inputs (`aria-describedby`)
- [ ] Heading hierarchy is semantic (H1 → H2 → H3, no skipped levels)
- [ ] Semantic HTML is used: `<nav>`, `<main>`, `<section>`, `<article>`, `<aside>`, `<footer>`

## Interactive Elements

- [ ] Buttons use `<button>` (not `<div>` or `<span>` with click handlers)
- [ ] Links use `<a>` with `href` (for navigation) — buttons for actions
- [ ] Disabled elements use proper HTML `disabled` attribute or `aria-disabled="true"` for non-native elements
- [ ] Disabled buttons include explanatory text (tooltip or inline message) for why they're disabled
- [ ] Touch targets are ≥ 44×44px on mobile
- [ ] Interactive elements have sufficient spacing to prevent accidental activation

## Motion & Animation

- [ ] Respect `prefers-reduced-motion` — reduce or remove animations for users who request it
- [ ] Animations serve a purpose (feedback, orientation, state change) — never purely decorative
- [ ] Transition durations stay within 100–200ms for state changes
- [ ] No auto-playing video or audio without user initiation
- [ ] Progress indicators are provided for operations longer than ~1 second

## Content

- [ ] Text is resizable up to 200% without breaking layout
- [ ] Content is readable without horizontal scrolling at 320px viewport width
- [ ] Language is clear and concise — avoid jargon
- [ ] Error messages explain the problem AND the solution
- [ ] Time-sensitive actions provide sufficient time or ability to extend

## Testing Protocol

When doing a full accessibility audit:

1. **Keyboard-only test:** Unplug the mouse. Tab through the entire flow. Can you complete every action?
2. **Screen reader spot-check:** Verify key landmarks, headings, button labels, and form associations
3. **Zoom test:** Zoom to 200%. Does everything still work?
4. **Color test:** View in grayscale. Is the hierarchy and state information still clear?
5. **Motion test:** Enable `prefers-reduced-motion`. Do animations respect it?
6. **Touch test:** On a real mobile device, can you tap every target comfortably?
