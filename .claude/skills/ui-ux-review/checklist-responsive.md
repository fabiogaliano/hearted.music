# Responsive & Mobile Design Checklist

## Mobile-First Principles

96% of internet users go online with phones. Mobile-first means designing for the smallest screen first, then enhancing for larger screens.

### Content Strategy

- Prioritize the most important content and features for mobile — everything else is progressive enhancement
- Users on mobile skim, don't read deeply — prioritize clarity, scannable structure, and utility
- Core tasks should be completable within 3–5 taps
- Avoid pop-ups on mobile — they block content and frustrate users. Use banners or inline messages instead

### Touch Targets

- **Minimum size: 44×44px** for all interactive elements (buttons, links, form controls)
- Sufficient spacing between adjacent touch targets to prevent accidental taps
- Primary actions should sit within the thumb zone (center-bottom of screen for one-handed use)
- Increase click target area using padding, not just visible element size

### Navigation on Mobile

- Use hamburger menus, bottom navigation bars, or tab bars for compact navigation
- Bottom navigation is preferred for frequently-used actions (within thumb reach)
- Keep menu text short and scannable
- Include a "back to top" button on long-scrolling pages
- Link the logo to the homepage (standard shortcut, especially when nav is collapsed)
- Breadcrumbs help users orient themselves within deep navigation hierarchies

## Responsive Implementation

### CSS Patterns

```css
/* Fluid grid — auto-fits columns to available space */
.container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 16px;
}

/* Responsive images — never exceed container */
img, video {
  max-width: 100%;
  height: auto;
  display: block;
}

/* Fluid typography — scales between min and max */
h1 {
  font-size: clamp(1.5rem, 5vw, 3rem);
}

/* Hide sidebar on mobile */
@media (max-width: 768px) {
  .sidebar { display: none; }
  .menu-toggle { display: block; }
}
```

### Breakpoint Strategy

With Tailwind CSS (this project's framework):
- `sm:` (640px) — Large phones landscape
- `md:` (768px) — Tablets
- `lg:` (1024px) — Laptops
- `xl:` (1280px) — Desktops
- `2xl:` (1536px) — Large monitors

### Responsive Checks

- [ ] Does the layout collapse to single-column on mobile?
- [ ] Do images use `max-width: 100%; height: auto;` (or Tailwind equivalents)?
- [ ] Is fluid typography implemented? (`clamp()` or Tailwind's responsive text sizes)
- [ ] Are comparison tables replaced with accordions on mobile?
- [ ] Are sticky CTAs present on long-scrolling mobile pages?
- [ ] Does navigation transform appropriately? (Full nav → hamburger/bottom bar)
- [ ] Are all interactive elements ≥ 44×44px on touch devices?
- [ ] Is text readable without zooming? (≥ 16px body, sufficient contrast)
- [ ] Are images in optimized formats? (WebP or AVIF, with proper compression)
- [ ] Are hover-dependent interactions accessible on touch? (No hover-only tooltips)

## Performance (Mobile-Relevant)

- Compress images — use WebP/AVIF, not uncompressed PNG/JPEG
- Minimize third-party scripts and use lightweight frameworks
- Lazy-load images and content below the fold
- Reduce unnecessary assets — every byte matters on slower mobile connections
- Test on real devices, not just browser dev tools device simulation

## Pricing Pages & Complex Layouts (Mobile Adaptation)

When reviewing pricing pages, settings panels, or comparison-heavy UIs:
- Stack plan cards vertically on mobile
- Replace wide comparison tables with expandable accordions
- Sticky CTAs at bottom of viewport — always in reach
- Tooltips must be tap/click-triggered, not hover-triggered (no hover on touch)
- Use info icons (ⓘ or ?) to signal expandable detail
- Limit plans to 3–4 options to avoid decision paralysis (Hick's Law)
- Use "Everything in [previous tier], plus..." to avoid repeating features
