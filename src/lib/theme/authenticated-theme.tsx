import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { themes } from "@/lib/theme/colors";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import type { ThemeColor } from "@/lib/theme/types";

interface AuthenticatedThemeContextValue {
	themeColor: ThemeColor;
	setThemeColor: (themeColor: ThemeColor) => void;
}

const AuthenticatedThemeContext =
	createContext<AuthenticatedThemeContextValue | null>(null);
AuthenticatedThemeContext.displayName = "AuthenticatedTheme";

export function AuthenticatedThemeProvider({
	initialThemeColor,
	children,
}: {
	initialThemeColor: ThemeColor;
	children: ReactNode;
}) {
	const [themeColor, setThemeColor] = useState<ThemeColor>(initialThemeColor);

	useEffect(() => {
		setThemeColor((current) =>
			current === initialThemeColor ? current : initialThemeColor,
		);
	}, [initialThemeColor]);

	const value = useMemo<AuthenticatedThemeContextValue>(
		() => ({ themeColor, setThemeColor }),
		[themeColor],
	);

	return (
		<AuthenticatedThemeContext.Provider value={value}>
			<ThemeHueProvider theme={themes[themeColor]}>{children}</ThemeHueProvider>
		</AuthenticatedThemeContext.Provider>
	);
}

export function useAuthenticatedTheme(): AuthenticatedThemeContextValue {
	const value = useContext(AuthenticatedThemeContext);
	if (!value) {
		throw new Error(
			"useAuthenticatedTheme must be used within AuthenticatedThemeProvider",
		);
	}
	return value;
}
