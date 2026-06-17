/**
 * Plan selection step — presents free, pack, and unlimited options,
 * then shows success state (absorbed from former ReadyStep).
 *
 * Internal state machine: initial → polling → retry/success.
 * Billing-disabled: renders success immediately (free-tier copy).
 */

import { ArrowRightIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/kbd";
import { checkoutErrorMessage } from "@/features/billing/error-copy";
import { billingKeys } from "@/features/billing/query-keys";
import { resolveSession } from "@/features/onboarding/step-resolver";
import {
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
} from "@/lib/domains/billing/offers";
import { formatOfferPrice } from "@/lib/domains/billing/pricing";
import {
	type BillingState,
	hasUnlimitedAccess,
} from "@/lib/domains/billing/state";
import { parseStripeCheckoutUrl } from "@/lib/domains/billing/stripe-redirects";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { useAnalytics } from "@/lib/observability/useAnalytics";
import { ONBOARDING_SESSION_QUERY_KEY } from "@/lib/platform/auth/query-keys";
import {
	createCheckoutSession,
	getBillingState,
	getPlanSelectionConfig,
	type PlanSelectionConfig,
} from "@/lib/server/billing.functions";
import {
	markOnboardingComplete,
	type ReadyCopyVariant,
	type SyncStats,
} from "@/lib/server/onboarding.functions";
import { fonts } from "@/lib/theme/fonts";
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

const FALLBACK_MESSAGE = "Just a moment. Setting things up for you.";

interface PlanSelectionStepProps {
	syncStats: SyncStats;
	readyCopyVariant: ReadyCopyVariant;
}

export function PlanSelectionStep({
	syncStats,
	readyCopyVariant,
}: PlanSelectionStepProps) {
	const analytics = useAnalytics();
	const [planState, setPlanState] = useState<PlanState>("initial");

	const [configState, setConfigState] = useState<ConfigState>({
		status: "loading",
	});
	const [activeCheckout, setActiveCheckout] = useState<CheckoutOffer | null>(
		null,
	);

	const [pendingIntent, setPendingIntent] = useState<CheckoutIntent | null>(
		null,
	);

	const { data: billingState } = useQuery<BillingState>({
		queryKey: billingKeys.state,
		queryFn: () => getBillingState(),
	});

	const pollingState = useCheckoutPolling(pendingIntent);

	useEffect(() => {
		const persistedIntent = loadCheckoutIntent();
		if (persistedIntent) {
			setPendingIntent(persistedIntent);
			setPlanState("polling");
		}
	}, []);

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
		analytics.capture("free_plan_selected");
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

		analytics.capture("checkout_started", {
			plan_kind: intent.kind,
			offer,
		});

		try {
			const result = await createCheckoutSession({
				data: { offer, checkoutAttemptId },
			});

			if (!result.success) {
				toast.error(checkoutErrorMessage(result.error));
				clearCheckoutIntent();
				setActiveCheckout(null);
				return;
			}

			const safeUrl = parseStripeCheckoutUrl(result.checkoutUrl);
			if (!safeUrl) {
				toast.error(checkoutErrorMessage("invalid_billing_redirect"));
				clearCheckoutIntent();
				setActiveCheckout(null);
				return;
			}

			saveCheckoutIntent(intent);
			window.location.href = safeUrl;
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
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Confirming
				</p>
				<h2
					className="theme-text mt-4 text-4xl leading-tight font-extralight"
					style={{ fontFamily: fonts.display }}
				>
					Confirming your purchase…
				</h2>
				<p
					className="theme-text-muted mt-6 text-base font-light animate-pulse"
					style={{ fontFamily: fonts.body }}
				>
					Waiting for {offerLabel} to activate.
				</p>
				<div className="mt-8 flex justify-center">
					<Button
						variant="link"
						size="sm"
						onClick={handleRetryPolling}
						className="theme-text-muted text-sm tracking-wide"
						style={{ fontFamily: fonts.body }}
					>
						Cancel and choose a different plan
					</Button>
				</div>
			</div>
		);
	}

	// ── Retry state ──
	if (planState === "retry") {
		return (
			<div className="text-center">
				<p
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Processing
				</p>
				<h2
					className="theme-text mt-4 text-4xl leading-tight font-extralight"
					style={{ fontFamily: fonts.display }}
				>
					Almost there.
				</h2>
				<p
					className="theme-text-muted mt-6 text-base font-light"
					style={{ fontFamily: fonts.body }}
				>
					{FALLBACK_MESSAGE}
				</p>
				<div className="mt-8 flex flex-col items-center gap-3">
					<Button
						variant="link"
						size="sm"
						onClick={handleRetryConfirmation}
						className="theme-primary text-sm tracking-wide"
						style={{ fontFamily: fonts.body }}
					>
						Retry confirmation
					</Button>
					<Button
						variant="link"
						size="sm"
						onClick={handleRetryPolling}
						className="theme-text-muted text-sm tracking-wide"
						style={{ fontFamily: fonts.body }}
					>
						Choose a different plan
					</Button>
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
					className="theme-text-muted text-lg font-light animate-pulse"
					style={{ fontFamily: fonts.body }}
				>
					Loading plans…
				</p>
			</div>
		);
	}

	if (configState.status === "error") {
		return (
			<div className="text-center">
				<p
					className="theme-text-muted text-lg font-light"
					style={{ fontFamily: fonts.body }}
				>
					Couldn't load plans right now. Try refreshing.
				</p>
			</div>
		);
	}

	const { quarterlyPlanEnabled } = configState.config;

	return (
		<div className="text-center">
			<p
				className="theme-text-muted text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Choose Your Plan
			</p>

			<h2
				className="theme-text mt-4 text-4xl leading-tight font-extralight"
				style={{ fontFamily: fonts.display }}
			>
				Unlock your library.
			</h2>

			<p
				className="theme-text-muted mt-4 text-base font-light"
				style={{ fontFamily: fonts.body }}
			>
				Every plan lets you see what's inside your liked songs.
			</p>

			<div className="mx-auto mt-12 flex max-w-lg flex-col gap-4">
				<PlanCard
					title="Free"
					price="$0"
					description="10 songs — yours to keep"
					buttonLabel="Continue Free"
					disabled={isBusy}
					onClick={handleFree}
				/>

				<PlanCard
					title="Song Pack"
					price={formatOfferPrice(SONG_PACK_500)}
					description="250 songs + 15 Instant Unlocks"
					buttonLabel={
						activeCheckout === SONG_PACK_500 ? "Redirecting..." : "Unlock Pack"
					}
					disabled={isBusy}
					highlighted
					onClick={() => handleCheckout(SONG_PACK_500)}
				/>

				<PlanCard
					title="Backstage Pass"
					price={formatOfferPrice(UNLIMITED_YEARLY)}
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
						title="Unlimited Quarterly"
						price={formatOfferPrice(UNLIMITED_QUARTERLY)}
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
	const router = useRouter();
	const queryClient = useQueryClient();
	const analytics = useAnalytics();
	const [isCompleting, setIsCompleting] = useState(false);

	const handleStart = async () => {
		setIsCompleting(true);
		try {
			const result = await markOnboardingComplete();

			// Patch the query cache with the authoritative session from the server
			// response so route guards read fresh state on the next navigation.
			queryClient.setQueryData(ONBOARDING_SESSION_QUERY_KEY, result.onboarding);

			if (result.status === "completed_now") {
				analytics.capture("onboarding_completed", {
					songs: syncStats.songs,
					playlists: syncStats.playlists,
				});
			}
			// already_complete and not_ready: patch cache + navigate via resolver,
			// no analytics (user already completed or not yet ready).

			const { allowedPath } = resolveSession(result.onboarding.session);
			await router.navigate({ to: allowedPath });
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
		<>
			<div className="text-center">
				<p
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Complete
				</p>
				<h2
					className="theme-text mt-4 text-6xl leading-tight font-extralight"
					style={{ fontFamily: fonts.display }}
				>
					You're <em className="font-normal">in.</em>
				</h2>

				<div className="mt-16">
					<p
						className="theme-text text-5xl font-extralight"
						style={{ fontFamily: fonts.display }}
					>
						{syncStats.songs}
					</p>
					<p
						className="theme-text-muted mt-2 text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Liked Songs
					</p>

					<div className="mt-10 flex justify-center gap-12">
						<div className="text-center">
							<p
								className="theme-text text-3xl font-extralight"
								style={{ fontFamily: fonts.display }}
							>
								{syncStats.playlists}
							</p>
							<p
								className="theme-text-muted mt-1 text-xs tracking-widest uppercase"
								style={{ fontFamily: fonts.body }}
							>
								Playlists
							</p>
						</div>
						<div className="text-center">
							<p
								className="theme-text text-3xl font-extralight"
								style={{ fontFamily: fonts.display }}
							>
								{syncStats.playlistSongs}
							</p>
							<p
								className="theme-text-muted mt-1 text-xs tracking-widest uppercase"
								style={{ fontFamily: fonts.body }}
							>
								Songs
							</p>
						</div>
						<div className="text-center">
							<p
								className="theme-text text-3xl font-extralight"
								style={{ fontFamily: fonts.display }}
							>
								{syncStats.artists}
							</p>
							<p
								className="theme-text-muted mt-1 text-xs tracking-widest uppercase"
								style={{ fontFamily: fonts.body }}
							>
								Artists
							</p>
						</div>
					</div>
				</div>

				<Button
					variant="link"
					onClick={handleStart}
					disabled={isCompleting}
					className="mt-20"
					style={{ fontFamily: fonts.body }}
				>
					<span className="text-xl font-medium tracking-wide">
						Start Exploring
					</span>
					<ArrowRightIcon
						size={16}
						className="theme-text-muted inline-block transition-transform group-hover:translate-x-1"
					/>
				</Button>
			</div>

			<div className="theme-kbd-scope fixed right-0 bottom-6 left-0 flex items-center justify-center gap-6 opacity-60">
				<div className="flex items-center gap-1.5">
					<Kbd>⏎</Kbd>
					<span className="text-xs">to start</span>
				</div>
			</div>
		</>
	);
}

function PlanCard({
	title,
	price,
	description,
	buttonLabel,
	disabled,
	highlighted,
	onClick,
}: {
	title: string;
	price: string;
	description: string;
	buttonLabel: string;
	disabled: boolean;
	highlighted?: boolean;
	onClick: () => void;
}) {
	return (
		<Button
			variant="card"
			onClick={onClick}
			disabled={disabled}
			style={{
				fontFamily: fonts.body,
				borderColor: highlighted ? "var(--t-primary)" : undefined,
			}}
		>
			<div>
				<p className="theme-text text-sm font-medium tracking-wide">{title}</p>
				<p className="theme-text-muted mt-1 text-xs">{description}</p>
			</div>
			<div className="flex items-center gap-3">
				<span
					className="theme-text text-lg font-light"
					style={{ fontFamily: fonts.display }}
				>
					{price}
				</span>
				<span className="theme-primary text-sm font-medium tracking-wide">
					{buttonLabel}
				</span>
			</div>
		</Button>
	);
}
