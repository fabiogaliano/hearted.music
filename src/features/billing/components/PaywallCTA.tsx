/**
 * Paywall CTA displayed when purchased balance hits zero.
 *
 * Shows pack purchase and unlimited upgrade entry points. Pack CTA is
 * hidden when unlimited is active. Quarterly option gated by server flag.
 */

import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
} from "@/lib/domains/billing/offers";
import type { BillingState } from "@/lib/domains/billing/state";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";
import {
	getPlanSelectionConfig,
	getSubscriptionUpgradeQuote,
	type PlanSelectionConfig,
	type SubscriptionUpgradeQuote,
} from "@/lib/server/billing.functions";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { useCheckoutFlow } from "../hooks/useCheckoutFlow";

interface PaywallCTAProps {
	billingState: BillingState;
	/** Compact mode for embedding inside dialogs */
	compact?: boolean;
}

const PACK_CREDITS = 500;
const YEARLY_PRICE_CENTS = 3999;
const QUARTERLY_PRICE_CENTS = 1499;

function formatPrice(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

type ConfigState =
	| { status: "loading" }
	| { status: "loaded"; config: PlanSelectionConfig }
	| { status: "error" };

type QuoteState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "loaded"; quote: SubscriptionUpgradeQuote }
	| { status: "error" };

