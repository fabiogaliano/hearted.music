/**
 * Welcome step - first step in onboarding flow.
 * Creates sync job when user clicks "Get Started".
 */

import { useState } from "react";
import { toast } from "sonner";
import { fonts } from "@/lib/theme/fonts";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import type { ThemeConfig } from "@/lib/theme/types";
import { createSyncJob } from "@/lib/server/onboarding.server";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";
import { Kbd } from "@/components/ui/kbd";

interface WelcomeStepProps {
	theme: ThemeConfig;
}

export function WelcomeStep({ theme }: WelcomeStepProps) {
	const { goToStep } = useOnboardingNavigation();
	const [isCreatingJob, setIsCreatingJob] = useState(false);

	const handleContinue = async () => {
		setIsCreatingJob(true);
		try {
			const phaseJobIds = await createSyncJob();

			// Don't reset isCreatingJob on success - component unmounts during transition
			await goToStep("pick-color", { phaseJobIds });
		} catch (error) {
			console.error("Failed to create sync jobs:", error);
			toast.error("Failed to start. Please try again.");
			// Only reset on error so user can retry
			setIsCreatingJob(false);
		}
	};

	useShortcut({
		key: "enter",
		handler: handleContinue,
		description: "Continue",
		scope: "onboarding-welcome",
		enabled: !isCreatingJob,
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
				disabled={isCreatingJob}
				type="button"
				className="group mt-16 inline-flex min-h-11 items-center gap-3 rounded-lg border border-transparent px-4 py-2 outline-2 outline-offset-2 outline-transparent transition-all duration-200 focus-visible:outline-(--focus-color)"
				style={{
					["--focus-color" as string]: theme.text,
					fontFamily: fonts.body,
					color: theme.text,
					opacity: isCreatingJob ? 0.5 : 1,
				}}
			>
				<span className="text-lg font-medium tracking-wide">
					{isCreatingJob ? "Starting..." : "Get Started"}
				</span>
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
