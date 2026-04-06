import { useCallback, useState } from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { getDisplayBalance, getPlanLabel } from "@/lib/domains/billing/display";
import type { BillingState } from "@/lib/domains/billing/state";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";
import { createPortalSession } from "@/lib/server/billing.functions";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

interface BillingSectionProps {
	billingState: BillingState;
}

const STATUS_LABELS: Record<string, string> = {
	active: "Active",
	ending: "Canceling",
	past_due: "Past due",
	none: "None",
};

function getStatusColor(
	status: BillingState["subscriptionStatus"],
	theme: ReturnType<typeof useTheme>,
): string {
	switch (status) {
		case "active":
			return "#1DB954";
		case "ending":
			return "#F5A623";
		case "past_due":
			return "#E53E3E";
		case "none":
			return theme.border;
	}
}

export function BillingSection({ billingState }: BillingSectionProps) {
	const theme = useTheme();
	const [isLoadingPortal, setIsLoadingPortal] = useState(false);

	const isSelfHosted = billingState.unlimitedAccess.kind === "self_hosted";
	const hasSubscription =
		billingState.subscriptionStatus === "active" ||
		billingState.subscriptionStatus === "ending" ||
		billingState.subscriptionStatus === "past_due";
	const showPortalButton = hasSubscription && !isSelfHosted;
	const showPackEntry = !isSelfHosted && !hasUnlimitedAccess(billingState);

	const planLabel = getPlanLabel(billingState);
	const balance = getDisplayBalance(billingState);

	const handlePortalLaunch = useCallback(async () => {
		if (isLoadingPortal) return;
		setIsLoadingPortal(true);

		try {
			const result = await createPortalSession();

			if (result.success) {
				window.location.href = result.portalUrl;
				return;
			}

			switch (result.error) {
				case "billing_disabled":
					toast.error("Billing is not available right now.");
					break;
				case "billing_service_error":
					toast.error("Something went sideways. Let's try that again.");
					break;
			}
		} catch {
			toast.error("Something went sideways. Let's try that again.");
		} finally {
			setIsLoadingPortal(false);
		}
	}, [isLoadingPortal]);

	return (
		<section>
			<div className="flex items-center justify-between py-3">
				<div className="flex items-center gap-4">
					<div
						className="flex h-10 w-10 items-center justify-center rounded-full"
						style={{ background: theme.surfaceDim }}
					>
						<CreditCard
							size={20}
							strokeWidth={1.5}
							style={{ color: theme.text }}
						/>
					</div>
					<div>
						<p
							className="text-[20px] font-light"
							style={{ fontFamily: fonts.display, color: theme.text }}
						>
							{planLabel}
						</p>
						<p
							className="mt-1 text-sm"
							style={{ fontFamily: fonts.body, color: theme.textMuted }}
						>
							{isSelfHosted && "Unlimited (Self-hosted)"}
							{!isSelfHosted && hasSubscription && (
								<>
									Subscription{" "}
									<span className="inline-flex items-center gap-1.5">
										<span
											className="inline-block h-2 w-2 rounded-full"
											style={{
												background: getStatusColor(
													billingState.subscriptionStatus,
													theme,
												),
											}}
										/>
										{STATUS_LABELS[billingState.subscriptionStatus]}
									</span>
								</>
							)}
							{!isSelfHosted && !hasSubscription && balance !== null && (
								<>{balance} songs to explore</>
							)}
							{!isSelfHosted &&
								!hasSubscription &&
								balance === null &&
								"No active subscription"}
						</p>
					</div>
				</div>
			</div>

			{(showPortalButton || showPackEntry) && (
				<div
					className="mt-4 flex gap-4"
					style={{ paddingLeft: "calc(2.5rem + 1rem)" }}
				>
					{showPortalButton && (
						<button
							type="button"
							onClick={handlePortalLaunch}
							disabled={isLoadingPortal}
							className="inline-flex cursor-pointer items-center gap-2 text-xs font-normal tracking-widest uppercase transition-all duration-200 hover:opacity-70 disabled:cursor-wait disabled:opacity-50"
							style={{ fontFamily: fonts.body, color: theme.textMuted }}
						>
							{isLoadingPortal ? "Opening…" : "Manage subscription"}
							{!isLoadingPortal && <ExternalLink size={12} strokeWidth={1.5} />}
						</button>
					)}
					{showPackEntry && (
						<button
							type="button"
							className="inline-flex cursor-pointer items-center gap-2 text-xs font-normal tracking-widest uppercase transition-all duration-200 hover:opacity-70"
							style={{ fontFamily: fonts.body, color: theme.textMuted }}
						>
							Buy song packs
						</button>
					)}
				</div>
			)}
		</section>
	);
}