export function PaywallCTA({ billingState, compact = false }: PaywallCTAProps) {
	const theme = useTheme();
	const { startCheckout, isBusy } = useCheckoutFlow(billingState);
	const [configState, setConfigState] = useState<ConfigState>({
		status: "loading",
	});
	const [quoteState, setQuoteState] = useState<QuoteState>({ status: "idle" });

	const [showPackConfirm, setShowPackConfirm] = useState(false);
	const packConfirmDialogRef = useRef<HTMLDivElement>(null);
	const packConfirmTitleId = useId();
	const packConfirmDescriptionId = useId();

	const isUnlimited = hasUnlimitedAccess(billingState);
	const showPackCTA = !isUnlimited;
	const showUnlimitedCTA = !isUnlimited;
	const creditBalance = billingState.creditBalance;
	const hasRemainingCredits = creditBalance > 0;

	const handlePackClick = useCallback(() => {
		if (hasRemainingCredits) {
			setShowPackConfirm(true);
		} else {
			startCheckout(SONG_PACK_500);
		}
	}, [hasRemainingCredits, startCheckout]);
	const upgradeQuote = quoteState.status === "loaded" ? quoteState.quote : null;
	const discountCents = upgradeQuote?.discountCents ?? 0;
	const hasUpgradeDiscount = discountCents > 0;
	const discountNote = hasRemainingCredits
		? quoteState.status === "loading"
			? "Checking upgrade discount…"
			: quoteState.status === "loaded" && quoteState.quote.discountCents > 0
				? `Your ${quoteState.quote.convertedCredits} remaining songs save ${formatPrice(
						quoteState.quote.discountCents,
					)}`
				: quoteState.status === "error"
					? "Purchased songs discounted at checkout"
					: null
		: null;

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

	useEffect(() => {
		if (!showUnlimitedCTA || creditBalance <= 0) {
			setQuoteState({ status: "idle" });
			return;
		}

		let cancelled = false;
		setQuoteState({ status: "loading" });
		getSubscriptionUpgradeQuote()
			.then((quote) => {
				if (!cancelled) setQuoteState({ status: "loaded", quote });
			})
			.catch(() => {
				if (!cancelled) setQuoteState({ status: "error" });
			});

		return () => {
			cancelled = true;
		};
	}, [showUnlimitedCTA, creditBalance]);

	useEffect(() => {
		if (!showPackConfirm) return;

		const previouslyFocused = document.activeElement;
		packConfirmDialogRef.current?.focus();

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			setShowPackConfirm(false);
		}

		document.addEventListener("keydown", handleKeyDown);

		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			if (
				previouslyFocused instanceof HTMLElement &&
				previouslyFocused.isConnected
			) {
				previouslyFocused.focus();
			}
		};
	}, [showPackConfirm]);

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
						onClick={handlePackClick}
						disabled={isBusy}
						className="w-full cursor-pointer rounded-lg border px-4 py-3 text-left transition-[transform,background-color] duration-150 hover:bg-white/15 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
						style={{
							fontFamily: fonts.body,
							borderColor: theme.border,
						}}
					>
						<div className="flex items-baseline justify-between">
							<span
								className="text-sm font-medium"
								style={{ color: theme.text }}
							>
								Song Pack
								<span
									className="ml-1 font-normal"
									style={{ color: theme.textMuted }}
								>
									· 500 songs
								</span>
							</span>
							<span
								className="shrink-0 text-xs"
								style={{ color: theme.textMuted }}
							>
								$5.99
							</span>
						</div>
						<ul
							className="mt-1.5 flex flex-col gap-0.5"
							style={{ color: theme.textMuted }}
						>
							<li className="text-xs">You choose which ones to explore</li>
						</ul>
					</button>
				)}

				{showUnlimitedCTA && (
					<>
						<button
							type="button"
							onClick={() => startCheckout(UNLIMITED_YEARLY)}
							disabled={isBusy}
							className="w-full cursor-pointer rounded-lg border px-4 py-3 text-left transition-[transform,background-color] duration-150 hover:bg-white/15 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
							style={{
								fontFamily: fonts.body,
								borderColor: theme.border,
							}}
						>
							<div className="flex items-baseline justify-between">
								<span
									className="text-sm font-medium"
									style={{ color: theme.text }}
								>
									Backstage Pass
								</span>
								<span className="shrink-0 text-xs">
									{hasUpgradeDiscount ? (
										<>
											<span
												style={{
													color: theme.textMuted,
													textDecoration: "line-through",
													opacity: 0.6,
												}}
											>
												$39.99
											</span>{" "}
											<span style={{ color: theme.primary, fontWeight: 500 }}>
												{formatPrice(
													Math.max(0, YEARLY_PRICE_CENTS - discountCents),
												)}
											</span>
											<span style={{ color: theme.textMuted }}>/yr</span>
										</>
									) : (
										<span style={{ color: theme.textMuted }}>$39.99/yr</span>
									)}
								</span>
							</div>
							<div className="mt-1.5 flex justify-between">
								<ul
									className="flex flex-col gap-0.5"
									style={{ color: theme.textMuted }}
								>
									<li className="text-xs">Every song explored automatically</li>
									<li className="text-xs">
										Your feature requests and bug reports get priority
									</li>
									<li className="text-xs">
										You help keep hearted. in development
									</li>
								</ul>
								{discountNote && (
									<p
										className="shrink-0 self-start text-xs"
										style={{ color: theme.textMuted, opacity: 0.7 }}
									>
										{discountNote}
									</p>
								)}
							</div>
						</button>

						{quarterlyEnabled && (
							<button
								type="button"
								onClick={() => startCheckout(UNLIMITED_QUARTERLY)}
								disabled={isBusy}
								className="w-full cursor-pointer rounded-lg border px-4 py-3 text-left transition-[transform,background-color] duration-150 hover:bg-white/15 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
								style={{
									fontFamily: fonts.body,
									borderColor: theme.border,
								}}
							>
								<div className="flex items-baseline justify-between">
									<span
										className="text-sm font-medium"
										style={{ color: theme.text }}
									>
										3-Month Unlimited
									</span>
									<div className="shrink-0 text-right">
										<span className="text-xs">
											{hasUpgradeDiscount ? (
												<>
													<span
														style={{
															color: theme.textMuted,
															textDecoration: "line-through",
															opacity: 0.6,
														}}
													>
														$14.99
													</span>{" "}
													<span
														style={{
															color: theme.primary,
															fontWeight: 500,
														}}
													>
														{formatPrice(
															Math.max(
																0,
																QUARTERLY_PRICE_CENTS - discountCents,
															),
														)}
													</span>
													<span style={{ color: theme.textMuted }}>
														/quarter
													</span>
												</>
											) : (
												<span style={{ color: theme.textMuted }}>
													$14.99/quarter
												</span>
											)}
										</span>
										{discountNote && (
											<p
												className="mt-0.5 text-xs"
												style={{ color: theme.textMuted, opacity: 0.7 }}
											>
												{discountNote}
											</p>
										)}
									</div>
								</div>
								<ul
									className="mt-1.5 flex flex-col gap-0.5"
									style={{ color: theme.textMuted }}
								>
									<li className="text-xs">Every song explored automatically</li>
									<li className="text-xs">Standard queue</li>
								</ul>
							</button>
						)}
					</>
				)}
			</div>

			{showPackConfirm &&
				createPortal(
					<div
						className="fixed inset-0 z-[100] flex items-center justify-center p-4"
						role="presentation"
					>
						<button
							type="button"
							aria-label="Close pack confirmation"
							className="dialog-backdrop absolute inset-0 cursor-default border-0 p-0"
							style={{ background: "rgba(0,0,0,0.45)" }}
							onClick={() => setShowPackConfirm(false)}
						/>
						<div
							ref={packConfirmDialogRef}
							role="dialog"
							aria-modal="true"
							aria-labelledby={packConfirmTitleId}
							aria-describedby={packConfirmDescriptionId}
							tabIndex={-1}
							className="dialog-content relative w-full max-w-[340px] p-6 outline-none"
							style={{
								background: theme.surface,
								border: `1px solid ${theme.border}`,
							}}
						>
							<p
								id={packConfirmTitleId}
								className="text-lg font-light"
								style={{ fontFamily: fonts.display, color: theme.text }}
							>
								You still have {billingState.creditBalance} songs.
							</p>
							<p
								id={packConfirmDescriptionId}
								className="mt-1 text-xs tracking-wide"
								style={{ fontFamily: fonts.body, color: theme.textMuted }}
							>
								Another pack brings that to{" "}
								{billingState.creditBalance + PACK_CREDITS}.
							</p>
							<div className="mt-5 flex justify-end gap-3">
								<button
									type="button"
									onClick={() => setShowPackConfirm(false)}
									className="cursor-pointer px-4 py-1.5 text-xs tracking-widest uppercase transition-opacity duration-150 hover:opacity-70"
									style={{
										fontFamily: fonts.body,
										color: theme.textMuted,
										background: "transparent",
										border: "none",
									}}
								>
									Not now
								</button>
								<button
									type="button"
									onClick={() => {
										setShowPackConfirm(false);
										startCheckout(SONG_PACK_500);
									}}
									className="cursor-pointer px-5 py-1.5 text-xs tracking-widest uppercase transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98]"
									style={{
										fontFamily: fonts.body,
										background: theme.primary,
										color: theme.textOnPrimary,
										border: "none",
										borderRadius: "2px",
									}}
								>
									Add 500 more
								</button>
							</div>
						</div>
					</div>,
					document.body,
				)}
		</div>
	);
}
