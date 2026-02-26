import type { ThemeConfig } from "@/lib/theme/types";
import { extractHue } from "@/lib/utils/color";

export interface ThemedDarkColors {
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
 * Generate a themed dark palette based on the theme's primary hue.
 * Creates warm, saturated darks instead of pure blacks/grays.
 */
export function getThemedDarkColors(theme: ThemeConfig): ThemedDarkColors {
	const hue = extractHue(theme.primary);
	const satMatch = theme.primary.match(/,\s*([\d.]+)%/);
	const primarySat = satMatch ? parseFloat(satMatch[1]) : 15;

	return {
		bg: `hsl(${hue}, 18%, 8%)`,
		bgLight: `hsl(${hue}, 16%, 12%)`,
		bgLighter: `hsl(${hue}, 14%, 16%)`,
		bgVignette: `hsla(${hue}, 18%, 8%, 0.44)`,
		bgFade: `hsl(${hue}, 18%, 8%)`,
		surface: `hsl(${hue}, 14%, 14%)`,
		surfaceHover: `hsl(${hue}, 16%, 18%)`,
		border: `hsl(${hue}, 12%, 22%)`,
		borderLight: `hsl(${hue}, 10%, 28%)`,
		text: `hsl(${hue}, 12%, 94%)`,
		textMuted: `hsl(${hue}, 10%, 65%)`,
		textDim: `hsl(${hue}, 8%, 45%)`,
		accent: `hsl(${hue}, ${primarySat}%, 72%)`,
		accentMuted: `hsl(${hue}, ${primarySat}%, 54%)`,
		accentSubtle: `hsl(${hue}, ${Math.max(8, primarySat - 4)}%, 26%)`,
	};
}
