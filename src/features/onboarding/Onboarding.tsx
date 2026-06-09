/**
 * Main onboarding orchestrator component.
 * Routes between steps and manages shared state (theme).
 */

import { useLocation } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { LandingSongManifest } from "@/lib/content/landing/landing-songs";
import type { ClaimHandleSeed } from "@/lib/domains/library/accounts/claim-handle-seed";
import {
	ONBOARDING_STEP_VALUES,
	type OnboardingStep,
} from "@/lib/domains/library/accounts/onboarding-steps";
import type { PhaseJobIds } from "@/lib/platform/jobs/progress/types";
import type {
	OnboardingData,
	ReadyCopyVariant,
} from "@/lib/server/onboarding.functions";
import { useAuthenticatedTheme } from "@/lib/theme/authenticated-theme";
import type { ThemeColor } from "@/lib/theme/types";
import { AnimatedStep } from "./components/AnimatedStep";
import { FlagPlaylistsStep } from "./components/FlagPlaylistsStep";
import { InstallExtensionStep } from "./components/InstallExtensionStep";
import { PickColorStep } from "./components/PickColorStep";
import { PickDemoSongStep } from "./components/PickDemoSongStep";
import { PlanSelectionStep } from "./components/PlanSelectionStep";
import { StepContainer } from "./components/StepContainer";

import { SyncingStep } from "./components/SyncingStep";
import { WelcomeStep } from "./components/WelcomeStep";
import "./types"; // Import to ensure HistoryState augmentation is loaded

interface OnboardingProps {
	step: OnboardingStep;
	data: OnboardingData;
	accountId: string;
}

interface StepContext {
	accountId: string;
	claimHandleSeed: ClaimHandleSeed;
	localTheme: ThemeColor;
	setLocalTheme: (theme: ThemeColor) => void;
	phaseJobIds: PhaseJobIds | null;
	playlists: OnboardingData["playlists"];
	landingSongs: LandingSongManifest[];
	syncStats: OnboardingData["syncStats"];
	readyCopyVariant: ReadyCopyVariant;
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
	// UI component wired in Task 11
	"claim-handle": {
		render: () => null,
	},
	"flag-playlists": {
		render: (ctx) => <FlagPlaylistsStep playlists={ctx.playlists} />,
		fullBleed: true,
	},
	"pick-demo-song": {
		render: (ctx) => <PickDemoSongStep songs={ctx.landingSongs} />,
		fullBleed: true,
	},
	"song-walkthrough": {
		render: () => null,
		hideIndicator: true,
	},
	"match-walkthrough": {
		render: () => null,
		hideIndicator: true,
	},
	"plan-selection": {
		render: (ctx) => (
			<PlanSelectionStep
				syncStats={ctx.syncStats}
				readyCopyVariant={ctx.readyCopyVariant}
			/>
		),
	},
	complete: {
		render: () => null, // Handled by redirect
		hideIndicator: true,
	},
};

/** Steps that show in the progress indicator */
const INDICATOR_STEPS = ONBOARDING_STEP_VALUES.filter(
	(s) => !STEP_CONFIG[s].hideIndicator,
);

export function Onboarding({ step, data, accountId }: OnboardingProps) {
	const location = useLocation();
	const { themeColor, setThemeColor } = useAuthenticatedTheme();

	const locationPhaseJobIds = location.state?.phaseJobIds;
	const phaseJobIds =
		locationPhaseJobIds !== undefined ? locationPhaseJobIds : data.phaseJobIds;

	const stepContext: StepContext = {
		accountId,
		claimHandleSeed: data.claimHandleSeed,
		localTheme: themeColor,
		setLocalTheme: setThemeColor,
		phaseJobIds,
		playlists: data.playlists,
		landingSongs: data.landingSongs,
		syncStats: data.syncStats,
		readyCopyVariant: data.readyCopyVariant,
	};

	const config = STEP_CONFIG[step];

	return (
		<StepContainer fullBleed={config.fullBleed}>
			<AnimatePresence mode="wait">
				<AnimatedStep stepKey={step}>{config.render(stepContext)}</AnimatedStep>
			</AnimatePresence>

			{!config.hideIndicator && !config.fullBleed && (
				<StepIndicator currentStep={step} />
			)}
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
	const stepIndex = INDICATOR_STEPS.indexOf(currentStep);
	const shouldReduceMotion = useReducedMotion();

	return (
		<div className="pointer-events-none fixed right-0 bottom-24 left-0 z-10 flex justify-center gap-3">
			{INDICATOR_STEPS.map((s, i) => (
				<motion.div
					key={s}
					layout={shouldReduceMotion ? undefined : true}
					transition={shouldReduceMotion ? undefined : indicatorTransition}
					className="h-1.5 rounded-full"
					style={{
						width: currentStep === s ? "2rem" : "0.375rem",
						background: stepIndex >= i ? "var(--t-text)" : "var(--t-border)",
					}}
				/>
			))}
		</div>
	);
}
