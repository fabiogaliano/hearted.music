import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
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
import { useCheckoutFlow } from "../hooks/useCheckoutFlow";

interface PaywallCTAProps {
	billingState: BillingState;
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
				<div className="text-center">
					<p className="theme-text text-sm" style={{ fontFamily: fonts.body }}>
						Out of explorations. Explore more songs.
					</p>
				</div>
			)}

			<div
				className={`flex w-full flex-col gap-3 ${compact ? "mt-1" : "mt-2"}`}
			>
				{showPackCTA && (
					<Button
						variant="card"
						onClick={handlePackClick}
						disabled={isBusy}
						style={{ fontFamily: fonts.body }}
					>
						<div className="flex items-baseline justify-between">
							<span className="theme-text text-sm font-medium">
								Song Pack
								<span className="theme-text-muted ml-1 font-normal">
									· 500 songs
								</span>
							</span>
							<span className="theme-text-muted shrink-0 text-xs">$5.99</span>
						</div>
						<ul className="theme-text-muted mt-1.5 flex flex-col gap-0.5">
							<li className="text-xs">You choose which ones to explore</li>
						</ul>
					</Button>
				)}

				{showUnlimitedCTA && (
					<>
						<Button
							variant="card"
							onClick={() => startCheckout(UNLIMITED_YEARLY)}
							disabled={isBusy}
							style={{ fontFamily: fonts.body }}
						>
							<div className="flex items-baseline justify-between">
								<span className="theme-text text-sm font-medium">
									Backstage Pass
								</span>
								<span className="shrink-0 text-xs">
									{hasUpgradeDiscount ? (
										<>
											<span
												className="theme-text-muted"
												style={{ textDecoration: "line-through", opacity: 0.6 }}
											>
												$39.99
											</span>{" "}
											<span className="theme-primary font-medium">
												{formatPrice(
													Math.max(0, YEARLY_PRICE_CENTS - discountCents),
												)}
											</span>
											<span className="theme-text-muted">/yr</span>
										</>
									) : (
										<span className="theme-text-muted">$39.99/yr</span>
									)}
								</span>
							</div>
							<div className="mt-1.5 flex justify-between">
								<ul className="theme-text-muted flex flex-col gap-0.5">
									<li className="text-xs">Every song explored automatically</li>
									<li className="text-xs">
										Your feature requests and bug reports get priority
									</li>
									<li className="text-xs">
										You help keep hearted. in development
									</li>
								</ul>
								{discountNote && (
									<p className="theme-text-muted shrink-0 self-start text-xs opacity-70">
										{discountNote}
									</p>
								)}
							</div>
						</Button>

						{quarterlyEnabled && (
							<Button
								variant="card"
								onClick={() => startCheckout(UNLIMITED_QUARTERLY)}
								disabled={isBusy}
								style={{ fontFamily: fonts.body }}
							>
								<div className="flex items-baseline justify-between">
									<span className="theme-text text-sm font-medium">
										3-Month Unlimited
									</span>
									<div className="shrink-0 text-right">
										<span className="text-xs">
											{hasUpgradeDiscount ? (
												<>
													<span
														className="theme-text-muted"
														style={{
															textDecoration: "line-through",
															opacity: 0.6,
														}}
													>
														$14.99
													</span>{" "}
													<span className="theme-primary font-medium">
														{formatPrice(
															Math.max(
																0,
																QUARTERLY_PRICE_CENTS - discountCents,
															),
														)}
													</span>
													<span className="theme-text-muted">/quarter</span>
												</>
											) : (
												<span className="theme-text-muted">$14.99/quarter</span>
											)}
										</span>
										{discountNote && (
											<p className="theme-text-muted mt-0.5 text-xs opacity-70">
												{discountNote}
											</p>
										)}
									</div>
								</div>
								<ul className="theme-text-muted mt-1.5 flex flex-col gap-0.5">
									<li className="text-xs">Every song explored automatically</li>
									<li className="text-xs">Standard queue</li>
								</ul>
							</Button>
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
							className="dialog-backdrop absolute inset-0 cursor-default border-0 bg-black/50 p-0"
							onClick={() => setShowPackConfirm(false)}
						/>
						<div
							ref={packConfirmDialogRef}
							role="dialog"
							aria-modal="true"
							aria-labelledby={packConfirmTitleId}
							aria-describedby={packConfirmDescriptionId}
							tabIndex={-1}
							className="theme-surface-bg theme-border-color dialog-content relative w-full max-w-[340px] border p-6 outline-none"
						>
							<p
								id={packConfirmTitleId}
								className="theme-text text-lg font-light"
								style={{ fontFamily: fonts.display }}
							>
								You still have {billingState.creditBalance} songs.
							</p>
							<p
								id={packConfirmDescriptionId}
								className="theme-text-muted mt-1 text-xs tracking-wide"
								style={{ fontFamily: fonts.body }}
							>
								Another pack brings that to{" "}
								{billingState.creditBalance + PACK_CREDITS}.
							</p>
							<div className="mt-5 flex justify-end gap-3">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setShowPackConfirm(false)}
									style={{ fontFamily: fonts.body }}
								>
									Not now
								</Button>
								<Button
									size="sm"
									onClick={() => {
										setShowPackConfirm(false);
										startCheckout(SONG_PACK_500);
									}}
									style={{ fontFamily: fonts.body }}
								>
									Add 500 more
								</Button>
							</div>
						</div>
					</div>,
					document.body,
				)}
		</div>
	);
}
