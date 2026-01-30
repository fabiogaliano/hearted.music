import type { ThemeConfig } from "@/lib/theme/types";
import { fonts } from "@/lib/theme/fonts";

export interface WaitlistInputProps {
	theme: ThemeConfig;
	buttonText?: string;
	/** 'light' for light backgrounds, 'dark' for dark/gradient backgrounds */
	variant?: "light" | "dark";
}

export function WaitlistInput({
	theme,
	buttonText = "Show me mine",
	variant = "light",
}: WaitlistInputProps) {
	const isDark = variant === "dark";

	return (
		<div className="flex max-w-sm gap-3">
			<input
				type="email"
				placeholder="Your email"
				className="flex-1 px-4 py-3 text-sm transition-all duration-300 focus:outline-none"
				style={{
					background: isDark ? "rgba(255,255,255,0.15)" : theme.surface,
					border: `1px solid ${isDark ? "rgba(255,255,255,0.3)" : theme.border}`,
					color: isDark ? "#ffffff" : theme.text,
					fontFamily: fonts.body,
					backdropFilter: isDark ? "blur(10px)" : undefined,
				}}
			/>
			<button
				className="px-6 py-3 text-sm tracking-widest uppercase transition-all duration-300 hover:scale-105"
				style={{
					background: theme.textOnPrimary,
					color: theme.primary,
					fontFamily: fonts.body,
				}}
			>
				{buttonText}
			</button>
		</div>
	);
}
