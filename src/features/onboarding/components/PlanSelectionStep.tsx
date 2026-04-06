/**
 * Plan selection step — presents free, pack, and unlimited options.
 * Only renders when BILLING_ENABLED=true (auto-skip handled by route loader).
 *
 * After Stripe checkout redirect, enters polling mode to detect billing
 * state update before navigating to ready.
 */

import { useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";
import {
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
} from "@/lib/domains/billing/offers";
import {
	createCheckoutSession,
	getPlanSelectionConfig,
	type PlanSelectionConfig,
} from "@/lib/server/billing.functions";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import {
	clearCheckoutIntent,
	loadCheckoutIntent,
	saveCheckoutIntent,
	type CheckoutIntent,
} from "../checkout-intent";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";
import {
	useCheckoutPolling,
	type CheckoutPollingState,
} from "../hooks/useCheckoutPolling";

type ConfigState =
	| { status: "loading" }
	| { status: "loaded"; config: PlanSelectionConfig }
	| { status: "error" };

type CheckoutTarget =
	| typeof SONG_PACK_500
	| typeof UNLIMITED_QUARTERLY
	| typeof UNLIMITED_YEARLY;

const FALLBACK_MESSAGE =
	"Your purchase is being processed. Your songs to explore will appear shortly.";

const AUTO_NAVIGATE_DELAY_MS = 2_000;

export function PlanSelectionStep() {
	const theme = useTheme();
	const { goToStep } = useOnboardingNavigation();
	const [configState, setConfigState] = useState<ConfigState>({
		status: "loading",
	});
	const [activeCheckout, setActiveCheckout] = useState<CheckoutTarget | null>(
		null,
	);
	const [isNavigatingFree, setIsNavigatingFree] = useState(false);

	// Recover pending checkout from sessionStorage after Stripe redirect
	const [pendingIntent, setPendingIntent] = useState<CheckoutIntent | null>(
		() => loadCheckoutIntent(),
	);

	const pollingState = useCheckoutPolling(pendingIntent?.offer ?? null);

	useEffect(() => {
		let cancelled = false;
		getPlanSelectionConfig()
			.then((config) => {
				if (!cancelled) setConfigState({ status: "loaded", config });
			})
			.catch(() => {
				if (!cancelled) setConfigState({ status: "error" });
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const navigateToReady = useEffectEvent(() => {
		clearCheckoutIntent();
		goToStep("ready");
	});

	// Auto-navigate after confirmation or timeout
	useEffect(() => {
		if (!pollingState) return;
		if (pollingState.status === "polling") return;

		const timer = setTimeout(navigateToReady, AUTO_NAVIGATE_DELAY_MS);
		return () => clearTimeout(timer);
	}, [pollingState]);

	const handleFree = async () => {
		if (isNavigatingFree || activeCheckout || pendingIntent) return;
		setIsNavigatingFree(true);
		try {
			await goToStep("ready");
		} catch {
			setIsNavigatingFree(false);
		}
	};

	const handleCheckout = async (offer: CheckoutTarget) => {
		if (activeCheckout || isNavigatingFree || pendingIntent) return;
		setActiveCheckout(offer);

		// Reuse checkoutAttemptId from a previous intent for the same offer
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

	// Post-checkout polling UI
	if (pendingIntent && pollingState) {
		return (
			<PostCheckoutView
				theme={theme}
				pollingState={pollingState}
				offer={pendingIntent.offer}
				onRetry={() => {
					clearCheckoutIntent();
					setPendingIntent(null);
				}}
			/>
		);
	}

	const isBusy =
		isNavigatingFree || activeCheckout !== null || pendingIntent !== null;

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
				{/* Free */}
				<PlanCard
					theme={theme}
					title="Free"
					price="$0"
					description="15 songs — yours to keep"
					buttonLabel={isNavigatingFree ? "Continuing..." : "Continue Free"}
					disabled={isBusy}
					onClick={handleFree}
				/>

				{/* Pack */}
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

				{/* Unlimited Yearly */}
				<PlanCard
					theme={theme}
					title="Unlimited Yearly"
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

				{/* Unlimited Quarterly (feature-flagged) */}
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

function PostCheckoutView({
	theme,
	pollingState,
	offer,
	onRetry,
}: {
	theme: ReturnType<typeof useTheme>;
	pollingState: CheckoutPollingState;
	offer: CheckoutTarget;
	onRetry: () => void;
}) {
	const offerLabel =
		offer === SONG_PACK_500 ? "Song Pack" : "Unlimited subscription";

	if (pollingState.status === "polling") {
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

	if (pollingState.status === "confirmed") {
		const confirmMessage =
			offer === SONG_PACK_500
				? `${String(pollingState.billingState.creditBalance)} songs ready to explore.`
				: "Unlimited access activated.";

		return (
			<div className="text-center">
				<p
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Confirmed
				</p>

				<h2
					className="mt-4 text-4xl leading-tight font-extralight"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					You're all set.
				</h2>

				<p
					className="mt-6 text-base font-light"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					{confirmMessage}
				</p>
			</div>
		);
	}

	// Timeout
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

			<button
				type="button"
				onClick={onRetry}
				className="mt-8 text-sm font-medium tracking-wide"
				style={{ fontFamily: fonts.body, color: theme.primary }}
			>
				Choose a different plan
			</button>
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
