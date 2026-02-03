/**
 * ThemeHueProvider - Central theme management with optimized context splitting
 *
 * PROBLEM: Single context with {theme, registerTheme} causes 38 components to
 * re-render whenever theme changes, even though only 3 routes ever call
 * registerTheme (WRITE) while the rest only read state.
 *
 * SOLUTION: Split into two contexts - stable dispatch (never re-renders readers)
 * and state (only re-renders when theme actually changes).
 */
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useState,
	type ReactNode,
} from "react";

import { getThemeHue, themes } from "./colors";
import { DEFAULT_THEME, type ThemeConfig } from "./types";

type RegisterTheme = (theme: ThemeConfig) => void;

const ThemeDispatchContext = createContext<RegisterTheme | null>(null);
ThemeDispatchContext.displayName = "ThemeDispatch";

const ThemeStateContext = createContext<ThemeConfig | null>(null);
ThemeStateContext.displayName = "ThemeState";

export function ThemeHueProvider({ children }: { children: ReactNode }) {
	const [theme, setTheme] = useState<ThemeConfig>(() => themes[DEFAULT_THEME]);

	const registerTheme = useCallback<RegisterTheme>((newTheme) => {
		setTheme((current) => (current === newTheme ? current : newTheme));
	}, []);

	useEffect(() => {
		const hue = getThemeHue(theme);
		document.documentElement.style.setProperty("--theme-hue", String(hue));
	}, [theme]);

	return (
		<ThemeDispatchContext.Provider value={registerTheme}>
			<ThemeStateContext.Provider value={theme}>
				{children}
			</ThemeStateContext.Provider>
		</ThemeDispatchContext.Provider>
	);
}
ThemeHueProvider.displayName = "ThemeHueProvider";

/**
 * Hook for routes to register their theme with the provider.
 * Call this in any route/layout that determines the active theme.
 *
 * Pass `null` to skip registration (e.g., when a child component owns the theme).
 */
export function useRegisterTheme(theme: ThemeConfig | null): void {
	const registerTheme = useContext(ThemeDispatchContext);

	useLayoutEffect(() => {
		if (theme) registerTheme?.(theme);
	}, [theme, registerTheme]);
}

/**
 * Hook for components to consume the current theme.
 * Returns the theme registered by the nearest route/layout.
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

/**
 * Hook for components that may optionally receive a theme override.
 * Returns the override if provided, otherwise falls back to context.
 *
 * Use this for components like SongDetailPanel that need dark mode overrides.
 */
export function useThemeWithOverride(themeOverride?: ThemeConfig): ThemeConfig {
	const contextTheme = useTheme();
	return themeOverride ?? contextTheme;
}
