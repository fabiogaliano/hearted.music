/**
 * useHeroAnimation - GSAP ScrollTrigger-based hero animation hook
 *
 * Replaces CSS scroll-timeline with GSAP for cross-browser support (Safari, Firefox, Chrome).
 * Uses ScrollTrigger pin for a single main-page scroll experience.
 *
 * Animation Phases (progress 0 → 1 over 200vh scroll):
 * - 0.00–0.08: Scroll indicator fades out
 * - 0.00–0.65: Logo morph (center large → nav slot small)
 * - 0.00–0.65: Headline morph (center small → left large)
 * - 0.00–0.65: Background shrink (100vw → 50%)
 * - 0.40–0.65: Nav button fade in
 * - 0.60–1.00: Right panel reveal (clip-path wipe)
 * - 0.80–1.00: Subtext fade in
 * - 0.85–1.00: CTA fade in
 */
import type { RefObject } from 'react'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// Register plugins once at module level
if (typeof window !== 'undefined') {
	gsap.registerPlugin(ScrollTrigger)
}

/** Debounce delay (ms) for restoring scroll-snap after scroll activity stops */
const SCROLL_SNAP_RESTORE_DELAY_MS = 220

/**
 * Timeline compression factor - animations complete at this % of total scroll.
 * The remaining scroll is a "lock zone" where the page stays in final state.
 *
 * Example: 0.80 means animations finish at 80% scroll, leaving 20% dead zone.
 * Set to 1.0 to disable the lock zone.
 */
const ANIMATION_END_POINT = 0.8

const ANIMATION_START_POINT = 0.05

const AUTO_COMPLETE_TRIGGER_VELOCITY_PX_PER_S = 1400
const AUTO_COMPLETE_MIN_PROGRESS = 0.08
const AUTO_COMPLETE_RESET_POINT = 0.04
const AUTO_COMPLETE_DURATION_S = 1.2

export interface HeroAnimationRefs {
	/** The hero section container (trigger element) */
	sectionRef: RefObject<HTMLElement | null>
	/** The content that gets pinned during scroll */
	pinnedContentRef: RefObject<HTMLDivElement | null>
	/** Logo element that morphs from center to nav */
	logoRef: RefObject<HTMLHeadingElement | null>
	/** Headline element that morphs from center to left */
	headlineRef: RefObject<HTMLHeadingElement | null>
	/** Background container that shrinks */
	backgroundRef: RefObject<HTMLDivElement | null>
	/** Inner background wrapper that counter-scales (to avoid squash) */
	backgroundInnerRef: RefObject<HTMLDivElement | null>
	/** Right panel that reveals with clip-path */
	panelRef: RefObject<HTMLDivElement | null>
	/** Curtain overlay for panel reveal */
	panelCurtainRef: RefObject<HTMLDivElement | null>
	/** CTA container */
	ctaRef: RefObject<HTMLDivElement | null>
	/** Subtext container */
	subtextRef: RefObject<HTMLParagraphElement | null>
	/** Nav button (mobile) */
	navBtnRef: RefObject<HTMLButtonElement | null>
	/** Scroll indicator */
	scrollIndicatorRef: RefObject<HTMLDivElement | null>
}

export interface HeroAnimationOptions {
	/** Whether the background is ready (delays animation start) */
	isBackgroundReady: boolean
	/** Callback when animation reaches end (for hasRevealed state) */
	onRevealComplete?: () => void
	/** Callback when animation leaves end */
	onRevealReverse?: () => void
}

export interface HeroAnimationReturn {
	/** Current scroll progress (0-1), updated during scroll */
	progress: number
}

/**
 * Measures the morph positions for logo and headline
 * Returns the transform values needed to move from center to final position
 */
