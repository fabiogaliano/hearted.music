import { useEffect, useState } from "react";
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
	padding?: number;
	/** Distance (px) over which the dim + frost feather from full to clear at the edge. */
	feather?: number;
	/** Frosted-glass blur (px) applied to the surround only — 0 disables it. */
	blur?: number;
	/** Override feather distance on the bottom edge — shorter than the default
	 *  keeps a soft transition while covering content just below the window. */
	bottomFeather?: number;
	/** Override feather distance on the top edge — shorter than the default pulls
	 *  the solid dim down toward the window, covering content (e.g. a caption and
	 *  the page copy behind it) that sits just above the window. */
	topFeather?: number;
}

/**
 * A coach-mark spotlight: dims + frosts the page around a target, leaving a soft-
 * edged rectangular window of clear, sharp page. The surround is a single layer
 * (scrim tint + masked backdrop-blur) masked by two crossed linear gradients —
 * horizontal × vertical — whose default `add` compositing unions to a rectangle:
 * soft, foggy edges localised to each side, but crisp square corners (no oval). The
 * dim is theme-aware (a wash of --t-text). Re-measured every frame so it tracks
 * motion, scroll and resize. Used only by the onboarding /playlists rehearsal;
 * production never mounts it.
 */
export function SpotlightOverlay({
	targetSelector,
	blocking = true,
	caption,
	padding = 10,
	feather = 64,
	blur = 6,
	bottomFeather,
	topFeather,
}: SpotlightOverlayProps) {
	const [rect, setRect] = useState<Rect | null>(null);
	const [mounted, setMounted] = useState(false);

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
		const measure = () => {
			const els = document.querySelectorAll(targetSelector);
			if (els.length > 0) {
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
				setRect((prev) =>
					prev &&
					prev.top === next.top &&
					prev.left === next.left &&
					prev.width === next.width &&
					prev.height === next.height
						? prev
						: next,
				);
			} else {
				setRect(null);
			}
			raf = requestAnimationFrame(measure);
		};
		raf = requestAnimationFrame(measure);
		return () => cancelAnimationFrame(raf);
	}, [targetSelector]);

	if (!targetSelector) return null;

	const scrim = "color-mix(in srgb, var(--t-text) 44%, transparent)";
	const blurStyle =
		blur > 0
			? {
					backdropFilter: `blur(${blur}px)`,
					WebkitBackdropFilter: `blur(${blur}px)`,
				}
			: {};

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
					...blurStyle,
					pointerEvents: blocking ? "auto" : "none",
				}}
			/>
		);
	}

	// Before the first measurement lands, render the full scrim with no window
	// so the page stays dimmed instead of flashing all content.
	let mask: string | undefined;

	if (rect) {
		const top = rect.top - padding;
		const left = rect.left - padding;
		const width = rect.width + padding * 2;
		const height = rect.height + padding * 2;
		const right = left + width;
		const bottom = top + height;
		const f = feather;
		const tf = topFeather ?? f;
		const bf = bottomFeather ?? f;

		const hMask = `linear-gradient(to right, #000 0, #000 ${Math.max(0, left - f)}px, transparent ${left}px, transparent ${right}px, #000 ${right + f}px)`;
		const vMask = `linear-gradient(to bottom, #000 0, #000 ${Math.max(0, top - tf)}px, transparent ${top}px, transparent ${bottom}px, #000 ${bottom + bf}px)`;
		mask = `${hMask}, ${vMask}`;
	}

	let captionEl: React.ReactNode = null;
	if (rect && caption) {
		const cx = rect.left + rect.width / 2;
		const vh = typeof window === "undefined" ? 0 : window.innerHeight;
		const roomAbove = rect.top;
		const roomBelow = vh - (rect.top + rect.height);
		const captionBelow = roomBelow >= roomAbove;
		const captionY = captionBelow
			? rect.top + rect.height + padding + 16
			: rect.top - padding - 16;
		captionEl = (
			<div
				className="fixed"
				style={{
					left: Math.round(cx),
					top: Math.round(captionY),
					transform: captionBelow
						? "translate(-50%, 0)"
						: "translate(-50%, -100%)",
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
			</div>
		);
	}

	return createPortal(
		<div className="fixed inset-0 z-[60]" style={{ pointerEvents: "none" }}>
			{blocking && rect ? (
				<>
					<div
						style={{
							position: "fixed",
							top: 0,
							left: 0,
							right: 0,
							height: Math.max(0, rect.top - padding),
							pointerEvents: "auto",
						}}
					/>
					<div
						style={{
							position: "fixed",
							top: rect.top - padding + rect.height + padding * 2,
							left: 0,
							right: 0,
							bottom: 0,
							pointerEvents: "auto",
						}}
					/>
					<div
						style={{
							position: "fixed",
							top: rect.top - padding,
							left: 0,
							width: Math.max(0, rect.left - padding),
							height: rect.height + padding * 2,
							pointerEvents: "auto",
						}}
					/>
					<div
						style={{
							position: "fixed",
							top: rect.top - padding,
							left: rect.left - padding + rect.width + padding * 2,
							right: 0,
							height: rect.height + padding * 2,
							pointerEvents: "auto",
						}}
					/>
				</>
			) : blocking && !rect ? (
				<div
					style={{
						position: "fixed",
						inset: 0,
						pointerEvents: "auto",
					}}
				/>
			) : null}
			<div
				aria-hidden="true"
				className="fixed inset-0"
				style={{
					background: scrim,
					...blurStyle,
					...(mask ? { maskImage: mask, WebkitMaskImage: mask } : {}),
					pointerEvents: "none",
				}}
			/>
			{captionEl}
		</div>,
		document.body,
	);
}
