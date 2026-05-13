/**
 * Plan selection step — presents free, pack, and unlimited options,
 * then shows success state (absorbed from former ReadyStep).
 *
 * Internal state machine: initial → polling → retry/success.
 * Billing-disabled: renders success immediately (free-tier copy).
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type React from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Kbd } from "@/components/ui/kbd";
import { billingKeys } from "@/features/billing/query-keys";
import {
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
} from "@/lib/domains/billing/offers";
import {
	type BillingState,
	hasUnlimitedAccess,
} from "@/lib/domains/billing/state";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import {
	createCheckoutSession,
	getBillingState,
	getPlanSelectionConfig,
	type PlanSelectionConfig,
} from "@/lib/server/billing.functions";
import {
	getOnboardingSession,
	markOnboardingComplete,
	type ReadyCopyVariant,
	type SyncStats,
} from "@/lib/server/onboarding.functions";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import {
	type CheckoutIntent,
	type CheckoutOffer,
	clearCheckoutIntent,
	loadCheckoutIntent,
	saveCheckoutIntent,
} from "../checkout-intent";
import { useCheckoutPolling } from "../hooks/useCheckoutPolling";

type ConfigState =
	| { status: "loading" }
	| { status: "loaded"; config: PlanSelectionConfig }
	| { status: "error" };

type PlanState = "initial" | "polling" | "retry" | "success";

const ONBOARDING_SESSION_QUERY_KEY = ["auth", "onboarding-session"] as const;

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
	const [activeCheckout, setActiveCheckout] = useState<CheckoutOffer | null>(
		null,
	);

	const [pendingIntent, setPendingIntent] = useState<CheckoutIntent | null>(
		() => loadCheckoutIntent(),
	);

	const { data: billingState } = useQuery<BillingState>({
		queryKey: billingKeys.state,
		queryFn: () => getBillingState(),
	});

	const pollingState = useCheckoutPolling(pendingIntent);

	// Fetch plan config on mount
	useEffect(() => {
		let cancelled = false;
		getPlanSelectionConfig()
			.then((config) => {
				if (cancelled) return;
				setConfigState({ status: "loaded", config });
				// Billing-disabled: skip to success immediately. Also drop any
				// persisted intent so a leftover checkout-return doesn't keep
				// polling and flip the UI to "retry" on timeout.
				if (!config.billingEnabled) {
					clearCheckoutIntent();
					setPendingIntent(null);
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

	// On reload after a completed purchase, billing state is the durable signal
	// that the user already paid — skip the plan cards and show success.
	useEffect(() => {
		if (planState !== "initial" || !billingState) return;
		if (hasUnlimitedAccess(billingState) || billingState.creditBalance > 0) {
			setPlanState("success");
		}
	}, [billingState, planState]);

	const handleFree = () => {
		if (activeCheckout || pendingIntent) return;
		setPlanState("success");
	};

	const handleCheckout = async (offer: CheckoutOffer) => {
		if (activeCheckout || pendingIntent) return;
		if (!billingState) return;
		setActiveCheckout(offer);

		const existingIntent = loadCheckoutIntent();
		const checkoutAttemptId =
			existingIntent?.offer === offer
				? existingIntent.checkoutAttemptId
				: crypto.randomUUID();

		const intent: CheckoutIntent =
			offer === SONG_PACK_500
				? {
						kind: "pack",
						offer,
						checkoutAttemptId,
						baselineCreditBalance: billingState.creditBalance,
					}
				: { kind: "unlimited", offer, checkoutAttemptId };

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
				clearCheckoutIntent();
				setActiveCheckout(null);
				return;
			}

			saveCheckoutIntent(intent);
			window.location.href = result.checkoutUrl;
		} catch {
			toast.error("Failed to start checkout. Please try again.");
			clearCheckoutIntent();
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
					description="10 songs — yours to keep"
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
			// Refetch the authoritative session so `/_authenticated`'s
			// beforeLoad reads `session.status === "complete"` on the next
			// navigation — replaces the legacy mutation of a no-longer-read
			// `["auth", "onboarding"]` / `isComplete` cache shape.
			await queryClient.fetchQuery({
				queryKey: ONBOARDING_SESSION_QUERY_KEY,
				queryFn: () => getOnboardingSession(),
			});
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

	const kbdVars = {
		"--kbd-text-color": theme.textMuted,
		"--kbd-bg-color": `${theme.text}10`,
		"--kbd-border-color": `${theme.textMuted}30`,
		"--kbd-shadow-color": `${theme.textMuted}20`,
	} as React.CSSProperties;

	return (
		<>
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
					You're <em className="font-normal">in.</em>
				</h2>

				<div className="mt-16">
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
						Liked Songs
					</p>

					<div className="mt-10 flex justify-center gap-12">
						<div className="text-center">
							<p
								className="text-3xl font-extralight"
								style={{ fontFamily: fonts.display, color: theme.text }}
							>
								{syncStats.playlists}
							</p>
							<p
								className="mt-1 text-xs tracking-widest uppercase"
								style={{ fontFamily: fonts.body, color: theme.textMuted }}
							>
								Playlists
							</p>
						</div>
						<div className="text-center">
							<p
								className="text-3xl font-extralight"
								style={{ fontFamily: fonts.display, color: theme.text }}
							>
								{syncStats.playlistSongs}
							</p>
							<p
								className="mt-1 text-xs tracking-widest uppercase"
								style={{ fontFamily: fonts.body, color: theme.textMuted }}
							>
								Songs
							</p>
						</div>
						<div className="text-center">
							<p
								className="text-3xl font-extralight"
								style={{ fontFamily: fonts.display, color: theme.text }}
							>
								{syncStats.artists}
							</p>
							<p
								className="mt-1 text-xs tracking-widest uppercase"
								style={{ fontFamily: fonts.body, color: theme.textMuted }}
							>
								Artists
							</p>
						</div>
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
			</div>

			<div
				className="fixed bottom-6 left-0 right-0 flex items-center justify-center gap-6"
				style={{ color: theme.textMuted, opacity: 0.6, ...kbdVars }}
			>
				<div className="flex items-center gap-1.5">
					<Kbd>⏎</Kbd>
					<span className="text-xs">to start</span>
				</div>
			</div>
		</>
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
