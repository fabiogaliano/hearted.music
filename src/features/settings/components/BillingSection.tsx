import { ExternalLink } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { PaywallCTA } from "@/features/billing/components/PaywallCTA";
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
			<p
				className="text-[20px] font-light"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				Billing
			</p>

			<div className="mt-3">
				<p
					className="text-xs tracking-widest uppercase"
					style={{
						fontFamily: fonts.body,
						color: theme.textMuted,
						opacity: 0.6,
					}}
				>
					Current plan
				</p>
				<p
					className="mt-1 text-sm"
					style={{ fontFamily: fonts.body, color: theme.text }}
				>
					{isSelfHosted && "Unlimited (Self-hosted)"}
					{!isSelfHosted && hasSubscription && (
						<>
							{planLabel}
							<span
								className="ml-3 inline-flex items-center gap-2"
								style={{ color: theme.textMuted }}
							>
								<span
									className="inline-block h-2 w-2 rounded-full"
									style={{
										background: getStatusColor(
											billingState.subscriptionStatus,
											theme,
										),
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
							<span style={{ color: theme.textMuted }}>
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
					<button
						type="button"
						onClick={handlePortalLaunch}
						disabled={isLoadingPortal}
						className="inline-flex cursor-pointer items-center gap-2 text-xs font-normal tracking-widest uppercase transition-opacity duration-150 hover:opacity-70 disabled:cursor-wait disabled:opacity-50"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						{isLoadingPortal ? "Opening…" : "Manage subscription"}
						{!isLoadingPortal && <ExternalLink size={12} strokeWidth={1.5} />}
					</button>
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
