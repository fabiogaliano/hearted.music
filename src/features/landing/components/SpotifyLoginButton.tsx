/**
 * SpotifyLoginButton - Auth CTA for released mode
 *
 * Follows Warm Pastel design system:
 * - Primary button styling with theme colors
 * - 14px uppercase tracking-widest
 * - Hover: scale(1.05)
 *
 * Variants:
 * - light: For light backgrounds (uses theme.primary bg)
 * - dark: For dark/gradient backgrounds (uses light bg for contrast)
 */

import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";

export interface SpotifyLoginButtonProps {
	theme: ThemeConfig;
	buttonText?: string;
	/** 'light' for light backgrounds, 'dark' for dark/gradient backgrounds */
	variant?: "light" | "dark";
}

export function SpotifyLoginButton({
	theme,
	buttonText = "Continue with Spotify",
	variant = "light",
}: SpotifyLoginButtonProps) {
	const isDark = variant === "dark";

	return (
		<a
			href="/auth/spotify"
			className="relative inline-block px-6 py-3 text-sm tracking-widest uppercase transition-all duration-200 hover:scale-105"
			style={{
				background: isDark ? theme.textOnPrimary : theme.primary,
				color: isDark ? theme.primary : theme.textOnPrimary,
				fontFamily: fonts.body,
				fontWeight: 500,
				borderRadius: "2px",
			}}
		>
			{buttonText}
		</a>
	);
}
