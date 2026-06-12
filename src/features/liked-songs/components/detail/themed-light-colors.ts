import type { ThemeConfig } from "@/lib/theme/types";

interface ThemedLightColors {
	bg: string;
	bgLight: string;
	bgLighter: string;
	bgVignette: string;
	bgFade: string;
	surface: string;
	surfaceHover: string;
	border: string;
	borderLight: string;
	text: string;
	textMuted: string;
	textDim: string;
	accent: string;
	accentMuted: string;
	accentSubtle: string;
}

/**
 * Generate a themed light palette for embedded/marketing contexts.
 * It anchors to the landing page's existing theme tokens, then derives the few
 * extra shades the production surface needs.
 */
export function getThemedLightColors(theme: ThemeConfig): ThemedLightColors {
	return {
		bg: theme.bg,
		bgLight: theme.surface,
		bgLighter: `color-mix(in srgb, ${theme.surface} 82%, white)`,
		bgVignette: `color-mix(in srgb, ${theme.primary} 12%, transparent)`,
		bgFade: `color-mix(in srgb, ${theme.bg} 92%, ${theme.surface})`,
		surface: theme.surface,
		surfaceHover: theme.surfaceDim,
		border: theme.border,
		borderLight: `color-mix(in srgb, ${theme.border} 72%, ${theme.primary})`,
		text: theme.text,
		textMuted: theme.textMuted,
		textDim: `color-mix(in srgb, ${theme.textMuted} 78%, white)`,
		accent: theme.primary,
		accentMuted: `color-mix(in srgb, ${theme.primary} 72%, ${theme.textMuted})`,
		accentSubtle: `color-mix(in srgb, ${theme.primary} 10%, ${theme.surface})`,
	};
}
