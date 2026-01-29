/**
 * Shared layout wrapper for onboarding steps.
 * Handles background color and centering.
 */

import type { ReactNode } from "react";
import type { ThemeConfig } from "@/lib/theme/types";

interface StepContainerProps {
	theme: ThemeConfig;
	children: ReactNode;
	fullBleed?: boolean;
}

export function StepContainer({
	theme,
	children,
	fullBleed = false,
}: StepContainerProps) {
	return (
		<div
			className={
				fullBleed
					? "h-screen overflow-hidden"
					: "min-h-screen overflow-x-hidden"
			}
			style={{ background: theme.bg }}
		>
			{/* Wrapper for non-full-bleed steps */}
			<div
				className={`${fullBleed ? "" : "flex min-h-screen items-center justify-center px-6"}`}
			>
				<div className={`${fullBleed ? "w-full" : "w-full max-w-2xl"}`}>
					{children}
				</div>
			</div>
		</div>
	);
}
