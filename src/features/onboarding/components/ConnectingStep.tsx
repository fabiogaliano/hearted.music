/**
 * Connecting step - brief branding moment with auto-transition.
 * Shows minimal "Linking to Spotify" UI before syncing.
 */

import { useEffect, useEffectEvent } from "react";
import { toast } from "sonner";
import { fonts } from "@/lib/theme/fonts";
import { type ThemeConfig } from "@/lib/theme/types";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";

interface ConnectingStepProps {
	theme: ThemeConfig;
}

export function ConnectingStep({ theme }: ConnectingStepProps) {
	const { goToStep } = useOnboardingNavigation();

	// Event handler for auto-transition - reads latest goToStep without re-triggering effect
	const onAutoTransition = useEffectEvent(async () => {
		try {
			await goToStep("syncing");
		} catch {
			toast.error("Something went wrong. Please refresh the page.");
		}
	});

	// Auto-transition to syncing after brief moment
	useEffect(() => {
		const timer = setTimeout(onAutoTransition, 200);
		return () => clearTimeout(timer);
	}, []);

	return (
		<div className="text-center">
			<p
				className="text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Connecting
			</p>

			<h2
				className="mt-4 text-5xl leading-tight font-extralight"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				Linking to
				<br />
				<span className="font-normal">Spotify</span>
			</h2>

			{/* Minimal loading indicator */}
			<div className="mt-16 flex justify-center gap-2">
				{[0, 1, 2].map((i) => (
					<div
						key={i}
						className="h-2 w-2 animate-pulse rounded-full"
						style={{
							background: theme.text,
							animationDelay: `${i * 200}ms`,
						}}
					/>
				))}
			</div>
		</div>
	);
}
