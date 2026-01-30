/**
 * ReleaseToggle - Floating toggle for switching UI modes
 *
 * Allows switching between "released" (login) and "pre-release" (waitlist) modes.
 * Positioned fixed in bottom-right corner.
 */
import type { ThemeConfig } from "@/lib/theme/types";
import { fonts } from "@/lib/theme/fonts";

export interface ReleaseToggleProps {
	theme: ThemeConfig;
	isReleased: boolean;
	onToggle: () => void;
}

export function ReleaseToggle({
	theme,
	isReleased,
	onToggle,
}: ReleaseToggleProps) {
	return (
		<div
			className="fixed right-6 bottom-6 z-50 flex items-center gap-3 rounded-full px-4 py-2 shadow-lg backdrop-blur-sm transition-all duration-300 hover:scale-105"
			style={{
				background: `${theme.surface}f0`,
				border: `1px solid ${theme.border}`,
				fontFamily: fonts.body,
			}}
		>
			<span
				className="text-xs tracking-wider uppercase"
				style={{ color: theme.textMuted }}
			>
				{isReleased ? "Released" : "Pre-release"}
			</span>
			<button
				onClick={onToggle}
				className="relative h-6 w-11 rounded-full transition-colors duration-300"
				style={{
					background: isReleased ? theme.primary : theme.border,
				}}
				aria-label={`Switch to ${isReleased ? "pre-release" : "released"} mode`}
			>
				<span
					className="absolute top-0.5 h-5 w-5 rounded-full transition-all duration-300"
					style={{
						background: theme.textOnPrimary,
						left: isReleased ? "22px" : "2px",
						boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
					}}
				/>
			</button>
		</div>
	);
}
