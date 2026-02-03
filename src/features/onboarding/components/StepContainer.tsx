/**
 * Shared layout wrapper for onboarding steps.
 * Handles background color and centering.
 */

import type { ReactNode } from "react";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

/** Shared duration for theme color transitions (background + selection ring) */
export const THEME_TRANSITION_MS = 500;

interface StepContainerProps {
	children: ReactNode;
	fullBleed?: boolean;
}

export function StepContainer({
	children,
	fullBleed = false,
}: StepContainerProps) {
	const theme = useTheme();
	return (
		<div
			className={
				fullBleed
					? "h-screen overflow-hidden"
					: "min-h-screen overflow-x-hidden pb-[env(safe-area-inset-bottom)]"
			}
			style={{
				background: theme.bg,
				transition: `background ${THEME_TRANSITION_MS}ms ease-out`,
			}}
		>
			<div
				className={`${fullBleed ? "" : "flex min-h-screen items-center justify-center px-6 pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))]"}`}
			>
				<div className={`${fullBleed ? "w-full" : "w-full max-w-2xl"}`}>
					{children}
				</div>
			</div>
		</div>
	);
}
