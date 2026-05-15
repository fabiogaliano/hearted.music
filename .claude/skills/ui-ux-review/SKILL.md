# UI/UX Review

Comprehensive UI/UX review skill for auditing and improving the codebase's user interface and experience quality. Grounded in measurable design principles, accessibility standards, and interaction patterns.

## When to Use

- Reviewing any UI component, page, or feature for design quality
- Auditing accessibility compliance
- Improving interaction feedback, visual hierarchy, or responsiveness
- Before shipping user-facing changes

## How to Use

1. Read the target component/page code
2. Load the relevant checklist files from this skill directory:
   - `checklist-interactions.md` — Button states, feedback, navigation, forms
   - `checklist-visual.md` — Hierarchy, color, typography, spacing, layout
   - `checklist-responsive.md` — Mobile-first, touch targets, responsive patterns
   - `checklist-accessibility.md` — WCAG compliance, focus management, screen readers
3. Evaluate the code against each applicable check
4. Report findings as a prioritized list: critical → important → polish
5. Implement fixes in priority order

## Review Output Format

```
## UI/UX Review: [Component/Page Name]

### Critical (blocks ship)
- [ ] Finding with specific file:line reference

### Important (should fix)
- [ ] Finding with specific file:line reference

### Polish (nice to have)
- [ ] Finding with specific file:line reference
```

## Key Thresholds (quick reference)

| Metric | Value |
|---|---|
| Touch target minimum | 44×44px |
| Text contrast ratio (normal) | ≥ 4.5:1 |
| Text contrast ratio (large) | ≥ 3:1 |
| Transition duration | 100–200ms |
| Body text size | ≥ 16px |
| Line height | 1.125–1.2× font size |
| Line length | 40–60 characters |
| Color palette ratio | 60-30-10 (primary-secondary-accent) |
| Max pricing/option tiers | 3–4 |
| Core task completion | ≤ 3–5 taps/clicks |
