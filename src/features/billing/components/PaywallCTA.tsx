import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import {
	type PackOfferId,
	SONG_PACK_250,
	SONG_PACK_500,
	UNLIMITED_QUARTERLY,
	UNLIMITED_YEARLY,
} from "@/lib/domains/billing/offers";
import {
	formatOfferPrice,
	formatPrice,
	OFFER_PRICING,
} from "@/lib/domains/billing/pricing";
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

const PACK_OPTIONS: { offer: PackOfferId; credits: number; bonus: number }[] = [
	{ offer: SONG_PACK_250, credits: 250, bonus: 15 },
	{ offer: SONG_PACK_500, credits: 500, bonus: 25 },
];

// Dollars-per-song, e.g. "$0.024". Three decimals on purpose: at two decimals
// both packs round to $0.02 and the volume discount (2.4¢ → 2.0¢) disappears.
function perSongLabel(offer: PackOfferId, credits: number): string {
	return `$${(OFFER_PRICING[offer].amountCents / credits / 100).toFixed(3)}`;
}
const YEARLY_PRICE_CENTS = OFFER_PRICING[UNLIMITED_YEARLY].amountCents;
const QUARTERLY_PRICE_CENTS = OFFER_PRICING[UNLIMITED_QUARTERLY].amountCents;

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

	const [pendingPack, setPendingPack] = useState<{
		offer: PackOfferId;
		credits: number;
	} | null>(null);
	const packConfirmDialogRef = useRef<HTMLDivElement>(null);
	const packConfirmTitleId = useId();
	const packConfirmDescriptionId = useId();

	const isUnlimited = hasUnlimitedAccess(billingState);
	const showPackCTA = !isUnlimited;
	const showUnlimitedCTA = !isUnlimited;
	const creditBalance = billingState.creditBalance;
	const hasRemainingCredits = creditBalance > 0;

	const handlePackClick = useCallback(
		(pack: { offer: PackOfferId; credits: number }) => {
			if (hasRemainingCredits) {
				setPendingPack(pack);
			} else {
				startCheckout(pack.offer);
			}
		},
		[hasRemainingCredits, startCheckout],
	);
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
		if (!pendingPack) return;

		const previouslyFocused = document.activeElement;
		packConfirmDialogRef.current?.focus();

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			setPendingPack(null);
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
	}, [pendingPack]);

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
				className={`flex w-full flex-col gap-4 ${compact ? "mt-1" : "mt-2"}`}
			>
				{showPackCTA &&
					PACK_OPTIONS.map((pack) => (
						<Button
							key={pack.offer}
							variant="card"
							className="bg-(--t-surface)"
							onClick={() => handlePackClick(pack)}
							disabled={isBusy}
							style={{ fontFamily: fonts.body }}
						>
							<div className="flex items-baseline justify-between">
								<span className="theme-text text-sm font-medium">
									{pack.credits} Song Pack
									<span className="theme-text-muted ml-1 text-xs font-normal opacity-60">
										(+{pack.bonus} bonus)
									</span>
								</span>
								<span className="theme-text-muted shrink-0 text-xs">
									<span className="opacity-60">
										{perSongLabel(pack.offer, pack.credits)} p/song
									</span>{" "}
									· {formatOfferPrice(pack.offer)}
								</span>
							</div>
							<ul className="theme-text-muted mt-1.5 flex flex-col gap-0.5">
								<li className="text-xs">You choose which ones to explore</li>
							</ul>
						</Button>
					))}

				{showUnlimitedCTA && (
					<>
						<Button
							variant="card"
							className="bg-(--t-surface)"
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
												{formatPrice(YEARLY_PRICE_CENTS)}
											</span>{" "}
											<span className="theme-primary font-medium">
												{formatPrice(
													Math.max(0, YEARLY_PRICE_CENTS - discountCents),
												)}
											</span>
											<span className="theme-text-muted">
												{OFFER_PRICING[UNLIMITED_YEARLY].suffix}
											</span>
										</>
									) : (
										<span className="theme-text-muted">
											{formatOfferPrice(UNLIMITED_YEARLY)}
										</span>
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
								className="bg-(--t-surface)"
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
														{formatPrice(QUARTERLY_PRICE_CENTS)}
													</span>{" "}
													<span className="theme-primary font-medium">
														{formatPrice(
															Math.max(
																0,
																QUARTERLY_PRICE_CENTS - discountCents,
															),
														)}
													</span>
													<span className="theme-text-muted">
														{OFFER_PRICING[UNLIMITED_QUARTERLY].suffix}
													</span>
												</>
											) : (
												<span className="theme-text-muted">
													{formatOfferPrice(UNLIMITED_QUARTERLY)}
												</span>
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

			{pendingPack &&
				createPortal(
					<div
						className="fixed inset-0 z-[100] flex items-center justify-center p-4"
						role="presentation"
					>
						<button
							type="button"
							aria-label="Close pack confirmation"
							className="dialog-backdrop absolute inset-0 cursor-default border-0 bg-black/50 p-0"
							onClick={() => setPendingPack(null)}
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
								style={{ fontFamily: fonts.body }}
							>
								You still have {billingState.creditBalance} songs.
							</p>
							<p
								id={packConfirmDescriptionId}
								className="theme-text-muted mt-1 text-xs tracking-wide"
								style={{ fontFamily: fonts.body }}
							>
								Another pack brings that to{" "}
								{billingState.creditBalance + pendingPack.credits}.
							</p>
							<div className="mt-5 flex justify-end gap-3">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setPendingPack(null)}
									style={{ fontFamily: fonts.body }}
								>
									Not now
								</Button>
								<Button
									size="sm"
									onClick={() => {
										const pack = pendingPack;
										setPendingPack(null);
										startCheckout(pack.offer);
									}}
									style={{ fontFamily: fonts.body }}
								>
									Add {pendingPack.credits} more
								</Button>
							</div>
						</div>
					</div>,
					document.body,
				)}
		</div>
	);
}