function measureMorphPositions(
	logoEl: HTMLElement,
	headlineEl: HTMLElement
): {
	logo: { startX: number; startY: number; startScale: number }
	headline: { startX: number; startY: number; startScale: number }
} {
	const rootFontSize = Number.parseFloat(
		getComputedStyle(document.documentElement).fontSize
	)
	const rem = Number.isFinite(rootFontSize) && rootFontSize > 0 ? rootFontSize : 16

	// Temporarily disable transforms to measure final positions
	const elements = [logoEl, headlineEl]
	const originalStyles = elements.map(el => ({
		transform: el.style.transform,
		fontSize: el.style.fontSize,
	}))

	// Reset to final state for measurement
	elements.forEach(el => {
		el.style.transform = 'none'
		el.style.fontSize = ''
	})

	// Force reflow to ensure measurements are accurate
	void logoEl.offsetHeight

	const logoRect = logoEl.getBoundingClientRect()
	const headlineRect = headlineEl.getBoundingClientRect()
	const logoFinalFontSizePx = Number.parseFloat(getComputedStyle(logoEl).fontSize)
	const headlineFinalFontSizePx = Number.parseFloat(getComputedStyle(headlineEl).fontSize)

	// Restore original styles
	elements.forEach((el, i) => {
		el.style.transform = originalStyles[i].transform
		el.style.fontSize = originalStyles[i].fontSize
	})

	// Calculate start positions (centered in viewport)
	const viewportCenterX = window.innerWidth / 2
	const viewportCenterY = window.innerHeight / 2

	// Scale from the element's final rendered size to the desired start sizes.
	const logoFinalCenterX = logoRect.left + logoRect.width / 2
	const logoFinalCenterY = logoRect.top + logoRect.height / 2
	const safeLogoFinalPx =
		Number.isFinite(logoFinalFontSizePx) && logoFinalFontSizePx > 0 ?
			logoFinalFontSizePx
		:	1.5 * rem
	const logoStartScale = (5.25 * rem) / safeLogoFinalPx

	const headlineFinalCenterX = headlineRect.left + headlineRect.width / 2
	const headlineFinalCenterY = headlineRect.top + headlineRect.height / 2
	const safeHeadlineFinalPx =
		Number.isFinite(headlineFinalFontSizePx) && headlineFinalFontSizePx > 0 ?
			headlineFinalFontSizePx
		:	3.75 * rem
	const headlineStartScale = (1.75 * rem) / safeHeadlineFinalPx

	// Place the logo + headline as a vertically centered stack at the start.
	// This prevents overlap regardless of viewport size / font metrics.
	const logoStartHeight = logoRect.height * logoStartScale
	const headlineStartHeight = headlineRect.height * headlineStartScale
	const stackGap = 0.75 * rem
	const stackHeight = logoStartHeight + stackGap + headlineStartHeight
	const stackTopY = viewportCenterY - stackHeight / 2
	const logoStartCenterY = stackTopY + logoStartHeight / 2
	const headlineStartCenterY =
		stackTopY + logoStartHeight + stackGap + headlineStartHeight / 2

	return {
		logo: {
			startX: viewportCenterX - logoFinalCenterX,
			startY: logoStartCenterY - logoFinalCenterY,
			startScale: logoStartScale,
		},
		headline: {
			startX: viewportCenterX - headlineFinalCenterX,
			startY: headlineStartCenterY - headlineFinalCenterY,
			startScale: headlineStartScale,
		},
	}
}

