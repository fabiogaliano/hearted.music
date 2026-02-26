export function clamp01(value: number) {
	return Math.min(1, Math.max(0, value));
}

export function lerp(from: number, to: number, t: number) {
	return from + (to - from) * t;
}

export function smoothstep(t: number) {
	return t * t * (3 - 2 * t);
}

/**
 * Spring interpolation for organic motion.
 * Attempt critically-damped spring (tension: 170, friction: 26).
 * Creates natural deceleration that feels like physical mass settling.
 */
export function springInterpolate(t: number): number {
	const omega = 13.04; // sqrt(170) - natural frequency
	const time = t * 0.6; // scale factor for desired duration
	const decay = Math.exp(-omega * time);
	return clamp01(1 - decay * (1 + omega * time));
}
