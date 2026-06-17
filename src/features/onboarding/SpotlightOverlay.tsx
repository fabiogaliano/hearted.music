import {
	motion,
	useReducedMotion,
	useSpring,
	useTransform,
} from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Rect {
	top: number;
	left: number;
	width: number;
	height: number;
}

interface SpotlightOverlayProps {
	/** CSS selector of the element(s) to clear a window around, or null to hide.
	 *  Multiple matches are unioned into one bounding box, so a step can light, say,
	 *  the page title and the concept block together. */
	targetSelector: string | null;
	/**
	 * When true the dimmed surround captures pointer events, so only the lit
	 * target is interactive — the window itself is click-through to the real
	 * element beneath. When false the scrim is purely visual (highlight only).
	 */
	blocking?: boolean;
	/** Short instruction floated just outside the window, on whichever side has room. */
	caption?: string;
	/** Gap between the target's bounding box and the window edge (px). */
	padding?: number;
	/** Corner radius of the cutout window (px). */
	radius?: number;
	/** Edge feather — how far the dim fades from solid to clear at the window edge (px). */
	feather?: number;
	/** Accent-halo strength (0 = no halo). Scales the breathing ring's spread + alpha. */
	glow?: number;
}

// The "soft halo" look, promoted from the spotlight lab as the production default:
// a rounded, gently feathered window that springs between targets with a breathing
// accent halo. Tunables are props (so the overlay stays reusable), defaulting to the
// chosen treatment so every call site gets the same look for free.
const DIM = 0.5;
const SPRING = { stiffness: 260, damping: 30 };
// Near-instant settle when the user prefers reduced motion — the window jumps
// rather than morphs, but the dim + cutout (which convey focus) stay.
const SPRING_REDUCED = { stiffness: 1200, damping: 90 };

/**
 * A coach-mark spotlight: dims the page around a target, leaving a rounded, softly
 * feathered window of clear page with a breathing accent halo around it. The dim is
 * cast by a single huge `box-shadow` from the window element, so the cutout inherits
 * the window's `border-radius` for free; the window's geometry is spring-driven, so
 * it *morphs* between targets rather than snapping. The dim is theme-aware (a wash of
 * `--t-text`); the halo uses `--t-primary`. Targets are found by selector and
 * re-measured until they hold still, so the window tracks motion, scroll and resize.
 * Used only by the onboarding /playlists rehearsal; production never mounts it.
 *
 * Trade-off vs. the old crossed-gradient overlay: the box-shadow cutout can't frost
 * (backdrop-blur) the surround, so the dim is a flat scrim — slightly darker (0.5) to
 * compensate for the lost blur. In exchange the corners round and the window morphs.
 */
