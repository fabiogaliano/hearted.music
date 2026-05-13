/**
 * Welcome step - first step in onboarding flow.
 * Navigates to pick-color when user clicks "Get Started".
 */

import type React from "react";
import { useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";

export function WelcomeStep() {
	const theme = useTheme();
	const { goToStep } = useOnboardingNavigation();
	const [isNavigating, setIsNavigating] = useState(false);

	const handleContinue = async () => {
		if (isNavigating) return;
		setIsNavigating(true);
		try {
			await goToStep("pick-color");
		} catch {
			setIsNavigating(false);
		}
	};

	useShortcut({
		key: "enter",
		handler: handleContinue,
		description: "Continue",
		scope: "onboarding-welcome",
		enabled: !isNavigating,
	});

	const kbdVars = {
		"--kbd-text-color": theme.textMuted,
		"--kbd-bg-color": `${theme.text}10`,
		"--kbd-border-color": `${theme.textMuted}30`,
		"--kbd-shadow-color": `${theme.textMuted}20`,
	} as React.CSSProperties;

	return (
		<>
			<div className="text-center">
				<h1
					className="text-8xl leading-none font-extralight tracking-tight"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					hearted.
				</h1>
				<p
					className="mt-6 text-xl font-light tracking-wide"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Your songs have been waiting.
				</p>

				<button
					onClick={handleContinue}
					disabled={isNavigating}
					type="button"
					className="group mt-16 inline-flex min-h-11 items-center gap-3 border border-transparent px-4 py-2 transition-opacity duration-150 active:scale-[0.98]"
					style={{
						fontFamily: fonts.body,
						color: theme.text,
						opacity: isNavigating ? 0.5 : 1,
					}}
				>
					<span className="text-lg font-medium tracking-wide">Let's go</span>
					<span
						className="inline-block transition-transform group-hover:translate-x-1"
						style={{ color: theme.textMuted }}
					>
						→
					</span>
				</button>
			</div>

			<div
				className="fixed bottom-6 left-0 right-0 flex items-center justify-center gap-6"
				style={{ color: theme.textMuted, opacity: 0.6, ...kbdVars }}
			>
				<div className="flex items-center gap-1.5">
					<Kbd>⏎</Kbd>
					<span className="text-xs">to continue</span>
				</div>
			</div>
		</>
	);
}
