/**
 * Main onboarding orchestrator component.
 * Routes between steps and manages shared state (theme).
 */

import { useLocation } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { ONBOARDING_STEPS, type OnboardingStep } from "@/lib/data/preferences";
import type { PhaseJobIds } from "@/lib/jobs/progress/types";
import type { OnboardingData } from "@/lib/server/onboarding.functions";
import { themes } from "@/lib/theme/colors";
import { useRegisterTheme, useTheme } from "@/lib/theme/ThemeHueProvider";
import { DEFAULT_THEME, type ThemeColor } from "@/lib/theme/types";
import { AnimatedStep } from "./components/AnimatedStep";
import { FlagPlaylistsStep } from "./components/FlagPlaylistsStep";
import { InstallExtensionStep } from "./components/InstallExtensionStep";
import { PickColorStep } from "./components/PickColorStep";
import { ReadyStep } from "./components/ReadyStep";
import { StepContainer } from "./components/StepContainer";
import { SyncingStep } from "./components/SyncingStep";
import { WelcomeStep } from "./components/WelcomeStep";
import "./types"; // Import to ensure HistoryState augmentation is loaded

interface OnboardingProps {
	step: OnboardingStep;
	data: OnboardingData;
}

interface StepContext {
	localTheme: ThemeColor;
	setLocalTheme: (theme: ThemeColor) => void;
	phaseJobIds: PhaseJobIds | null;
	playlists: OnboardingData["playlists"];
	syncStats: OnboardingData["syncStats"];
}

interface StepConfig {
	render: (ctx: StepContext) => React.ReactNode;
	fullBleed?: boolean;
	hideIndicator?: boolean;
}

const STEP_CONFIG: Record<OnboardingStep, StepConfig> = {
	welcome: {
		render: () => <WelcomeStep />,
	},
	"pick-color": {
		render: (ctx) => (
			<PickColorStep
				currentTheme={ctx.localTheme}
				setTheme={ctx.setLocalTheme}
			/>
		),
	},
	"install-extension": {
		render: () => <InstallExtensionStep />,
	},
	syncing: {
		render: (ctx) => <SyncingStep phaseJobIds={ctx.phaseJobIds} />,
		hideIndicator: true,
	},
	"flag-playlists": {
		render: (ctx) => <FlagPlaylistsStep playlists={ctx.playlists} />,
		fullBleed: true,
	},
	ready: {
		render: (ctx) => <ReadyStep syncStats={ctx.syncStats} />,
	},
	complete: {
		render: () => null, // Handled by redirect
		hideIndicator: true,
	},
};

/** Steps that show in the progress indicator */
const INDICATOR_STEPS = ONBOARDING_STEPS.options.filter(
	(s) => !STEP_CONFIG[s].hideIndicator,
);

export function Onboarding({ step, data }: OnboardingProps) {
	const location = useLocation();
	const [localTheme, setLocalTheme] = useState<ThemeColor>(
		data.theme ?? DEFAULT_THEME,
	);

	// Onboarding owns theme registration - starts with default (rose),
	// updates live as user picks colors in PickColorStep
	useRegisterTheme(themes[localTheme]);

	const locationPhaseJobIds = location.state?.phaseJobIds;
	const phaseJobIds =
		locationPhaseJobIds !== undefined ? locationPhaseJobIds : data.phaseJobIds;

	const stepContext: StepContext = {
		localTheme,
		setLocalTheme,
		phaseJobIds,
		playlists: data.playlists,
		syncStats: data.syncStats,
	};

	const config = STEP_CONFIG[step];

	return (
		<StepContainer fullBleed={config.fullBleed}>
			<AnimatePresence mode="wait">
				<AnimatedStep stepKey={step}>{config.render(stepContext)}</AnimatedStep>
			</AnimatePresence>

			{!config.hideIndicator && <StepIndicator currentStep={step} />}
		</StepContainer>
	);
}

/** Editorial tween for indicator - deliberate, no bounce */
const indicatorTransition = {
	type: "tween" as const,
	duration: 0.3,
	ease: [0.25, 0.1, 0.25, 1] as const, // ease-out-quart: elegant deceleration
};

function StepIndicator({ currentStep }: { currentStep: OnboardingStep }) {
	const theme = useTheme();
	const stepIndex = INDICATOR_STEPS.indexOf(currentStep);
	const shouldReduceMotion = useReducedMotion();

	return (
		<div className="mt-20 flex justify-center gap-3">
			{INDICATOR_STEPS.map((s, i) => (
				<motion.div
					key={s}
					layout={!shouldReduceMotion}
					transition={shouldReduceMotion ? undefined : indicatorTransition}
					className="h-1.5 rounded-full"
					style={{
						width: currentStep === s ? "2rem" : "0.375rem",
						background: stepIndex >= i ? theme.text : theme.border,
					}}
				/>
			))}
		</div>
	);
}
