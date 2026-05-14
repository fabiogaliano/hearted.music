/**
 * ReleaseToggle - Floating toggle for switching UI modes
 *
 * Allows switching between "released" (login) and "pre-release" (waitlist) modes.
 * Positioned fixed in bottom-right corner.
 */

import { fonts } from "@/lib/theme/fonts";

export interface ReleaseToggleProps {
	isReleased: boolean;
	onToggle: () => void;
}

export function ReleaseToggle({ isReleased, onToggle }: ReleaseToggleProps) {
	return (
		<div
			className="theme-border-color fixed right-6 bottom-6 z-50 flex items-center gap-3 rounded-full border px-4 py-2 shadow-lg backdrop-blur-sm transition-transform duration-200 hover:scale-105 active:scale-[0.98]"
			style={{
				background: "color-mix(in srgb, var(--t-surface) 94%, transparent)",
				fontFamily: fonts.body,
			}}
		>
			<span className="theme-text-muted text-xs tracking-wider uppercase">
				{isReleased ? "Released" : "Pre-release"}
			</span>
			<button
				type="button"
				onClick={onToggle}
				className="relative h-6 w-11 rounded-full transition-colors duration-200"
				style={{
					background: isReleased ? "var(--t-primary)" : "var(--t-border)",
				}}
				aria-label={`Switch to ${isReleased ? "pre-release" : "released"} mode`}
			>
				<span
					className="absolute top-0.5 h-5 w-5 rounded-full transition-[left] duration-200"
					style={{
						background: "var(--t-text-on-primary)",
						left: isReleased ? "22px" : "2px",
						boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
					}}
				/>
			</button>
		</div>
	);
}