export function useHeroAnimation(
	refs: HeroAnimationRefs,
	options: HeroAnimationOptions
): HeroAnimationReturn {
	const { isBackgroundReady, onRevealComplete, onRevealReverse } = options

	useGSAP(
		() => {
			// SSR safety
			if (typeof window === 'undefined') return

			// Wait for background to be ready before starting scroll-driven animation.
			// This prevents the timeline from running while WebGL/canvas is still initializing,
			// which would cause elements to animate "under" an invisible initial state.
			if (!isBackgroundReady) return

			const {
				sectionRef,
				pinnedContentRef,
				logoRef,
				headlineRef,
				backgroundRef,
				backgroundInnerRef,
				panelRef,
				panelCurtainRef,
				ctaRef,
				subtextRef,
				navBtnRef,
				scrollIndicatorRef,
			} = refs

			// Verify all required refs
			if (
				!sectionRef.current ||
				!pinnedContentRef.current ||
				!logoRef.current ||
				!headlineRef.current
			) {
				return
			}

			// Check for reduced motion preference
			const prefersReducedMotion = window.matchMedia(
				'(prefers-reduced-motion: reduce)'
			).matches
			if (prefersReducedMotion) {
				// Show final state immediately
				if (logoRef.current) gsap.set(logoRef.current, { clearProps: 'all' })
				if (headlineRef.current)
					gsap.set(headlineRef.current, {
						maxWidth: '28rem',
						justifyContent: 'flex-start',
						whiteSpace: 'normal',
						flexWrap: 'wrap',
					})
				if (backgroundRef.current)
					gsap.set(backgroundRef.current, { scaleX: 0.5, transformOrigin: 'left center' })
				if (backgroundInnerRef.current)
					gsap.set(backgroundInnerRef.current, {
						scaleX: 2,
						transformOrigin: 'left center',
					})
				if (panelRef.current) gsap.set(panelRef.current, { opacity: 1 })
				if (panelCurtainRef.current) gsap.set(panelCurtainRef.current, { x: '100%' })
				if (ctaRef.current) gsap.set(ctaRef.current, { opacity: 1, y: 0 })
				if (subtextRef.current) gsap.set(subtextRef.current, { opacity: 1, y: 0 })
				if (navBtnRef.current) gsap.set(navBtnRef.current, { opacity: 1 })
				if (scrollIndicatorRef.current)
					gsap.set(scrollIndicatorRef.current, { opacity: 0 })
				onRevealComplete?.()
				return
			}

			// Match previous behavior: no scroll-driven hero on mobile.
			const isDesktop = window.matchMedia('(min-width: 1024px)').matches
			if (!isDesktop) return

			ScrollTrigger.config({ ignoreMobileResize: true })

			const scrollerEl =
				(sectionRef.current.closest(
					'[data-landing-scroll-root]'
				) as HTMLElement | null) ??
				(document.querySelector('[data-landing-scroll-root]') as HTMLElement | null)
			// Use getComputedStyle to capture the actual applied value (not just inline styles).
			// This ensures we restore scroll-snap even if it's set via CSS classes.
			const previousScrollSnapType =
				scrollerEl ? getComputedStyle(scrollerEl).scrollSnapType : ''
			let restoreSnapTimeout: number | null = null
			let isRestoreTrackingActive = false
			let isAlive = true // Flag to prevent callbacks after unmount
			const clearRestoreTracking = () => {
				if (!scrollerEl) return
				if (restoreSnapTimeout !== null) {
					window.clearTimeout(restoreSnapTimeout)
					restoreSnapTimeout = null
				}
				if (isRestoreTrackingActive) {
					scrollerEl.removeEventListener('scroll', scheduleRestoreFromScroll)
					isRestoreTrackingActive = false
				}
			}
			const doRestoreScrollSnap = () => {
				if (!scrollerEl) return
				if (previousScrollSnapType) {
					scrollerEl.style.scrollSnapType = previousScrollSnapType
					return
				}
				scrollerEl.style.scrollSnapType = ''
			}
			const disableScrollSnap = () => {
				if (!scrollerEl) return
				clearRestoreTracking()
				scrollerEl.style.scrollSnapType = 'none'
			}
			function scheduleRestoreFromScroll() {
				if (restoreSnapTimeout !== null) window.clearTimeout(restoreSnapTimeout)
				restoreSnapTimeout = window.setTimeout(() => {
					clearRestoreTracking()
					doRestoreScrollSnap()
				}, SCROLL_SNAP_RESTORE_DELAY_MS)
			}
			const requestRestoreScrollSnap = () => {
				if (!scrollerEl) return
				if (!isRestoreTrackingActive) {
					scrollerEl.addEventListener('scroll', scheduleRestoreFromScroll, {
						passive: true,
					})
					isRestoreTrackingActive = true
				}
				scheduleRestoreFromScroll()
			}

			let morphPositions = measureMorphPositions(logoRef.current, headlineRef.current)
			const recalcMorphPositions = () => {
				// Guard against callback firing after refs are cleared during unmount
				if (!logoRef.current || !headlineRef.current) return
				morphPositions = measureMorphPositions(logoRef.current, headlineRef.current)
			}

			ScrollTrigger.addEventListener('refreshInit', recalcMorphPositions)

			// Flexbox headline: start with nowrap (guarantees single line) + centered
			gsap.set(headlineRef.current, {
				maxWidth: 'none',
				justifyContent: 'center',
				whiteSpace: 'nowrap', // Prevent text wrap within spans
			})

			if (backgroundRef.current) {
				gsap.set(backgroundRef.current, { scaleX: 1, transformOrigin: 'left center' })
			}
			if (backgroundInnerRef.current) {
				gsap.set(backgroundInnerRef.current, {
					scaleX: 1,
					transformOrigin: 'left center',
				})
			}

			if (panelRef.current) {
				gsap.set(panelRef.current, { opacity: 0, y: 12, scale: 0.985 })
			}
			if (panelCurtainRef.current) {
				gsap.set(panelCurtainRef.current, { x: '0%', transformOrigin: 'left center' })
			}

			if (ctaRef.current) {
				gsap.set(ctaRef.current, { opacity: 0, y: 10 })
			}

			if (subtextRef.current) {
				gsap.set(subtextRef.current, { opacity: 0, y: 10 })
			}

			if (navBtnRef.current) {
				gsap.set(navBtnRef.current, { opacity: 0 })
			}

			const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
			const getAnimationProgressFromScroll = (scrollProgress: number) => {
				if (scrollProgress <= ANIMATION_START_POINT) return 0
				if (scrollProgress >= ANIMATION_END_POINT) return 1
				return clamp01(
					(scrollProgress - ANIMATION_START_POINT) /
						(ANIMATION_END_POINT - ANIMATION_START_POINT)
				)
			}

			let autoScrollTween: gsap.core.Tween | null = null
			let isAutoScrolling = false
			let hasAutoCompleted = false
			let autoCompletionDisabled = false
			let st: ScrollTrigger | null = null

			const cancelAutoScroll = () => {
				if (autoScrollTween) {
					autoScrollTween.kill()
					autoScrollTween = null
				}
				if (isAutoScrolling) {
					isAutoScrolling = false
					autoCompletionDisabled = true
				}
			}

			const handleKeyDown = (ev: KeyboardEvent) => {
				if (
					ev.key === 'ArrowDown' ||
					ev.key === 'ArrowUp' ||
					ev.key === 'PageDown' ||
					ev.key === 'PageUp' ||
					ev.key === 'Home' ||
					ev.key === 'End' ||
					ev.key === ' ' ||
					ev.key === 'Spacebar'
				) {
					cancelAutoScroll()
				}
			}

			const handleWheel = (ev: WheelEvent) => {
				if (!isAutoScrolling) return
				if (ev.deltaY < 0) {
					cancelAutoScroll()
				}
			}

			const startAutoScroll = () => {
				if (!scrollerEl || !st) return
				if (autoScrollTween) {
					autoScrollTween.kill()
					autoScrollTween = null
				}
				isAutoScrolling = true
				autoCompletionDisabled = false
				const targetScrollTop = st.start + (st.end - st.start) * ANIMATION_END_POINT
				autoScrollTween = gsap.to(scrollerEl, {
					scrollTop: targetScrollTop,
					duration: AUTO_COMPLETE_DURATION_S,
					ease: 'power2.out',
					onUpdate: () => {
						st?.update()
					},
					onComplete: () => {
						isAutoScrolling = false
						hasAutoCompleted = true
						autoScrollTween = null
					},
				})
			}

			let lastAnimationProgress = 0

			// Create the main timeline (progress 0..1). ScrollTrigger drives it with a start hold + end deadzone.
			const tl = gsap.timeline({ paused: true })
			const setTimelineProgress = gsap.quickTo(tl, 'progress', {
				duration: 0.15,
				ease: 'power2.out',
			})

			// Phase 1: Scroll indicator fade out (0% - 8%)
			// Use fromTo() to ensure starting opacity is 1, regardless of CSS transition timing
			if (scrollIndicatorRef.current) {
				tl.fromTo(
					scrollIndicatorRef.current,
					{ opacity: 1 },
					{
						opacity: 0,
						duration: 0.08,
						ease: 'none',
					},
					0
				)
			}
			if (backgroundInnerRef.current) {
				tl.to(
					backgroundInnerRef.current,
					{
						scaleX: 2,
						duration: 0.65,
						ease: 'none',
					},
					0
				)
			}

			// Phase 2: Logo morph (0% - 65%)
			tl.fromTo(
				logoRef.current,
				{
					x: () => morphPositions.logo.startX,
					y: () => morphPositions.logo.startY,
					scale: () => morphPositions.logo.startScale,
					transformOrigin: 'center center',
				},
				{
					x: 0,
					y: 0,
					scale: 1,
					duration: 0.65,
					ease: 'none',
					immediateRender: true,
				},
				0
			)

			// Phase 2: Headline morph (0% - 65%)
			tl.fromTo(
				headlineRef.current,
				{
					x: () => morphPositions.headline.startX,
					y: () => morphPositions.headline.startY,
					scale: () => morphPositions.headline.startScale,
					transformOrigin: 'center center',
				},
				{
					x: 0,
					y: 0,
					scale: 1,
					duration: 0.65,
					ease: 'none',
					immediateRender: true,
				},
				0
			)

			// Headline: animate justifyContent from center to flex-start
			tl.to(
				headlineRef.current,
				{
					justifyContent: 'flex-start',
					duration: 0.65,
					ease: 'none',
				},
				0
			)

			// At 0.55: enable wrapping + set narrow maxWidth to trigger flex wrap
			tl.set(
				headlineRef.current,
				{
					whiteSpace: 'normal',
					flexWrap: 'wrap',
					maxWidth: '28rem', // Forces the flex wrap between spans
				},
				0.55
			)

			// Phase 2: Background shrink (0% - 65%)
			if (backgroundRef.current) {
				tl.to(
					backgroundRef.current,
					{
						scaleX: 0.5,
						duration: 0.65,
						ease: 'none',
					},
					0
				)
			}

			// Phase 3: Nav button fade in (40% - 65%)
			if (navBtnRef.current) {
				tl.to(
					navBtnRef.current,
					{
						opacity: 1,
						duration: 0.25,
						ease: 'none',
					},
					0.4
				)
			}

			// Phase 4: Panel reveal with curtain (60% - 100%)
			if (panelRef.current) {
				tl.to(
					panelRef.current,
					{
						opacity: 1,
						y: 0,
						scale: 1,
						duration: 0.4,
						ease: 'none',
					},
					0.6
				)
			}
			if (panelCurtainRef.current) {
				tl.to(
					panelCurtainRef.current,
					{
						x: '100%',
						duration: 0.4,
						ease: 'none',
					},
					0.6
				)
			}

			// Phase 5: Subtext fade in (80% - 100%)
			if (subtextRef.current) {
				tl.to(
					subtextRef.current,
					{
						opacity: 1,
						y: 0,
						duration: 0.2,
						ease: 'none',
					},
					0.8
				)
			}

			// Phase 5: CTA fade in (85% - 100%)
			if (ctaRef.current) {
				tl.to(
					ctaRef.current,
					{
						opacity: 1,
						y: 0,
						duration: 0.15,
						ease: 'none',
					},
					0.85
				)
			}

			// Ensure the initial state is applied before any scroll events.
			tl.progress(0)

			const invalidateTimeline = () => {
				tl.invalidate()
				tl.progress(lastAnimationProgress)
			}
			ScrollTrigger.addEventListener('refreshInit', invalidateTimeline)

			st = ScrollTrigger.create({
				trigger: sectionRef.current,
				scroller: scrollerEl ?? undefined,
				start: 'top top',
				end: 'bottom bottom',
				invalidateOnRefresh: true,
				onEnter: disableScrollSnap,
				onEnterBack: disableScrollSnap,
				onLeave: requestRestoreScrollSnap,
				onUpdate: self => {
					if (self.progress < AUTO_COMPLETE_RESET_POINT) {
						hasAutoCompleted = false
						autoCompletionDisabled = false
					}
					const velocity = self.getVelocity()
					if (
						!hasAutoCompleted &&
						!autoCompletionDisabled &&
						!isAutoScrolling &&
						self.direction === 1 &&
						self.progress >= AUTO_COMPLETE_MIN_PROGRESS &&
						self.progress < ANIMATION_END_POINT
					) {
						if (velocity > AUTO_COMPLETE_TRIGGER_VELOCITY_PX_PER_S) {
							startAutoScroll()
						}
					}
					const animationProgress = getAnimationProgressFromScroll(self.progress)
					lastAnimationProgress = animationProgress
					setTimelineProgress(animationProgress)
					if (animationProgress >= 0.85) {
						onRevealComplete?.()
					}
				},
				onLeaveBack: () => {
					requestRestoreScrollSnap()
					onRevealReverse?.()
				},
			})

			if (scrollerEl) {
				scrollerEl.addEventListener('wheel', handleWheel, { passive: true })
				scrollerEl.addEventListener('touchstart', cancelAutoScroll, { passive: true })
			}
			window.addEventListener('keydown', handleKeyDown)

			// Handle resize - recalculate morph positions
			const handleResize = () => {
				if (!logoRef.current || !headlineRef.current) return
				// ScrollTrigger.refresh() recalculates all positions and invalidates the timeline
				ScrollTrigger.refresh()
			}

			// Handle font load - fonts can shift layout
			const handleFontLoad = () => {
				// Guard against promise resolving after unmount
				if (!isAlive || !logoRef.current || !headlineRef.current) return
				ScrollTrigger.refresh()
			}

			window.addEventListener('resize', handleResize)
			document.fonts?.ready.then(handleFontLoad)

			// Cleanup is handled automatically by useGSAP context
			return () => {
				isAlive = false // Prevent font-load callback from running after unmount
				window.removeEventListener('resize', handleResize)
				ScrollTrigger.removeEventListener('refreshInit', recalcMorphPositions)
				ScrollTrigger.removeEventListener('refreshInit', invalidateTimeline)
				if (scrollerEl) {
					scrollerEl.removeEventListener('wheel', handleWheel)
					scrollerEl.removeEventListener('touchstart', cancelAutoScroll)
				}
				window.removeEventListener('keydown', handleKeyDown)
				if (autoScrollTween) {
					autoScrollTween.kill()
				}
				st?.kill()
				clearRestoreTracking()
				doRestoreScrollSnap()
			}
		},
		{
			dependencies: [isBackgroundReady],
			revertOnUpdate: true, // Revert when dependencies change
		}
	)

	return {
		progress: 0, // Progress tracking could be added if needed
	}
}
