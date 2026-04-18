/**
 * Plan selection step — presents free, pack, and unlimited options,
 * then shows success state (absorbed from former ReadyStep).
 *
 * Internal state machine: initial → polling → retry/success.
 * Billing-disabled: renders success immediately (free-tier copy).
 */

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Kbd } from "@/components/ui/kbd";
import {
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
} from "@/lib/domains/billing/offers";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import {
	createCheckoutSession,
	getPlanSelectionConfig,
	type PlanSelectionConfig,
} from "@/lib/server/billing.functions";
import {
	markOnboardingComplete,
	type OnboardingData,
	type ReadyCopyVariant,
	type SyncStats,
} from "@/lib/server/onboarding.functions";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import {
	clearCheckoutIntent,
	loadCheckoutIntent,
	saveCheckoutIntent,
	type CheckoutIntent,
} from "../checkout-intent";
import { useCheckoutPolling } from "../hooks/useCheckoutPolling";

type ConfigState =
	| { status: "loading" }
	| { status: "loaded"; config: PlanSelectionConfig }
	| { status: "error" };

type CheckoutTarget =
	| typeof SONG_PACK_500
	| typeof UNLIMITED_QUARTERLY
	| typeof UNLIMITED_YEARLY;

type PlanState = "initial" | "polling" | "retry" | "success";

const READY_COPY: Record<ReadyCopyVariant, string> = {
	free: "Exploring your 15 songs. An email's on its way when it's ready.",
	pack: "Exploring your selected songs. An email's on its way when it's ready.",
	unlimited: "Going through every song. An email's on its way when it's ready.",
};

const ONBOARDING_QUERY_KEY = ["auth", "onboarding"] as const;

const FALLBACK_MESSAGE =
	"Your purchase is being processed. Your songs to explore will appear shortly.";

interface PlanSelectionStepProps {
	syncStats: SyncStats;
	readyCopyVariant: ReadyCopyVariant;
}

