/**
 * Theme color palettes
 *
 * HSL-based monochromatic themes with light and dark variants.
 * Each theme maintains the same hue across all surfaces for visual harmony.
 */

import type { ThemeColor, ThemeConfig } from "./types";

export const themes: Record<ThemeColor, ThemeConfig> = {
	blue: {
		name: "Calm",
		bg: "hsl(218, 25%, 88%)",
		surface: "hsl(218, 25%, 92%)",
		surfaceDim: "hsl(218, 25%, 82%)",
		border: "hsl(218, 15%, 78%)",
		text: "hsl(218, 20%, 25%)",
		textMuted: "hsl(218, 15%, 50%)",
		textOnPrimary: "hsl(218, 25%, 92%)",
		primary: "hsl(218, 20%, 30%)",
		primaryHover: "hsl(218, 22%, 22%)",
	},
	green: {
		name: "Fresh",
		bg: "hsl(135, 26%, 87%)",
		surface: "hsl(135, 26%, 92%)",
		surfaceDim: "hsl(135, 26%, 80%)",
		border: "hsl(135, 18%, 75%)",
		text: "hsl(135, 26%, 25%)",
		textMuted: "hsl(135, 18%, 48%)",
		textOnPrimary: "hsl(135, 26%, 92%)",
		primary: "hsl(135, 26%, 32%)",
		primaryHover: "hsl(135, 28%, 24%)",
	},
	rose: {
		name: "Warm",
		bg: "hsl(340, 32%, 85%)",
		surface: "hsl(340, 32%, 91%)",
		surfaceDim: "hsl(340, 32%, 78%)",
		border: "hsl(340, 20%, 75%)",
		text: "hsl(340, 28%, 22%)",
		textMuted: "hsl(340, 20%, 45%)",
		textOnPrimary: "hsl(340, 32%, 92%)",
		primary: "hsl(340, 28%, 28%)",
		primaryHover: "hsl(340, 30%, 20%)",
	},
	lavender: {
		name: "Dreamy",
		bg: "hsl(300, 21%, 88%)",
		surface: "hsl(300, 21%, 93%)",
		surfaceDim: "hsl(300, 21%, 81%)",
		border: "hsl(300, 14%, 77%)",
		text: "hsl(300, 15%, 24%)",
		textMuted: "hsl(300, 12%, 48%)",
		textOnPrimary: "hsl(300, 21%, 93%)",
		primary: "hsl(300, 15%, 30%)",
		primaryHover: "hsl(300, 17%, 22%)",
	},
};

/**
 * Generate dark theme variant from a base theme
 * Keeps the same hue but inverts the lightness values for dark mode
 */
export function getDarkTheme(baseTheme: ThemeConfig): ThemeConfig {
	const hueMatch = baseTheme.primary.match(/hsl\((\d+)/);
	// Fallback 218 = blue theme hue (safest neutral if regex fails on malformed HSL)
	const hue = hueMatch ? Number.parseInt(hueMatch[1], 10) : 218;

	return {
		name: `${baseTheme.name} Dark`,
		bg: `hsl(${hue}, 18%, 8%)`,
		surface: `hsl(${hue}, 16%, 12%)`,
		surfaceDim: `hsl(${hue}, 14%, 16%)`,
		border: `hsl(${hue}, 12%, 22%)`,
		text: `hsl(${hue}, 12%, 92%)`,
		textMuted: `hsl(${hue}, 10%, 60%)`,
		textOnPrimary: `hsl(${hue}, 18%, 8%)`,
		primary: `hsl(${hue}, 45%, 65%)`,
		primaryHover: `hsl(${hue}, 50%, 72%)`,
	};
}

/**
 * Utility to extract hue from a theme for generating complementary colors
 */
export function getThemeHue(theme: ThemeConfig): number {
	const hueMatch = theme.primary.match(/hsl\((\d+)/);
	return hueMatch ? Number.parseInt(hueMatch[1], 10) : 218;
}
