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
 * - 0.00–0.65: Background shrink (100vw → 50% via clip-path)
 * - 0.40–0.65: Nav button fade in
 * - 0.60–1.00: Right panel reveal (clip-path wipe)
 * - 0.80–1.00: Subtext fade in
 * - 0.85–1.00: CTA fade in
 */

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { RefObject } from "react";

// Register plugins once at module level
if (typeof window !== "undefined") {
	gsap.registerPlugin(ScrollTrigger);
}

/** Debounce delay (ms) for restoring scroll-snap after scroll activity stops */
const SCROLL_SNAP_RESTORE_DELAY_MS = 220;

/**
 * Timeline compression factor - animations complete at this % of total scroll.
 * The remaining scroll is a "lock zone" where the page stays in final state.
 *
 * Example: 0.80 means animations finish at 80% scroll, leaving 20% dead zone.
 * Set to 1.0 to disable the lock zone.
 */
const ANIMATION_END_POINT = 0.8;

const ANIMATION_START_POINT = 0.05;

const AUTO_COMPLETE_TRIGGER_VELOCITY_PX_PER_S = 1400;
const AUTO_COMPLETE_MIN_PROGRESS = 0.08;
const AUTO_COMPLETE_RESET_POINT = 0.04;
const AUTO_COMPLETE_DURATION_S = 1.2;

export interface HeroAnimationRefs {
	/** The hero section container (trigger element) */
	sectionRef: RefObject<HTMLElement | null>;
	/** The content that gets pinned during scroll */
	pinnedContentRef: RefObject<HTMLDivElement | null>;
	/** Logo element that morphs from center to nav */
	logoRef: RefObject<HTMLHeadingElement | null>;
	/** Headline element that morphs from center to left */
	headlineRef: RefObject<HTMLHeadingElement | null>;
	/** Background container that shrinks via clip-path */
	backgroundRef: RefObject<HTMLDivElement | null>;
	/** Right panel that reveals with clip-path */
	panelRef: RefObject<HTMLDivElement | null>;
	/** Curtain overlay for panel reveal */
	panelCurtainRef: RefObject<HTMLDivElement | null>;
	/** CTA container */
	ctaRef: RefObject<HTMLDivElement | null>;
	/** Subtext container */
	subtextRef: RefObject<HTMLParagraphElement | null>;
	/** Animated heart in logo — fades in with subtext */
	heartRef: RefObject<HTMLSpanElement | null>;
	/** Nav button (mobile) */
	navBtnRef: RefObject<HTMLButtonElement | null>;
	/** Scroll indicator */
	scrollIndicatorRef: RefObject<HTMLDivElement | null>;
	/** Invisible marker at logo's start position */
	logoMarkerRef: RefObject<HTMLDivElement | null>;
	/** Invisible marker at headline's start position */
	headlineMarkerRef: RefObject<HTMLDivElement | null>;
}

export interface HeroAnimationOptions {
	/** Whether the background is ready (retained for API compatibility) */
	isBackgroundReady?: boolean;
	/** Callback when the initial visual state has been applied */
	onInitialStateApplied?: () => void;
	/** Callback when animation reaches end (for hasRevealed state) */
	onRevealComplete?: () => void;
	/** Callback when animation leaves end */
	onRevealReverse?: () => void;
}

export interface HeroAnimationReturn {
	/** Current scroll progress (0-1), updated during scroll */
	progress: number;
}

interface MorphDeltas {
	logo: { dx: number; dy: number; scale: number };
	headline: { dx: number; dy: number; scale: number };
}

/**
 * Computes morph deltas by comparing marker positions to element positions.
 * Markers sit at the "start" position in the DOM (centered, large logo / small headline).
 * Elements sit at the "end" position (nav slot / left column).
 *
 * IMPORTANT: Elements must be in their natural CSS state (no GSAP transforms,
 * headline in initial text layout: nowrap / maxWidth:none) when this is called.
 */
