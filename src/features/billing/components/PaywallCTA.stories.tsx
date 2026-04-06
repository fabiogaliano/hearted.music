import type { Story } from "@ladle/react";
import { PaywallCTA } from "./PaywallCTA";
import type { BillingState } from "@/lib/domains/billing/state";

function makeFreeBillingState(creditBalance = 0): BillingState {
	return {
		plan: "free",
		creditBalance,
		subscriptionStatus: "none",
		cancelAtPeriodEnd: false,
		unlimitedAccess: { kind: "none" },
		queueBand: "low",
	};
}

export const Default: Story = () => (
	<div style={{ maxWidth: 400, margin: "40px auto", padding: "0 16px" }}>
		<PaywallCTA billingState={makeFreeBillingState(0)} />
	</div>
);
Default.meta = {
	description:
		"Standard paywall. Quarterly option is gated by server flag — it stays hidden until config loads.",
};

export const WithRemainingCredits: Story = () => (
	<div style={{ maxWidth: 400, margin: "40px auto", padding: "0 16px" }}>
		<PaywallCTA billingState={makeFreeBillingState(87)} />
	</div>
);
WithRemainingCredits.meta = {
	description:
		"User has 87 remaining credits — discount notice appears on the unlimited options.",
};

export const Compact: Story = () => (
	<div style={{ maxWidth: 400, margin: "40px auto", padding: "0 16px" }}>
		<PaywallCTA billingState={makeFreeBillingState(0)} compact />
	</div>
);
Compact.meta = { description: "Compact variant used inside dialogs." };

export const CompactWithCredits: Story = () => (
	<div style={{ maxWidth: 400, margin: "40px auto", padding: "0 16px" }}>
		<PaywallCTA billingState={makeFreeBillingState(23)} compact />
	</div>
);
CompactWithCredits.meta = {
	description: "Compact + 23 remaining credits — discount note on unlimited.",
};
