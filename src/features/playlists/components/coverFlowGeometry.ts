import type { CSSProperties } from "react";

export const prefersReduced = () =>
	typeof window !== "undefined" &&
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Cover-flow stage geometry, tuned by eye and named so the per-sleeve math below
 * reads as intent rather than a wall of magic numbers. Distances are in steps
 * from the centered sleeve.
 */
const SLEEVE = {
	/** px the first neighbour sits off-centre… */
	shift: 140,
	/** …plus this per extra step out. */
	gap: 58,
	/** deg neighbours angle back toward the stage. */
	rotation: 44,
	/** px each step recedes along Z. */
	depth: 72,
	/** per-step shrink (gentler when motion is reduced). */
	scaleStep: 0.12,
	scaleStepReduced: 0.08,
	minScale: 0.64,
	/** per-step fade. */
	opacityStep: 0.24,
	/** sleeves more than this many steps out aren't drawn. */
	cullBeyond: 4,
	/** …and beyond this they stop catching pointer events. */
	interactiveWithin: 3,
} as const;

// px the centred sleeve travels per one step of drag — equal to the first
// neighbour's shift, so the centred cover tracks the finger 1:1 while dragging.
export const DRAG_STEP_PX = SLEEVE.shift;
// Release momentum: project the finger's exit velocity this far ahead before
// snapping, so a fast flick advances several covers, not just the dragged one.
export const FLICK_PROJECT_MS = 90;

// `offset` may be fractional while a drag is in flight, so x / ry / z interpolate
// continuously across the first step instead of popping from centre (x=0) to the
// first neighbour's `shift`. At integer offsets the math reduces to the discrete
// resting geometry, so a settled flow looks exactly as before.
export function sleeveStyle(
	offset: number,
	reduce: boolean,
	dragging: boolean,
): CSSProperties {
	const distance = Math.abs(offset);
	const sign = Math.sign(offset);
	const hidden = distance > SLEEVE.cullBeyond;
	const x =
		distance <= 1
			? offset * SLEEVE.shift
			: sign * (SLEEVE.shift + (distance - 1) * SLEEVE.gap);
	const ry = reduce ? 0 : -(distance <= 1 ? offset : sign) * SLEEVE.rotation;
	const tz = reduce ? 0 : -distance * SLEEVE.depth;
	const scale = Math.max(
		SLEEVE.minScale,
		1 - distance * (reduce ? SLEEVE.scaleStepReduced : SLEEVE.scaleStep),
	);
	return {
		transform: `translateX(${x}px) translateZ(${tz}px) rotateY(${ry}deg) scale(${scale})`,
		opacity: hidden ? 0 : Math.max(0, 1 - distance * SLEEVE.opacityStep),
		visibility: hidden ? "hidden" : "visible",
		zIndex: 100 - Math.round(distance),
		pointerEvents: distance > SLEEVE.interactiveWithin ? "none" : "auto",
		transformStyle: "preserve-3d",
		transformOrigin: "50% 100%",
		willChange: "transform, opacity",
		// No transition while the finger drives the covers — they must track 1:1.
		// Restored on release so the snap to the nearest cover animates.
		transition:
			reduce || dragging
				? "none"
				: "transform 520ms var(--ease-out-expo), opacity 380ms ease",
	};
}

export function dropShadow(isCenter: boolean): string {
	return isCenter
		? "0 30px 60px -24px color-mix(in srgb, var(--t-text) 65%, transparent)"
		: "0 24px 44px -22px color-mix(in srgb, var(--t-text) 60%, transparent)";
}
