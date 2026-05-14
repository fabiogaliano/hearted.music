import type { ReactNode } from "react";

export const THEME_TRANSITION_MS = 500;

interface StepContainerProps {
	children: ReactNode;
	fullBleed?: boolean;
}

export function StepContainer({
	children,
	fullBleed = false,
}: StepContainerProps) {
	return (
		<div
			className={
				fullBleed
					? "theme-bg h-screen overflow-hidden"
					: "theme-bg min-h-screen overflow-x-hidden pb-[env(safe-area-inset-bottom)]"
			}
			style={{ transition: `background ${THEME_TRANSITION_MS}ms ease-out` }}
		>
			<div
				className={`${fullBleed ? "" : "flex min-h-screen items-center justify-center px-6 pr-[max(1.5rem,env(safe-area-inset-right))] pl-[max(1.5rem,env(safe-area-inset-left))]"}`}
			>
				<div className={`${fullBleed ? "w-full" : "w-full max-w-2xl"}`}>
					{children}
				</div>
			</div>
		</div>
	);
}
