/**
 * Hero Section Base Styles
 *
 * These styles provide:
 * - Initial fade-in animation (non-scroll-driven)
 * - Scroll indicator bounce animation
 * - Reduced motion fallbacks
 * - Mobile static layout overrides
 *
 * Scroll-driven animations are handled by GSAP ScrollTrigger
 * in useHeroAnimation.ts for cross-browser support.
 */
export const heroStyles = `
	/* ─────────────────────────────────────────────────────────────────
	   PHASE 0: AUTO FADE-IN (not scroll-driven)
	   All centered content fades in together on page load
	   ───────────────────────────────────────────────────────────────── */
	.hero-initial-fade {
		opacity: 0;
	}
	.hero-initial-fade.is-ready {
		animation: initial-fade-in 1.5s ease-out forwards;
	}

	@keyframes initial-fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	/* ─────────────────────────────────────────────────────────────────
	   SCROLL INDICATOR
	   Bouncing arrow animation (GSAP handles opacity)
	   ───────────────────────────────────────────────────────────────── */
	.scroll-arrow {
		animation: bounce-arrow 1.5s ease-in-out infinite;
	}

	@keyframes bounce-arrow {
		0%, 100% { transform: translateY(0); }
		50% { transform: translateY(6px); }
	}

	/* ─────────────────────────────────────────────────────────────────
	   GSAP SCROLLTRIGGER SPACER FIX
	   Ensure GSAP-created pin-spacer doesn't break layout
	   ───────────────────────────────────────────────────────────────── */
	.pin-spacer {
		/* GSAP adds this class to the spacer element */
		/* Prevent any unintended scroll-snap behavior */
		scroll-snap-align: none !important;
	}

	/* ─────────────────────────────────────────────────────────────────
	   PERFORMANCE HINTS
	   GPU acceleration for animated elements
	   ───────────────────────────────────────────────────────────────── */
	.hero-logo,
	.hero-headline {
		will-change: transform;
		backface-visibility: hidden;
	}

	.hero-background {
		will-change: transform;
	}

	.hero-background-inner {
		will-change: transform;
		backface-visibility: hidden;
	}

	.hero-panel {
		will-change: clip-path, opacity;
	}

	.hero-panel-curtain {
		will-change: transform;
		backface-visibility: hidden;
	}

	/* ─────────────────────────────────────────────────────────────────
	   REDUCED MOTION PREFERENCE
	   Show final state immediately, no animations
	   ───────────────────────────────────────────────────────────────── */
	@media (prefers-reduced-motion: reduce) {
		.hero-initial-fade {
			opacity: 1 !important;
			animation: none !important;
		}
		.scroll-indicator {
			display: none !important;
		}
		.scroll-arrow {
			animation: none !important;
		}
		.hero-logo,
		.hero-headline {
			transform: none !important;
			will-change: auto;
		}
		.hero-background {
			will-change: auto;
		}
		.hero-background-inner {
			will-change: auto;
		}
		.hero-panel {
			will-change: auto;
		}
		.hero-panel-curtain {
			will-change: auto;
		}
		.hero-nav-btn {
			transition: none !important;
		}
	}

	/* ─────────────────────────────────────────────────────────────────
	   MOBILE: STATIC LAYOUT
	   No scroll animations on mobile, show final state
	   ───────────────────────────────────────────────────────────────── */
	@media (max-width: 1279px) {
		.hero-section {
			/* Remove any pinning on mobile */
			height: auto !important;
		}
		.hero-pinned-content {
			position: relative !important;
			height: auto !important;
			min-height: 100vh;
		}
		.hero-initial-fade {
			opacity: 1 !important;
			animation: none !important;
		}
		.scroll-indicator {
			display: none !important;
		}
		.hero-logo,
		.hero-headline {
			transform: none !important;
			max-width: none !important;
			white-space: normal !important;
		}
		.hero-logo-heart {
			width: 20px !important;
			min-width: 20px !important;
			opacity: 1 !important;
		}
		.hero-background {
			transform: none !important;
		}
		.hero-background-inner {
			transform: none !important;
		}
		.hero-panel {
			opacity: 1 !important;
			clip-path: none !important;
		}
		.hero-panel-curtain {
			transform: translateX(100%) !important;
		}
		.hero-subtext,
		.hero-cta {
			opacity: 1 !important;
			transform: none !important;
		}
		.hero-nav-btn {
			display: none !important;
		}
	}
`;