function computeMorphDeltas(
	logoEl: HTMLElement,
	headlineEl: HTMLElement,
	logoMarkerEl: HTMLElement,
	headlineMarkerEl: HTMLElement,
): MorphDeltas {
	const logoRect = logoEl.getBoundingClientRect();
	const headlineRect = headlineEl.getBoundingClientRect();
	const logoMarkerRect = logoMarkerEl.getBoundingClientRect();
	const headlineMarkerRect = headlineMarkerEl.getBoundingClientRect();

	// Uniform scale from font-size ratio — preserves text aspect ratio
	const logoFontSize =
		Number.parseFloat(getComputedStyle(logoEl).fontSize) || 1;
	const logoMarkerFontSize =
		Number.parseFloat(getComputedStyle(logoMarkerEl).fontSize) || 1;
	const headlineFontSize =
		Number.parseFloat(getComputedStyle(headlineEl).fontSize) || 1;
	const headlineMarkerFontSize =
		Number.parseFloat(getComputedStyle(headlineMarkerEl).fontSize) || 1;

	const logoCenterX = logoRect.left + logoRect.width / 2;
	const logoCenterY = logoRect.top + logoRect.height / 2;
	const logoMarkerCenterX = logoMarkerRect.left + logoMarkerRect.width / 2;
	const logoMarkerCenterY = logoMarkerRect.top + logoMarkerRect.height / 2;

	const headlineCenterX = headlineRect.left + headlineRect.width / 2;
	const headlineCenterY = headlineRect.top + headlineRect.height / 2;
	const headlineMarkerCenterX =
		headlineMarkerRect.left + headlineMarkerRect.width / 2;
	const headlineMarkerCenterY =
		headlineMarkerRect.top + headlineMarkerRect.height / 2;

	return {
		logo: {
			dx: logoMarkerCenterX - logoCenterX,
			dy: logoMarkerCenterY - logoCenterY,
			scale: logoMarkerFontSize / logoFontSize,
		},
		headline: {
			dx: headlineMarkerCenterX - headlineCenterX,
			dy: headlineMarkerCenterY - headlineCenterY,
			scale: headlineMarkerFontSize / headlineFontSize,
		},
	};
}