export function PlanSelectionStep({
	syncStats,
	readyCopyVariant,
}: PlanSelectionStepProps) {
	const theme = useTheme();

	const [planState, setPlanState] = useState<PlanState>(() => {
		// If returning from Stripe, start in polling
		if (loadCheckoutIntent()) return "polling";
		return "initial";
	});

	const [configState, setConfigState] = useState<ConfigState>({
		status: "loading",
	});
	const [activeCheckout, setActiveCheckout] = useState<CheckoutTarget | null>(
		null,
	);

	const [pendingIntent, setPendingIntent] = useState<CheckoutIntent | null>(
		() => loadCheckoutIntent(),
	);

	const pollingState = useCheckoutPolling(pendingIntent?.offer ?? null);

	// Fetch plan config on mount
	useEffect(() => {
		let cancelled = false;
		getPlanSelectionConfig()
			.then((config) => {
				if (cancelled) return;
				setConfigState({ status: "loaded", config });
				// Billing-disabled: skip to success immediately
				if (!config.billingEnabled) {
					setPlanState("success");
				}
			})
			.catch(() => {
				if (!cancelled) setConfigState({ status: "error" });
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// React to polling state transitions
	useEffect(() => {
		if (!pollingState) return;

		if (pollingState.status === "confirmed") {
			clearCheckoutIntent();
			setPendingIntent(null);
			setPlanState("success");
		} else if (pollingState.status === "timeout") {
			setPlanState("retry");
		}
	}, [pollingState]);

	const handleFree = () => {
		if (activeCheckout || pendingIntent) return;
		setPlanState("success");
	};

	const handleCheckout = async (offer: CheckoutTarget) => {
		if (activeCheckout || pendingIntent) return;
		setActiveCheckout(offer);

		const existingIntent = loadCheckoutIntent();
		const checkoutAttemptId =
			existingIntent?.offer === offer
				? existingIntent.checkoutAttemptId
				: crypto.randomUUID();

		const intent: CheckoutIntent = { offer, checkoutAttemptId };
		saveCheckoutIntent(intent);

		try {
			const result = await createCheckoutSession({
				data: { offer, checkoutAttemptId },
			});

			if (!result.success) {
				const message =
					result.error === "billing_disabled"
						? "Billing is not available right now."
						: result.error === "invalid_offer"
							? "Invalid plan selected."
							: "message" in result
								? result.message
								: "Something went wrong. Please try again.";
				toast.error(message);
				setActiveCheckout(null);
				return;
			}

			window.location.href = result.checkoutUrl;
		} catch {
			toast.error("Failed to start checkout. Please try again.");
			setActiveCheckout(null);
		}
	};

	const handleRetryPolling = () => {
		clearCheckoutIntent();
		setPendingIntent(null);
		setPlanState("initial");
	};

	const handleRetryConfirmation = () => {
		const intent = loadCheckoutIntent();
		if (intent) {
			setPendingIntent(intent);
			setPlanState("polling");
		}
	};

	// ── Success state (absorbed ReadyStep) ──
	if (planState === "success") {
		return (
			<SuccessView syncStats={syncStats} readyCopyVariant={readyCopyVariant} />
		);
	}

	// ── Polling state ──
	if (planState === "polling" && pendingIntent && pollingState) {
		const offerLabel =
			pendingIntent.offer === SONG_PACK_500
				? "Song Pack"
				: "Unlimited subscription";

		return (
			<div className="text-center">
				<p
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Confirming
				</p>
				<h2
					className="mt-4 text-4xl leading-tight font-extralight"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					Confirming your purchase...
				</h2>
				<p
					className="mt-6 text-base font-light animate-pulse"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Waiting for {offerLabel} to activate.
				</p>
			</div>
		);
	}

	// ── Retry state ──
	if (planState === "retry") {
		return (
			<div className="text-center">
				<p
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Processing
				</p>
				<h2
					className="mt-4 text-4xl leading-tight font-extralight"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					Almost there.
				</h2>
				<p
					className="mt-6 text-base font-light"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					{FALLBACK_MESSAGE}
				</p>
				<div className="mt-8 flex flex-col items-center gap-3">
					<button
						type="button"
						onClick={handleRetryConfirmation}
						className="text-sm font-medium tracking-wide"
						style={{ fontFamily: fonts.body, color: theme.primary }}
					>
						Retry confirmation
					</button>
					<button
						type="button"
						onClick={handleRetryPolling}
						className="text-sm font-medium tracking-wide"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						Choose a different plan
					</button>
				</div>
			</div>
		);
	}

	// ── Initial state (plan cards) ──
	const isBusy = activeCheckout !== null || pendingIntent !== null;

	if (configState.status === "loading") {
		return (
			<div className="text-center">
				<p
					className="text-lg font-light animate-pulse"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Loading plans...
				</p>
			</div>
		);
	}

	if (configState.status === "error") {
		return (
			<div className="text-center">
				<p
					className="text-lg font-light"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Failed to load plans. Please refresh the page.
				</p>
			</div>
		);
	}

	const { quarterlyPlanEnabled } = configState.config;

	return (
		<div className="text-center">
			<p
				className="text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Choose Your Plan
			</p>

			<h2
				className="mt-4 text-4xl leading-tight font-extralight"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				Unlock your library.
			</h2>

			<p
				className="mt-4 text-base font-light"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Every plan gives you deep analysis of every song you've liked.
			</p>

			<div className="mx-auto mt-12 flex max-w-lg flex-col gap-4">
				<PlanCard
					theme={theme}
					title="Free"
					price="$0"
					description="15 songs — yours to keep"
					buttonLabel="Continue Free"
					disabled={isBusy}
					onClick={handleFree}
				/>

				<PlanCard
					theme={theme}
					title="Song Pack"
					price="$5.99"
					description="500 songs + 25 Instant Unlocks"
					buttonLabel={
						activeCheckout === SONG_PACK_500 ? "Redirecting..." : "Unlock Pack"
					}
					disabled={isBusy}
					highlighted
					onClick={() => handleCheckout(SONG_PACK_500)}
				/>

				<PlanCard
					theme={theme}
					title="Backstage Pass"
					price="$39.99/yr"
					description="Every song, priority queue"
					buttonLabel={
						activeCheckout === UNLIMITED_YEARLY
							? "Redirecting..."
							: "Go Unlimited"
					}
					disabled={isBusy}
					onClick={() => handleCheckout(UNLIMITED_YEARLY)}
				/>

				{quarterlyPlanEnabled && (
					<PlanCard
						theme={theme}
						title="Unlimited Quarterly"
						price="$14.99/quarter"
						description="Every song, standard queue"
						buttonLabel={
							activeCheckout === UNLIMITED_QUARTERLY
								? "Redirecting..."
								: "Go Quarterly"
						}
						disabled={isBusy}
						onClick={() => handleCheckout(UNLIMITED_QUARTERLY)}
					/>
				)}
			</div>
		</div>
	);
}

function SuccessView({
	syncStats,
	readyCopyVariant,
}: {
	syncStats: SyncStats;
	readyCopyVariant: ReadyCopyVariant;
}) {
	const theme = useTheme();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [isCompleting, setIsCompleting] = useState(false);

	const handleStart = async () => {
		setIsCompleting(true);
		try {
			await markOnboardingComplete();
			queryClient.setQueryData<OnboardingData>(
				ONBOARDING_QUERY_KEY,
				(existing) => (existing ? { ...existing, isComplete: true } : existing),
			);
			await queryClient.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY });
			await navigate({ to: "/dashboard" });
		} catch (error) {
			console.error("Failed to complete onboarding:", error);
			toast.error("Failed to complete onboarding. Please try again.");
			setIsCompleting(false);
		}
	};

	useShortcut({
		key: "enter",
		handler: handleStart,
		description: "Start Exploring",
		scope: "onboarding-plan-selection",
		enabled: !isCompleting,
	});

	return (
		<div className="text-center">
			<p
				className="text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Complete
			</p>
			<h2
				className="mt-4 text-6xl leading-tight font-extralight"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				You're
				<br />
				<em className="font-normal">in.</em>
			</h2>
			<p
				className="mt-6 text-lg font-light"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				{READY_COPY[readyCopyVariant]}
			</p>

			<div className="mt-16 flex justify-center gap-16">
				<div className="text-center">
					<p
						className="text-5xl font-extralight"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						{syncStats.songs}
					</p>
					<p
						className="mt-2 text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						Songs
					</p>
				</div>
				<div className="text-center">
					<p
						className="text-5xl font-extralight"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						{syncStats.playlists}
					</p>
					<p
						className="mt-2 text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						Playlists
					</p>
				</div>
			</div>

			<button
				type="button"
				onClick={handleStart}
				disabled={isCompleting}
				className="group mt-20 inline-flex min-h-11 items-center gap-3"
				style={{
					fontFamily: fonts.body,
					color: theme.text,
					opacity: isCompleting ? 0.5 : 1,
				}}
			>
				<span className="text-xl font-medium tracking-wide">
					Start Exploring
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

function PlanCard({
	theme,
	title,
	price,
	description,
	buttonLabel,
	disabled,
	highlighted,
	onClick,
}: {
	theme: ReturnType<typeof useTheme>;
	title: string;
	price: string;
	description: string;
	buttonLabel: string;
	disabled: boolean;
	highlighted?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className="group flex w-full items-center justify-between rounded-lg px-6 py-5 text-left transition-opacity"
			style={{
				fontFamily: fonts.body,
				border: `1px solid ${highlighted ? theme.primary : theme.border}`,
				opacity: disabled ? 0.5 : 1,
			}}
		>
			<div>
				<p
					className="text-sm font-medium tracking-wide"
					style={{ color: theme.text }}
				>
					{title}
				</p>
				<p className="mt-1 text-xs" style={{ color: theme.textMuted }}>
					{description}
				</p>
			</div>
			<div className="flex items-center gap-3">
				<span
					className="text-lg font-light"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					{price}
				</span>
				<span
					className="text-sm font-medium tracking-wide"
					style={{ color: theme.primary }}
				>
					{buttonLabel}
				</span>
			</div>
		</button>
	);
}
