/**
 * Fan-spread layout configuration hook
 *
 * Returns positioning and styling for 3 overlapping album images.
 */

export interface FanSpreadConfig {
	size: number;
	left: number;
	top: number;
	z: number;
	opacity: number;
	rotate: number;
}

export function useFanSpreadComposition(): FanSpreadConfig[] {
	return [
		{ size: 110, left: 60, top: 8, z: 3, opacity: 1, rotate: 0 },
		{ size: 100, left: 0, top: 16, z: 2, opacity: 0.85, rotate: -8 },
		{ size: 100, left: 130, top: 16, z: 1, opacity: 0.85, rotate: 8 },
	];
}