export function useHeroAnimation(
	refs: HeroAnimationRefs,
	options: HeroAnimationOptions,
): HeroAnimationReturn {
	const { onInitialStateApplied, onRevealComplete, onRevealReverse } = options;

	// Once-guard so onInitialStateApplied only fires on initial mount
	const initialStateAppliedRef = { current: false };

	useGSAP(
		() => {
			if (typeof window === "undefined") return;

			const {
				sectionRef,
				pinnedContentRef,
				logoRef,
				headlineRef,
				backgroundRef,
				panelRef,
				panelCurtainRef,
				ctaRef,
				subtextRef,
				heartRef,
				navBtnRef,
				scrollIndicatorRef,
				logoMarkerRef,
				headlineMarkerRef,
			} = refs;

			if (
				!sectionRef.current ||
				!pinnedContentRef.current ||
				!logoRef.current ||
				!headlineRef.current
			) {
				return;
			}

			const fireInitialStateApplied = () => {
				if (!initialStateAppliedRef.current) {
					initialStateAppliedRef.current = true;
					onInitialStateApplied?.();
				}
			};

			const applyDesktopStaticState = () => {
				gsap.set(logoRef.current, {
					clearProps: "x,y,scale,transformOrigin",
				});
				gsap.set(headlineRef.current, {
					clearProps: "x,y,scale,transformOrigin,fontSize",
					maxWidth: "var(--hero-copy-max-width)",
					justifyContent: "flex-start",
					whiteSpace: "normal",
					flexWrap: "wrap",
				});
				if (backgroundRef.current)
					gsap.set(backgroundRef.current, {
						clipPath: "inset(0 50% 0 0)",
					});
				if (panelRef.current)
					gsap.set(panelRef.current, { opacity: 1, y: 0, scale: 1 });
				if (panelCurtainRef.current)
					gsap.set(panelCurtainRef.current, {
						x: "100%",
						transformOrigin: "left center",
					});
				if (ctaRef.current) gsap.set(ctaRef.current, { opacity: 1, y: 0 });
				if (subtextRef.current)
					gsap.set(subtextRef.current, { opacity: 1, y: 0 });
				if (heartRef.current)
					gsap.set(heartRef.current, {
						width: "1.25rem",
						minWidth: "1.25rem",
						opacity: 1,
					});
				if (navBtnRef.current)
					gsap.set(navBtnRef.current, { clearProps: "opacity" });
				if (scrollIndicatorRef.current)
					gsap.set(scrollIndicatorRef.current, { opacity: 0 });
				fireInitialStateApplied();
				onRevealComplete?.();
			};

			const applyNarrowStaticState = () => {
				gsap.set(logoRef.current, {
					clearProps: "x,y,scale,transformOrigin",
				});
				gsap.set(headlineRef.current, {
					clearProps: "x,y,scale,transformOrigin,fontSize",
					maxWidth: "none",
					justifyContent: "flex-start",
					whiteSpace: "normal",
					flexWrap: "wrap",
				});
				if (backgroundRef.current)
					gsap.set(backgroundRef.current, {
						clipPath: "none",
					});
				if (panelRef.current)
					gsap.set(panelRef.current, { opacity: 1, y: 0, scale: 1 });
				if (panelCurtainRef.current)
					gsap.set(panelCurtainRef.current, {
						x: "100%",
						transformOrigin: "left center",
					});
				if (ctaRef.current) gsap.set(ctaRef.current, { opacity: 1, y: 0 });
				if (subtextRef.current)
					gsap.set(subtextRef.current, { opacity: 1, y: 0 });
				if (heartRef.current)
					gsap.set(heartRef.current, {
						width: "1.25rem",
						minWidth: "1.25rem",
						opacity: 1,
					});
				if (navBtnRef.current)
					gsap.set(navBtnRef.current, { clearProps: "opacity" });
				if (scrollIndicatorRef.current)
					gsap.set(scrollIndicatorRef.current, { opacity: 0 });
				fireInitialStateApplied();
				onRevealComplete?.();
			};

			// ─────────────────────────────────────────────────────────────
			// gsap.matchMedia() handles breakpoint + reduced-motion routing
			// ─────────────────────────────────────────────────────────────
			const mm = gsap.matchMedia();

			mm.add("(min-width: 1280px) and (prefers-reduced-motion: reduce)", () => {
				applyDesktopStaticState();
			});

			mm.add("(max-width: 1279px)", () => {
				applyNarrowStaticState();
			});

			mm.add(
				"(min-width: 1280px) and (prefers-reduced-motion: no-preference)",
				() => {
					// ─── Full desktop animation ───────────────────────────

					ScrollTrigger.config({ ignoreMobileResize: true });

					const scrollerEl =
						(sectionRef.current!.closest(
							"[data-landing-scroll-root]",
						) as HTMLElement | null) ??
						(document.querySelector(
							"[data-landing-scroll-root]",
						) as HTMLElement | null);

					const previousScrollSnapType = scrollerEl
						? getComputedStyle(scrollerEl).scrollSnapType
						: "";
					let restoreSnapTimeout: number | null = null;
					let isRestoreTrackingActive = false;
					let isAlive = true;
					const clearRestoreTracking = () => {
						if (!scrollerEl) return;
						if (restoreSnapTimeout !== null) {
							window.clearTimeout(restoreSnapTimeout);
							restoreSnapTimeout = null;
						}
						if (isRestoreTrackingActive) {
							scrollerEl.removeEventListener(
								"scroll",
								scheduleRestoreFromScroll,
							);
							isRestoreTrackingActive = false;
						}
					};
					const doRestoreScrollSnap = () => {
						if (!scrollerEl) return;
						if (previousScrollSnapType) {
							scrollerEl.style.scrollSnapType = previousScrollSnapType;
							return;
						}
						scrollerEl.style.scrollSnapType = "";
					};
					const disableScrollSnap = () => {
						if (!scrollerEl) return;
						clearRestoreTracking();
						scrollerEl.style.scrollSnapType = "none";
					};
					function scheduleRestoreFromScroll() {
						if (restoreSnapTimeout !== null)
							window.clearTimeout(restoreSnapTimeout);
						restoreSnapTimeout = window.setTimeout(() => {
							clearRestoreTracking();
							doRestoreScrollSnap();
						}, SCROLL_SNAP_RESTORE_DELAY_MS);
					}
					const requestRestoreScrollSnap = () => {
						if (!scrollerEl) return;
						if (!isRestoreTrackingActive) {
							scrollerEl.addEventListener("scroll", scheduleRestoreFromScroll, {
								passive: true,
							});
							isRestoreTrackingActive = true;
						}
						scheduleRestoreFromScroll();
					};

					// ─── Initial state (must come BEFORE measurement) ────
					gsap.set(headlineRef.current, {
						maxWidth: "none",
						justifyContent: "center",
						whiteSpace: "nowrap",
					});

					// Force reflow so measurement reflects the new layout
					void logoRef.current!.offsetHeight;

					// ─── Marker-based measurement ─────────────────────────
					let deltas = computeMorphDeltas(
						logoRef.current!,
						headlineRef.current!,
						logoMarkerRef.current!,
						headlineMarkerRef.current!,
					);

					if (backgroundRef.current) {
						gsap.set(backgroundRef.current, {
							clipPath: "inset(0 0% 0 0)",
						});
					}

					if (panelRef.current) {
						gsap.set(panelRef.current, { opacity: 0, y: 12, scale: 0.985 });
					}
					if (panelCurtainRef.current) {
						gsap.set(panelCurtainRef.current, {
							x: "0%",
							transformOrigin: "left center",
						});
					}

					if (ctaRef.current) {
						gsap.set(ctaRef.current, { opacity: 0, y: 10 });
					}

					if (subtextRef.current) {
						gsap.set(subtextRef.current, { opacity: 0, y: 10 });
					}

					if (heartRef.current) {
						gsap.set(heartRef.current, {
							width: 0,
							minWidth: 0,
							opacity: 0,
						});
					}

					if (navBtnRef.current) {
						gsap.set(navBtnRef.current, { opacity: 0 });
					}

					const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
					const getAnimationProgressFromScroll = (scrollProgress: number) => {
						if (scrollProgress <= ANIMATION_START_POINT) return 0;
						if (scrollProgress >= ANIMATION_END_POINT) return 1;
						return clamp01(
							(scrollProgress - ANIMATION_START_POINT) /
								(ANIMATION_END_POINT - ANIMATION_START_POINT),
						);
					};

					let autoScrollTween: gsap.core.Tween | null = null;
					let isAutoScrolling = false;
					let hasAutoCompleted = false;
					let autoCompletionDisabled = false;
					let st: ScrollTrigger | null = null;

					const cancelAutoScroll = () => {
						if (autoScrollTween) {
							autoScrollTween.kill();
							autoScrollTween = null;
						}
						if (isAutoScrolling) {
							isAutoScrolling = false;
							autoCompletionDisabled = true;
						}
					};

					const handleKeyDown = (ev: KeyboardEvent) => {
						if (
							ev.key === "ArrowDown" ||
							ev.key === "ArrowUp" ||
							ev.key === "PageDown" ||
							ev.key === "PageUp" ||
							ev.key === "Home" ||
							ev.key === "End" ||
							ev.key === " " ||
							ev.key === "Spacebar"
						) {
							cancelAutoScroll();
						}
					};

					const handleWheel = (ev: WheelEvent) => {
						if (!isAutoScrolling) return;
						if (ev.deltaY < 0) {
							cancelAutoScroll();
						}
					};

					const startAutoScroll = () => {
						if (!scrollerEl || !st) return;
						if (autoScrollTween) {
							autoScrollTween.kill();
							autoScrollTween = null;
						}
						isAutoScrolling = true;
						autoCompletionDisabled = false;
						const targetScrollTop =
							st.start + (st.end - st.start) * ANIMATION_END_POINT;
						autoScrollTween = gsap.to(scrollerEl, {
							scrollTop: targetScrollTop,
							duration: AUTO_COMPLETE_DURATION_S,
							ease: "power2.out",
							onUpdate: () => {
								st?.update();
							},
							onComplete: () => {
								isAutoScrolling = false;
								hasAutoCompleted = true;
								autoScrollTween = null;
							},
						});
					};

					let lastAnimationProgress = 0;

					// ─── Timeline ─────────────────────────────────────────
					const tl = gsap.timeline({ paused: true });
					const setTimelineProgress = gsap.quickTo(tl, "progress", {
						duration: 0.15,
						ease: "power2.out",
					});

					// Phase 1: Scroll indicator fade out (0% - 8%)
					if (scrollIndicatorRef.current) {
						tl.fromTo(
							scrollIndicatorRef.current,
							{ opacity: 1 },
							{
								opacity: 0,
								duration: 0.08,
								ease: "none",
							},
							0,
						);
					}

					// Phase 2: Logo morph (0% - 65%) — function-based from values for resize rebuild
					tl.fromTo(
						logoRef.current,
						{
							x: () => deltas.logo.dx,
							y: () => deltas.logo.dy,
							scale: () => deltas.logo.scale,
							transformOrigin: "center center",
						},
						{
							x: 0,
							y: 0,
							scale: 1,
							duration: 0.65,
							ease: "none",
							immediateRender: true,
						},
						0,
					);

					// Phase 2: Headline morph (0% - 65%)
					tl.fromTo(
						headlineRef.current,
						{
							x: () => deltas.headline.dx,
							y: () => deltas.headline.dy,
							scale: () => deltas.headline.scale,
							transformOrigin: "center center",
						},
						{
							x: 0,
							y: 0,
							scale: 1,
							duration: 0.65,
							ease: "none",
							immediateRender: true,
						},
						0,
					);

					// Headline: animate justifyContent from center to flex-start
					tl.to(
						headlineRef.current,
						{
							justifyContent: "flex-start",
							duration: 0.65,
							ease: "none",
						},
						0,
					);

					// At 0.55: enable wrapping + set narrow maxWidth to trigger flex wrap
					tl.set(
						headlineRef.current,
						{
							whiteSpace: "normal",
							flexWrap: "wrap",
							maxWidth: "var(--hero-copy-max-width)",
						},
						0.55,
					);

					// Phase 2: Background shrink via clip-path (0% - 65%)
					if (backgroundRef.current) {
						tl.fromTo(
							backgroundRef.current,
							{ clipPath: "inset(0 0% 0 0)" },
							{
								clipPath: "inset(0 50% 0 0)",
								duration: 0.65,
								ease: "none",
							},
							0,
						);
					}

					// Phase 3: Nav button fade in (40% - 65%)
					if (navBtnRef.current) {
						tl.to(
							navBtnRef.current,
							{
								opacity: 1,
								duration: 0.25,
								ease: "none",
							},
							0.4,
						);
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
								ease: "none",
							},
							0.6,
						);
					}
					if (panelCurtainRef.current) {
						tl.to(
							panelCurtainRef.current,
							{
								x: "100%",
								duration: 0.4,
								ease: "none",
							},
							0.6,
						);
					}

					// Phase 5: Subtext + heart fade in (80% - 100%)
					if (subtextRef.current) {
						tl.to(
							subtextRef.current,
							{
								opacity: 1,
								y: 0,
								duration: 0.2,
								ease: "none",
							},
							0.8,
						);
					}

					if (heartRef.current) {
						tl.to(
							heartRef.current,
							{
								width: "1.25rem",
								opacity: 1,
								duration: 0.2,
								ease: "none",
							},
							0.8,
						);
					}

					// Phase 5: CTA fade in (85% - 100%)
					if (ctaRef.current) {
						tl.to(
							ctaRef.current,
							{
								opacity: 1,
								y: 0,
								duration: 0.15,
								ease: "none",
							},
							0.85,
						);
					}

					// Ensure the initial state is applied before any scroll events.
					tl.progress(0);
					fireInitialStateApplied();

					// ─── Resize → refreshInit → recompute deltas chain ───
					const handleRefreshInit = () => {
						if (
							!logoRef.current ||
							!headlineRef.current ||
							!logoMarkerRef.current ||
							!headlineMarkerRef.current
						)
							return;

						// Clear GSAP transforms + reset text layout so
						// getBoundingClientRect returns the natural CSS position
						const savedLogoTransform = logoRef.current.style.transform;
						const savedHeadlineTransform = headlineRef.current.style.transform;
						const savedMaxWidth = headlineRef.current.style.maxWidth;
						const savedWhiteSpace = headlineRef.current.style.whiteSpace;
						const savedFlexWrap = headlineRef.current.style.flexWrap;

						logoRef.current.style.transform = "none";
						headlineRef.current.style.transform = "none";
						headlineRef.current.style.maxWidth = "none";
						headlineRef.current.style.whiteSpace = "nowrap";
						headlineRef.current.style.flexWrap = "";
						void logoRef.current.offsetHeight;

						deltas = computeMorphDeltas(
							logoRef.current,
							headlineRef.current,
							logoMarkerRef.current,
							headlineMarkerRef.current,
						);

						logoRef.current.style.transform = savedLogoTransform;
						headlineRef.current.style.transform = savedHeadlineTransform;
						headlineRef.current.style.maxWidth = savedMaxWidth;
						headlineRef.current.style.whiteSpace = savedWhiteSpace;
						headlineRef.current.style.flexWrap = savedFlexWrap;

						tl.invalidate();
						tl.progress(lastAnimationProgress);
					};
					ScrollTrigger.addEventListener("refreshInit", handleRefreshInit);

					// ─── ScrollTrigger ────────────────────────────────────
					st = ScrollTrigger.create({
						trigger: sectionRef.current,
						scroller: scrollerEl ?? undefined,
						start: "top top",
						end: "bottom bottom",
						invalidateOnRefresh: true,
						onEnter: disableScrollSnap,
						onEnterBack: disableScrollSnap,
						onLeave: requestRestoreScrollSnap,
						onUpdate: (self) => {
							if (self.progress < AUTO_COMPLETE_RESET_POINT) {
								hasAutoCompleted = false;
								autoCompletionDisabled = false;
							}
							const velocity = self.getVelocity();
							if (
								!hasAutoCompleted &&
								!autoCompletionDisabled &&
								!isAutoScrolling &&
								self.direction === 1 &&
								self.progress >= AUTO_COMPLETE_MIN_PROGRESS &&
								self.progress < ANIMATION_END_POINT
							) {
								if (velocity > AUTO_COMPLETE_TRIGGER_VELOCITY_PX_PER_S) {
									startAutoScroll();
								}
							}
							const animationProgress = getAnimationProgressFromScroll(
								self.progress,
							);
							lastAnimationProgress = animationProgress;
							setTimelineProgress(animationProgress);
							if (animationProgress >= 0.85) {
								onRevealComplete?.();
							}
						},
						onLeaveBack: () => {
							requestRestoreScrollSnap();
							onRevealReverse?.();
						},
					});

					// ─── Event listeners ──────────────────────────────────
					if (scrollerEl) {
						scrollerEl.addEventListener("wheel", handleWheel, {
							passive: true,
						});
						scrollerEl.addEventListener("touchstart", cancelAutoScroll, {
							passive: true,
						});
					}
					window.addEventListener("keydown", handleKeyDown);

					// Debounced resize → ScrollTrigger.refresh()
					let resizeTimeout: number | null = null;
					const handleResize = () => {
						if (resizeTimeout !== null) window.clearTimeout(resizeTimeout);
						resizeTimeout = window.setTimeout(() => {
							resizeTimeout = null;
							if (!logoRef.current || !headlineRef.current) return;
							ScrollTrigger.refresh();
						}, 120);
					};
					window.addEventListener("resize", handleResize);

					// Font load → refresh measurements
					const handleFontLoad = () => {
						if (!isAlive || !logoRef.current || !headlineRef.current) return;
						ScrollTrigger.refresh();
					};
					document.fonts?.ready.then(handleFontLoad);

					// ─── Cleanup (matchMedia auto-calls on revert) ───────
					return () => {
						isAlive = false;
						if (resizeTimeout !== null) window.clearTimeout(resizeTimeout);
						window.removeEventListener("resize", handleResize);
						ScrollTrigger.removeEventListener("refreshInit", handleRefreshInit);
						if (scrollerEl) {
							scrollerEl.removeEventListener("wheel", handleWheel);
							scrollerEl.removeEventListener("touchstart", cancelAutoScroll);
						}
						window.removeEventListener("keydown", handleKeyDown);
						if (autoScrollTween) {
							autoScrollTween.kill();
						}
						st?.kill();
						clearRestoreTracking();
						doRestoreScrollSnap();
					};
				},
			);

			// matchMedia cleanup on useGSAP revert
			return () => {
				mm.revert();
			};
		},
		{
			dependencies: [],
			revertOnUpdate: true,
		},
	);

	return {
		progress: 0,
	};
}
