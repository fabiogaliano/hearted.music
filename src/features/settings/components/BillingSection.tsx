import { ArrowSquareOut } from "@phosphor-icons/react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { PaywallCTA } from "@/features/billing/components/PaywallCTA";
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
			<p
				className="theme-text text-xl font-light"
				style={{ fontFamily: fonts.display }}
			>
				Billing
			</p>

			<div className="mt-3">
				<p
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, opacity: 0.6 }}
				>
					Current plan
				</p>
				<p
					className="theme-text mt-1 text-sm"
					style={{ fontFamily: fonts.body }}
				>
					{isSelfHosted && "Unlimited (Self-hosted)"}
					{!isSelfHosted && hasSubscription && (
						<>
							{planLabel}
							<span className="theme-text-muted ml-3 inline-flex items-center gap-2">
								<span
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
							{planLabel}
							<span className="theme-text-muted">
								{" · "}
								{balance} songs remaining
							</span>
						</>
					)}
					{!isSelfHosted && !hasSubscription && balance === null && "Free"}
				</p>
			</div>

			{showPortalButton && (
				<div className="mt-4">
					<Button
						variant="ghost"
						size="sm"
						onClick={handlePortalLaunch}
						disabled={isLoadingPortal}
						className="inline-flex items-center gap-2"
						style={{ fontFamily: fonts.body }}
					>
						{isLoadingPortal ? "Opening…" : "Manage subscription"}
						{!isLoadingPortal && <ArrowSquareOut size={12} weight="light" />}
					</Button>
				</div>
			)}

			{showPackEntry && (
				<div className="mt-4">
					<PaywallCTA billingState={billingState} compact />
				</div>
			)}
		</section>
	);
}
