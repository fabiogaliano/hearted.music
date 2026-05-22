import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { PaywallCTA } from "@/features/billing/components/PaywallCTA";
import { portalErrorMessage } from "@/features/billing/error-copy";
import { getDisplayBalance, getPlanLabel } from "@/lib/domains/billing/display";
import type { BillingState } from "@/lib/domains/billing/state";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";
import { createPortalSession } from "@/lib/server/billing.functions";
import { fonts } from "@/lib/theme/fonts";

interface BillingSectionProps {
	billingState: BillingState;
}

const STATUS_LABELS: Record<string, string> = {
	active: "Active",
	ending: "Canceling",
	past_due: "Past due",
	none: "None",
};

function getStatusColor(status: BillingState["subscriptionStatus"]): string {
	switch (status) {
		case "active":
			return "#1DB954";
		case "ending":
			return "#F5A623";
		case "past_due":
			return "#E53E3E";
		case "none":
			return "var(--t-border)";
	}
}

function formatPeriodEnd(iso: string | null): string {
	if (!iso) return "end of period";
	const date = new Date(iso);
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

/**
 * Renders only the *contents* of the Subscription row. The enclosing
 * editorial heading + microcopy live in SettingsPage's SettingsSection, so
 * this component intentionally omits its own title.
 */
export function BillingSection({ billingState }: BillingSectionProps) {
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

			toast.error(portalErrorMessage(result.error));
		} catch {
			toast.error("Something went sideways. Let's try that again.");
		} finally {
			setIsLoadingPortal(false);
		}
	}, [isLoadingPortal]);

	return (
		<div>
			<p
				className="theme-text-muted text-xs tracking-widest uppercase opacity-60"
				style={{ fontFamily: fonts.body }}
			>
				Current plan
			</p>
			<p
				className="theme-text mt-2 text-base leading-relaxed"
				style={{ fontFamily: fonts.body }}
			>
				{isSelfHosted && (
					<span>
						Unlimited <span className="theme-text-muted">· Self-hosted</span>
					</span>
				)}
				{!isSelfHosted && hasSubscription && (
					<>
						<span className="theme-text">{planLabel}</span>
						<span className="theme-text-muted ml-3 inline-flex items-center gap-2">
							<span
								aria-hidden="true"
								className="inline-block size-2 rounded-full"
								style={{
									background: getStatusColor(billingState.subscriptionStatus),
								}}
							/>
							{billingState.subscriptionStatus === "ending"
								? `Active until ${formatPeriodEnd(billingState.subscriptionPeriodEnd)}`
								: billingState.subscriptionStatus === "past_due"
									? "Payment failed"
									: STATUS_LABELS[billingState.subscriptionStatus]}
						</span>
					</>
				)}
				{!isSelfHosted && !hasSubscription && balance !== null && (
					<>
						<span className="theme-text">{planLabel}</span>
						<span className="theme-text-muted ml-3">
							· <span className="tabular-nums">{balance}</span> songs remaining
						</span>
					</>
				)}
				{!isSelfHosted && !hasSubscription && balance === null && "Free"}
			</p>

			{showPortalButton && (
				<div className="mt-5">
					<Button
						variant="ghost"
						size="sm"
						onClick={handlePortalLaunch}
						disabled={isLoadingPortal}
						className="inline-flex items-center gap-2"
						style={{ fontFamily: fonts.body }}
					>
						{isLoadingPortal ? "Opening…" : "Manage subscription"}
						{!isLoadingPortal && (
							<ArrowSquareOutIcon size={12} weight="light" />
						)}
					</Button>
				</div>
			)}

			{showPackEntry && (
				<div className="mt-5">
					<PaywallCTA billingState={billingState} compact />
				</div>
			)}
		</div>
	);
}
