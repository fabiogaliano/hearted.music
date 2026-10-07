/**
 * CSS Color Utilities
 *
 * Helpers for working with HSL color strings in CSS.
 * For WebGL/shader colors (Vec3), see palette.ts
 */

/**
 * Extract the hue value from an HSL color string
 * @example extractHue('hsl(218, 30%, 50%)') → 218
 */
export function extractHue(hslColor: string): number {
	const match = hslColor.match(/hsl\((\d+)/);
	return match ? parseInt(match[1], 10) : 218;
}

/**
 * Generate a soft pastel accent color from a hue value
 * Uses gentle saturation (30%) and high lightness (80%) for
 * a true pastel feel - soft and muted, visible on dark backgrounds
 */
export function getPastelColor(hue: number): string {
	return `hsl(${hue}, 30%, 80%)`;
}

/**
 * Convert an HSL color string to HSLA by injecting an alpha value
 * @example withAlpha('hsl(218, 30%, 50%)', 0.5) → 'hsla(218, 30%, 50%, 0.5)'
 */
export function withAlpha(hslColor: string, alpha: number): string {
	if (!hslColor.startsWith("hsl(")) return hslColor;
	return `hsla(${hslColor.slice(4, -1)}, ${alpha})`;
}
