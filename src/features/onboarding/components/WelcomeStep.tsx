/**
 * Welcome step - first step in onboarding flow.
 * Navigates to pick-color when user clicks "Get Started".
 */

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

	return (
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
				Organize your music library with AI-powered playlist matching
			</p>

			<button
				onClick={handleContinue}
				disabled={isNavigating}
				type="button"
				className="group mt-16 inline-flex min-h-11 items-center gap-3 border border-transparent px-4 py-2 transition-all duration-200"
				style={{
					fontFamily: fonts.body,
					color: theme.text,
					opacity: isNavigating ? 0.5 : 1,
				}}
			>
				<span className="text-lg font-medium tracking-wide">Get Started</span>
				<span
					className="inline-block transition-transform group-hover:translate-x-1"
					style={{ color: theme.textMuted }}
				>
					→
				</span>
			</button>

			<div className="mt-4 flex items-center justify-center gap-1.5">
				<span
					className="text-xs"
					style={{ color: theme.textMuted, opacity: 0.6 }}
				>
					or press
				</span>
				<Kbd
					style={{
						color: theme.textMuted,
						backgroundColor: `${theme.text}10`,
						border: `1px solid ${theme.textMuted}30`,
						boxShadow: `0 1px 0 ${theme.textMuted}20`,
					}}
				>
					⏎
				</Kbd>
			</div>
		</div>
	);
}
