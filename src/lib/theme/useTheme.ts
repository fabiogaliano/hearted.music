/**
 * useTheme hook
 *
 * Returns the current theme configuration based on URL search params.
 * Used by onboarding components to style themselves.
 */

import { themes } from "./colors";
import { fonts } from "./fonts";
import type { ThemeColor, ThemeConfig } from "./types";

export interface UseThemeReturn {
	theme: ThemeConfig;
	themeColor: ThemeColor;
	fonts: typeof fonts;
}

/**
 * Get theme configuration for a given color
 */
export function useTheme(themeColor: ThemeColor): UseThemeReturn {
	const theme = themes[themeColor];

	return {
		theme,
		themeColor,
		fonts,
	};
}

/**
 * Get theme by color name (non-hook version for use outside components)
 */
export function getTheme(themeColor: ThemeColor): ThemeConfig {
	return themes[themeColor];
}
