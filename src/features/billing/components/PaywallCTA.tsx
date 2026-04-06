/**
 * Paywall CTA displayed when purchased balance hits zero.
 *
 * Shows pack purchase and unlimited upgrade entry points. Pack CTA is
 * hidden when unlimited is active. Quarterly option gated by server flag.
 */

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import {
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
} from "@/lib/domains/billing/offers";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";
import type { BillingState } from "@/lib/domains/billing/state";
import {
	getPlanSelectionConfig,
	type PlanSelectionConfig,
} from "@/lib/server/billing.functions";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { useCheckoutFlow } from "../hooks/useCheckoutFlow";

interface PaywallCTAProps {
	billingState: BillingState;
	/** Compact mode for embedding inside dialogs */
	compact?: boolean;
}

type ConfigState =
	| { status: "loading" }
	| { status: "loaded"; config: PlanSelectionConfig }
	| { status: "error" };

export function PaywallCTA({ billingState, compact = false }: PaywallCTAProps) {
	const theme = useTheme();
	const { startCheckout, isBusy } = useCheckoutFlow();
	const [configState, setConfigState] = useState<ConfigState>({
		status: "loading",
	});

	const isUnlimited = hasUnlimitedAccess(billingState);
	const showPackCTA = !isUnlimited;
	const showUnlimitedCTA = !isUnlimited;
	const hasRemainingCredits = billingState.creditBalance > 0;

	useEffect(() => {
		if (!showUnlimitedCTA) return;

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
	}, [showUnlimitedCTA]);

	const quarterlyEnabled =
		configState.status === "loaded" && configState.config.quarterlyPlanEnabled;

	if (isUnlimited) return null;

	return (
		<div
			className={`flex flex-col items-center gap-4 ${compact ? "py-2" : "py-6"}`}
		>
			{!compact && (
				<>
					<Sparkles size={24} color={theme.primary} />
					<div className="text-center">
						<p
							className="text-sm"
							style={{ fontFamily: fonts.body, color: theme.text }}
						>
							Out of explorations. Explore more songs.
						</p>
					</div>
				</>
			)}

			<div
				className={`flex w-full flex-col gap-3 ${compact ? "mt-1" : "mt-2"}`}
			>
				{showPackCTA && (
					<button
						type="button"
						onClick={() => startCheckout(SONG_PACK_500)}
						disabled={isBusy}
						className="w-full cursor-pointer rounded-lg border px-4 py-3 text-left transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
						style={{
							fontFamily: fonts.body,
							borderColor: theme.primary,
							background: "transparent",
						}}
					>
						<span className="text-sm font-medium" style={{ color: theme.text }}>
							Song Pack
						</span>
						<span className="ml-2 text-xs" style={{ color: theme.textMuted }}>
							500 songs · $5.99
						</span>
					</button>
				)}

				{showUnlimitedCTA && (
					<>
						<button
							type="button"
							onClick={() => startCheckout(UNLIMITED_YEARLY)}
							disabled={isBusy}
							className="w-full cursor-pointer rounded-lg border px-4 py-3 text-left transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
							style={{
								fontFamily: fonts.body,
								borderColor: theme.border,
								background: "transparent",
							}}
						>
							<span
								className="text-sm font-medium"
								style={{ color: theme.text }}
							>
								Backstage Pass
							</span>
							<span className="ml-2 text-xs" style={{ color: theme.textMuted }}>
								Unlimited · $39.99/yr
							</span>
							{hasRemainingCredits && (
								<p className="mt-1 text-xs" style={{ color: theme.textMuted }}>
									Your remaining {billingState.creditBalance} songs will be
									applied as a discount
								</p>
							)}
						</button>

						{quarterlyEnabled && (
							<button
								type="button"
								onClick={() => startCheckout(UNLIMITED_QUARTERLY)}
								disabled={isBusy}
								className="w-full cursor-pointer rounded-lg border px-4 py-3 text-left transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
								style={{
									fontFamily: fonts.body,
									borderColor: theme.border,
									background: "transparent",
								}}
							>
								<span
									className="text-sm font-medium"
									style={{ color: theme.text }}
								>
									3-Month Unlimited
								</span>
								<span
									className="ml-2 text-xs"
									style={{ color: theme.textMuted }}
								>
									Unlimited · $14.99/quarter
								</span>
								{hasRemainingCredits && (
									<p
										className="mt-1 text-xs"
										style={{ color: theme.textMuted }}
									>
										Your remaining {billingState.creditBalance} songs will be
										applied as a discount
									</p>
								)}
							</button>
						)}
					</>
				)}
			</div>
		</div>
	);
}
