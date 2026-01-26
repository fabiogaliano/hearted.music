/**
 * Main onboarding orchestrator component.
 * Routes between steps and manages shared state (theme).
 */

import { useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { themes } from "@/lib/theme/colors";
import { type ThemeConfig, type ThemeColor, DEFAULT_THEME } from "@/lib/theme/types";
import { ONBOARDING_STEPS, type OnboardingStep } from "@/lib/data/preferences";
import { type OnboardingData } from "@/lib/server/onboarding.server";
import { WelcomeStep } from "./components/WelcomeStep";
import { PickColorStep } from "./components/PickColorStep";
import { ConnectingStep } from "./components/ConnectingStep";
import { SyncingStep } from "./components/SyncingStep";
import { FlagPlaylistsStep } from "./components/FlagPlaylistsStep";
import { ReadyStep } from "./components/ReadyStep";
import { StepContainer } from "./components/StepContainer";
import "./types"; // Import to ensure HistoryState augmentation is loaded

interface OnboardingProps {
	step: OnboardingStep;
	data: OnboardingData;
}

/** Steps that show in the progress indicator (excludes transient steps) */
const TRANSIENT_STEPS = new Set<OnboardingStep>(["connecting", "syncing", "complete"]);
const INDICATOR_STEPS = ONBOARDING_STEPS.options.filter((s) => !TRANSIENT_STEPS.has(s));

export function Onboarding({ step, data }: OnboardingProps) {
	const location = useLocation();
	// Use DEFAULT_THEME as UI default when user hasn't chosen (null in DB)
	const [localTheme, setLocalTheme] = useState<ThemeColor>(data.theme ?? DEFAULT_THEME);
	const theme = themes[localTheme];

	// FALLBACK PATTERN: Use navigation state if available, otherwise fall back to DB
	// Navigation state = 0 API calls during flow, DB = fallback on refresh
	const phaseJobIds = location.state?.phaseJobIds ?? data.phaseJobIds;
	// syncStats always comes from DB (efficient count query) - no navigation state needed
	const { syncStats } = data;

	// Check if this step needs full-bleed layout
	const fullBleed = step === "flag-playlists";

	return (
		<StepContainer theme={theme} fullBleed={fullBleed}>
			{/* Step Router */}
			{step === "welcome" && <WelcomeStep theme={theme} />}
			{step === "pick-color" && (
				<PickColorStep
					theme={theme}
					currentTheme={localTheme}
					setTheme={setLocalTheme}
				/>
			)}
			{step === "connecting" && <ConnectingStep theme={theme} />}
			{step === "syncing" && (
				<SyncingStep theme={theme} phaseJobIds={phaseJobIds} />
			)}
			{step === "flag-playlists" && (
				<FlagPlaylistsStep theme={theme} playlists={data.playlists} />
			)}
			{step === "ready" && <ReadyStep theme={theme} syncStats={syncStats} />}

			{/* Step indicator - minimal dots */}
			{step !== "connecting" && step !== "syncing" && (
				<StepIndicator currentStep={step} theme={theme} />
			)}
		</StepContainer>
	);
}

function StepIndicator({
	currentStep,
	theme,
}: {
	currentStep: OnboardingStep;
	theme: ThemeConfig;
}) {
	const stepIndex = INDICATOR_STEPS.indexOf(currentStep);

	return (
		<div className="mt-20 flex justify-center gap-3">
			{INDICATOR_STEPS.map((s, i) => (
				<div
					key={s}
					className="h-1.5 rounded-full transition-all"
					style={{
						width: currentStep === s ? "2rem" : "0.375rem",
						background: stepIndex >= i ? theme.text : theme.border,
					}}
				/>
			))}
		</div>
	);
}
