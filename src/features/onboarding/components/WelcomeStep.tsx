/**
 * Welcome step - first step in onboarding flow.
 * Creates sync job when user clicks "Get Started".
 */

import { useState } from "react";
import { toast } from "sonner";
import { fonts } from "@/lib/theme/fonts";
import { type ThemeConfig } from "@/lib/theme/types";
import { createSyncJob } from "@/lib/server/onboarding.server";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";

interface WelcomeStepProps {
	theme: ThemeConfig;
}

export function WelcomeStep({ theme }: WelcomeStepProps) {
	const { goToStep } = useOnboardingNavigation();
	const [isCreatingJob, setIsCreatingJob] = useState(false);

	const handleContinue = async () => {
		setIsCreatingJob(true);
		try {
			// Create 3 sync jobs (one per phase)
			const phaseJobIds = await createSyncJob();

			// Navigate to pick-color and save phaseJobIds in navigation state
			await goToStep("pick-color", { phaseJobIds });
		} catch (error) {
			console.error("Failed to create sync jobs:", error);
			toast.error("Failed to start. Please try again.");
		} finally {
			setIsCreatingJob(false);
		}
	};

	return (
		<div className="text-center">
			{/* Large editorial headline */}
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

			{/* Text-based CTA */}
			<button
				onClick={handleContinue}
				disabled={isCreatingJob}
				type="button"
				className="group mt-16 inline-flex items-center gap-3"
				style={{
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

			<p
				className="mt-12 text-sm tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Free to use
			</p>
		</div>
	);
}
