/**
 * useTheme hook
 *
 * Returns the current theme configuration based on URL search params.
 * Used by onboarding components to style themselves.
 */

import { themes } from "./colors";
import type { ThemeColor, ThemeConfig } from "./types";

/**
 * Get theme by color name (non-hook version for use outside components)
 */
export function getTheme(themeColor: ThemeColor): ThemeConfig {
	return themes[themeColor];
}
