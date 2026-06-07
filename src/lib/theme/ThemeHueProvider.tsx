/**
 * ThemeHueProvider - render-time theme context with SSR-safe hue output.
 *
 * The active theme is already knowable during render, so both the context value
 * and the `--theme-hue` CSS variable are emitted during render too.
 */
import { createContext, type ReactNode, useContext } from "react";

import { getThemeHue, themes } from "./colors";
import { DEFAULT_THEME, type ThemeConfig } from "./types";

const ThemeStateContext = createContext<ThemeConfig | null>(null);
ThemeStateContext.displayName = "ThemeState";

export function ThemeHueProvider({
	children,
	initialTheme,
	theme,
}: {
	children: ReactNode;
	initialTheme?: ThemeConfig;
	theme?: ThemeConfig;
}) {
	const activeTheme = theme ?? initialTheme ?? themes[DEFAULT_THEME];
	const hue = getThemeHue(activeTheme);

	return (
		<ThemeStateContext.Provider value={activeTheme}>
			<style>{`:root {
	--theme-hue: ${hue};
	--t-bg: ${activeTheme.bg};
	--t-surface: ${activeTheme.surface};
	--t-surface-dim: ${activeTheme.surfaceDim};
	--t-border: ${activeTheme.border};
	--t-text: ${activeTheme.text};
	--t-text-muted: ${activeTheme.textMuted};
	--t-text-on-primary: ${activeTheme.textOnPrimary};
	--t-primary: ${activeTheme.primary};
	--t-primary-hover: ${activeTheme.primaryHover};
}`}</style>
			{children}
		</ThemeStateContext.Provider>
	);
}
ThemeHueProvider.displayName = "ThemeHueProvider";

/**
 * Hook for components to consume the current theme.
 * Returns the theme from the nearest ThemeHueProvider.
 *
 * @throws Error if used outside ThemeHueProvider
 */
export function useTheme(): ThemeConfig {
	const theme = useContext(ThemeStateContext);
	if (!theme) {
		throw new Error("useTheme must be used within ThemeHueProvider");
	}
	return theme;
}