export function SpotlightOverlay({
	targetSelector,
	blocking = true,
	caption,
	padding = 12,
	radius = 16,
	feather = 20,
	glow = 1,
}: SpotlightOverlayProps) {
	const [rect, setRect] = useState<Rect | null>(null);
	const [mounted, setMounted] = useState(false);
	// Fade the dim in on appearance. Starts visible so the very first appearance
	// (and the SSR/initial inline scrim it hands off from) never flashes bright;
	// later re-appearances — after a no-target teaching step — ease in.
	const [revealed, setRevealed] = useState(true);
	const seenRef = useRef(false);
	const jumpedRef = useRef(false);
	// The selector the springs last settled toward. Lets us spring only when we move
	// to a *different* target (the morph between steps) and otherwise track the same
	// target 1:1 — see the spring-feeding effect below.
	const lastSelectorRef = useRef<string | null>(null);
	const shouldReduceMotion = useReducedMotion();

	const springConfig = shouldReduceMotion ? SPRING_REDUCED : SPRING;
	const x = useSpring(0, springConfig);
	const y = useSpring(0, springConfig);
	const w = useSpring(0, springConfig);
	const h = useSpring(0, springConfig);

	const right = useTransform(() => x.get() + w.get());
	const bottom = useTransform(() => y.get() + h.get());
	const captionLeft = useTransform(() => x.get() + w.get() / 2);
	const captionTopBelow = useTransform(() => y.get() + h.get() + 16);
	const captionTopAbove = useTransform(() => y.get() - 16);

	// The scrim is client-only (portal + per-frame measurement), so on an SSR'd
	// route the server HTML paints the bright page first and the overlay only
	// appears after hydration — a visible flash. Tracking mount lets the pre-mount
	// render emit a plain inline scrim (below) that ships in the server HTML.
	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		if (!targetSelector) {
			setRect(null);
			return;
		}
		let raf = 0;
		let stable = 0;
		let last: Rect | null = null;
		// Wake on the target's own size changes too, not just scroll/resize: the lit
		// elements grow from content (genres added, the textarea or suggestion chips
		// expanding the intent zone), which fires neither scroll nor resize. Without
		// this the loop sleeps at the pre-growth height and the window clips the newly
		// pushed-down content (e.g. the Save button).
		const ro = new ResizeObserver(() => wake());
		const measure = () => {
			const els = document.querySelectorAll(targetSelector);
			if (els.length > 0) {
				for (const el of els) ro.observe(el);
				// Union every match into one bounding box, so a step can light several
				// elements at once (e.g. the page title + the concept block).
				let t = Number.POSITIVE_INFINITY;
				let l = Number.POSITIVE_INFINITY;
				let r = Number.NEGATIVE_INFINITY;
				let b = Number.NEGATIVE_INFINITY;
				for (const el of els) {
					const rc = el.getBoundingClientRect();
					t = Math.min(t, rc.top);
					l = Math.min(l, rc.left);
					r = Math.max(r, rc.right);
					b = Math.max(b, rc.bottom);
				}
				const next = { top: t, left: l, width: r - l, height: b - t };
				if (
					last &&
					last.top === next.top &&
					last.left === next.left &&
					last.width === next.width &&
					last.height === next.height
				) {
					stable += 1;
				} else {
					stable = 0;
					last = next;
					setRect(next);
				}
			} else {
				stable = 0;
				last = null;
				setRect(null);
			}
			// getBoundingClientRect forces a layout, so don't run it forever: once the
			// target has held still for ~12 frames, sleep. scroll/resize (below) and a
			// targetSelector change (this effect re-running) wake it again.
			raf = stable < 12 ? requestAnimationFrame(measure) : 0;
		};
		const wake = () => {
			if (!raf) {
				stable = 0;
				raf = requestAnimationFrame(measure);
			}
		};
		raf = requestAnimationFrame(measure);
		window.addEventListener("scroll", wake, true);
		window.addEventListener("resize", wake);
		return () => {
			if (raf) cancelAnimationFrame(raf);
			ro.disconnect();
			window.removeEventListener("scroll", wake, true);
			window.removeEventListener("resize", wake);
		};
	}, [targetSelector]);

	// Feed the padded rect into the springs. Spring (morph) only when we've moved to a
	// *different* target — gliding between steps is the whole point. For the same target
	// changing geometry (the panel sliding in, or the Add-to-matching expand growing the
	// lit zone) jump to the live measured rect every frame instead: the measure loop
	// already re-reads the element each frame, so jumping mirrors the element's own
	// transition curve 1:1 rather than trailing it on a separate spring — the two move as
	// one animation. (A static new target measures once, so its single spring set runs to
	// completion uninterrupted; only an actively-resizing target re-runs this per frame.)
	useEffect(() => {
		if (!rect) {
			jumpedRef.current = false;
			return;
		}
		const tx = rect.left - padding;
		const ty = rect.top - padding;
		const tw = rect.width + padding * 2;
		const th = rect.height + padding * 2;
		const morph =
			jumpedRef.current && lastSelectorRef.current !== targetSelector;
		if (morph) {
			x.set(tx);
			y.set(ty);
			w.set(tw);
			h.set(th);
		} else {
			x.jump(tx);
			y.jump(ty);
			w.jump(tw);
			h.jump(th);
		}
		jumpedRef.current = true;
		lastSelectorRef.current = targetSelector;
	}, [rect, padding, targetSelector, x, y, w, h]);

	// First appearance shows instantly (preserves the SSR/initial anti-flash);
	// re-appearances after a no-target step fade in.
	useEffect(() => {
		if (!targetSelector) {
			setRevealed(false);
			return;
		}
		if (!seenRef.current) {
			seenRef.current = true;
			setRevealed(true);
			return;
		}
		setRevealed(false);
		const r = requestAnimationFrame(() => setRevealed(true));
		return () => cancelAnimationFrame(r);
	}, [targetSelector]);

	if (!targetSelector) return null;

	const scrim = `color-mix(in srgb, var(--t-text) ${Math.round(DIM * 100)}%, transparent)`;

	// Used to decide whether the caption floats above or below the window.
	const viewportH = typeof window === "undefined" ? 0 : window.innerHeight;

	// SSR and the first client render (pre-mount): a plain inline full scrim — no
	// portal, no measurement — so the dim ships in the server HTML and the page
	// never flashes bright before JS hydrates. Identical on the server and the
	// first client render, so no hydration mismatch; the measured portal version
	// below takes over once mounted.
	if (!mounted || typeof document === "undefined") {
		return (
			<div
				aria-hidden="true"
				className="fixed inset-0 z-[60]"
				style={{
					background: scrim,
					pointerEvents: blocking ? "auto" : "none",
				}}
			/>
		);
	}

	// Before the first measurement lands, render a full scrim with no window so the
	// page stays dimmed instead of flashing all content.
	if (!rect) {
		return createPortal(
			<div
				aria-hidden="true"
				className="fixed inset-0 z-[60]"
				style={{
					background: scrim,
					pointerEvents: blocking ? "auto" : "none",
				}}
			/>,
			document.body,
		);
	}

	const dimShadow =
		feather > 0
			? `0 0 ${feather}px ${feather * 0.6}px ${scrim}, 0 0 0 100vmax ${scrim}`
			: `0 0 0 100vmax ${scrim}`;

	const haloShadow = `0 0 ${16 + glow * 24}px ${glow * 2}px color-mix(in srgb, var(--t-primary) ${Math.round(
		40 + glow * 40,
	)}%, transparent)`;
	const haloBorder = `1px solid color-mix(in srgb, var(--t-primary) ${Math.round(
		28 + glow * 32,
	)}%, transparent)`;

	const roomAbove = rect.top;
	const roomBelow = viewportH - (rect.top + rect.height);
	const captionBelow = roomBelow >= roomAbove;

	return createPortal(
		<div className="fixed inset-0 z-[60]" style={{ pointerEvents: "none" }}>
			{blocking && (
				<>
					<motion.div
						style={{
							position: "fixed",
							top: 0,
							left: 0,
							right: 0,
							height: y,
							pointerEvents: "auto",
						}}
					/>
					<motion.div
						style={{
							position: "fixed",
							top: bottom,
							left: 0,
							right: 0,
							bottom: 0,
							pointerEvents: "auto",
						}}
					/>
					<motion.div
						style={{
							position: "fixed",
							top: y,
							left: 0,
							width: x,
							height: h,
							pointerEvents: "auto",
						}}
					/>
					<motion.div
						style={{
							position: "fixed",
							top: y,
							left: right,
							right: 0,
							height: h,
							pointerEvents: "auto",
						}}
					/>
				</>
			)}

			<motion.div
				aria-hidden="true"
				style={{
					position: "fixed",
					top: y,
					left: x,
					width: w,
					height: h,
					borderRadius: radius,
					boxShadow: dimShadow,
					opacity: revealed ? 1 : 0,
					transition: "opacity 200ms var(--ease-out-quart)",
					pointerEvents: "none",
				}}
			/>

			{glow > 0 && (
				<motion.div
					aria-hidden="true"
					style={{
						position: "fixed",
						top: y,
						left: x,
						width: w,
						height: h,
						borderRadius: radius,
						boxShadow: haloShadow,
						border: haloBorder,
						pointerEvents: "none",
					}}
					animate={
						shouldReduceMotion ? { opacity: 0.9 } : { opacity: [0.55, 1, 0.55] }
					}
					transition={
						shouldReduceMotion
							? undefined
							: {
									duration: 2.4,
									repeat: Number.POSITIVE_INFINITY,
									ease: "easeInOut",
								}
					}
				/>
			)}

			{caption && (
				<motion.div
					style={{
						position: "fixed",
						left: captionLeft,
						top: captionBelow ? captionTopBelow : captionTopAbove,
						x: "-50%",
						y: captionBelow ? 0 : "-100%",
						opacity: revealed ? 1 : 0,
						transition: "opacity 200ms var(--ease-out-quart)",
						pointerEvents: "none",
					}}
				>
					<span
						className="block rounded-full px-4 py-2 text-center text-sm font-medium whitespace-nowrap"
						style={{
							background: "var(--t-surface)",
							color: "var(--t-text)",
							boxShadow:
								"0 8px 24px -10px color-mix(in srgb, var(--t-text) 50%, transparent)",
						}}
					>
						{caption}
					</span>
				</motion.div>
			)}
		</div>,
		document.body,
	);
}
