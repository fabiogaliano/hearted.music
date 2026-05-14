/**
 * SpotifyLoginButton - Auth CTA for released mode
 *
 * Follows Warm Pastel design system:
 * - Primary button styling with theme colors
 * - 14px uppercase tracking-widest
 * - Hover: scale(1.05)
 *
 * Variants:
 * - light: For light backgrounds (uses primary token bg)
 * - dark: For dark/gradient backgrounds (uses light bg for contrast)
 */

import { fonts } from "@/lib/theme/fonts";

interface SpotifyLoginButtonProps {
	buttonText?: string;
	/** 'light' for light backgrounds, 'dark' for dark/gradient backgrounds */
	variant?: "light" | "dark";
}

export function SpotifyLoginButton({
	buttonText = "SIGN In",
	variant = "light",
}: SpotifyLoginButtonProps) {
	const isDark = variant === "dark";

	return (
		<a
			href="/login"
			className="relative inline-block px-6 py-3 text-sm tracking-widest uppercase transition-transform duration-150 hover:scale-105 active:scale-[0.98]"
			style={{
				background: isDark ? "var(--t-text-on-primary)" : "var(--t-primary)",
				color: isDark ? "var(--t-primary)" : "var(--t-text-on-primary)",
				fontFamily: fonts.body,
				fontWeight: 500,
				borderRadius: "2px",
			}}
		>
			{buttonText}
		</a>
	);
}
