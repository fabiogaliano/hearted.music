/**
 * useFlagPlaylistsScroll - Horizontal scroll via wheel events
 *
 * Converts wheel events directly to horizontal track movement.
 * No vertical scrolling — page is locked at viewport height.
 *
 * Behavior:
 * - Wheel down → track moves left (reveals more content)
 * - Wheel up → track moves right (goes back)
 * - Smooth GSAP animation with momentum
 * - Clamped to content bounds
 *
 * Accessibility:
 * - Respects prefers-reduced-motion (instant movement, no animation)
 * - Disabled on mobile (< 768px) for native touch scroll
 */
import { useEffect, useRef, type RefObject } from "react";

import gsap from "gsap";

export interface FlagPlaylistsScrollRefs {
	/** The outer section that captures wheel events */
	sectionRef: RefObject<HTMLElement | null>;
	/** The pinned wrapper (header + viewport + footer) - kept for layout */
	pinnedWrapperRef: RefObject<HTMLDivElement | null>;
	/** The viewport container (clips the track) */
	viewportRef: RefObject<HTMLDivElement | null>;
	/** The horizontal track containing playlist items */
	trackRef: RefObject<HTMLDivElement | null>;
}

export interface FlagPlaylistsScrollOptions {
	/** Whether the component is ready (playlists loaded) */
	isReady?: boolean;
}

/** Wheel sensitivity multiplier */
const WHEEL_MULTIPLIER = 1.5;

/** Animation duration for smooth scrolling */
const SCROLL_DURATION = 0.4;

/** Ease function for momentum feel */
const SCROLL_EASE = "power2.out";

export function useFlagPlaylistsScroll(
	refs: FlagPlaylistsScrollRefs,
	options: FlagPlaylistsScrollOptions = {},
): void {
	const { isReady = true } = options;
	// Destructure refs early — individual RefObjects are stable across renders
	const { sectionRef, viewportRef, trackRef } = refs;

	// Track current X position for smooth animation
	const currentX = useRef(0);
	const targetX = useRef(0);
	const tweenRef = useRef<gsap.core.Tween | null>(null);

	useEffect(() => {
		// SSR safety
		if (typeof window === "undefined") return;

		// Wait until ready
		if (!isReady) return;

		// Verify required refs
		if (!sectionRef.current || !viewportRef.current || !trackRef.current) {
			return;
		}

		const section = sectionRef.current;
		const viewport = viewportRef.current;
		const track = trackRef.current;

		// Check for reduced motion preference
		const prefersReducedMotion = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;

		// Disable on mobile for better touch UX
		const isDesktop = window.matchMedia("(min-width: 768px)").matches;
		if (!isDesktop) {
			// Enable native horizontal scroll on mobile
			viewport.style.overflowX = "auto";
			return;
		}

		// Measure dimensions
		const measureDimensions = () => {
			const trackWidth = track.scrollWidth;
			const viewportWidth = viewport.clientWidth;
			return {
				trackWidth,
				viewportWidth,
				maxScroll: Math.max(0, trackWidth - viewportWidth),
			};
		};

		let dimensions = measureDimensions();

		// Skip if content fits in viewport (no scroll needed)
		if (dimensions.maxScroll <= 0) {
			return;
		}

		// Set initial position
		gsap.set(track, { x: 0 });
		currentX.current = 0;
		targetX.current = 0;

		// Handle wheel events
		const handleWheel = (e: WheelEvent) => {
			e.preventDefault();

			// Calculate new target position
			const delta = (e.deltaY || e.deltaX) * WHEEL_MULTIPLIER;
			targetX.current = Math.max(
				-dimensions.maxScroll,
				Math.min(0, targetX.current - delta),
			);

			// Kill existing tween
			if (tweenRef.current) {
				tweenRef.current.kill();
			}

			if (prefersReducedMotion) {
				// Instant movement for reduced motion
				gsap.set(track, { x: targetX.current });
				currentX.current = targetX.current;
			} else {
				// Smooth animated movement
				tweenRef.current = gsap.to(track, {
					x: targetX.current,
					duration: SCROLL_DURATION,
					ease: SCROLL_EASE,
					onUpdate: () => {
						currentX.current = gsap.getProperty(track, "x") as number;
					},
				});
			}
		};

		// Handle resize
		const handleResize = () => {
			dimensions = measureDimensions();
			// Clamp current position to new bounds
			targetX.current = Math.max(
				-dimensions.maxScroll,
				Math.min(0, targetX.current),
			);
			gsap.set(track, { x: targetX.current });
			currentX.current = targetX.current;
		};

		// Add listeners
		section.addEventListener("wheel", handleWheel, { passive: false });
		window.addEventListener("resize", handleResize);

		// Cleanup
		return () => {
			section.removeEventListener("wheel", handleWheel);
			window.removeEventListener("resize", handleResize);
			if (tweenRef.current) {
				tweenRef.current.kill();
			}
		};
	}, [isReady, sectionRef, viewportRef, trackRef]);
}
