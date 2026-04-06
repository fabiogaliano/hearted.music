import type { Story } from "@ladle/react";
import { BillingSection } from "./BillingSection";
function Wrapper({ children }: { children: React.ReactNode }) {
	return (
		<div style={{ maxWidth: 560, margin: "40px auto", padding: "0 24px" }}>
			{children}
		</div>
	);
}

export const FreePlan: Story = () => (
	<Wrapper>
		<BillingSection
			billingState={{
				plan: "free",
				creditBalance: 15,
				subscriptionStatus: "none",
				cancelAtPeriodEnd: false,
				unlimitedAccess: { kind: "none" },
				queueBand: "low",
			}}
		/>
	</Wrapper>
);
FreePlan.meta = { description: "Free plan with 15 song credits remaining." };

export const SongPack: Story = () => (
	<Wrapper>
		<BillingSection
			billingState={{
				plan: "free",
				creditBalance: 450,
				subscriptionStatus: "none",
				cancelAtPeriodEnd: false,
				unlimitedAccess: { kind: "none" },
				queueBand: "standard",
			}}
		/>
	</Wrapper>
);
SongPack.meta = { description: "Song pack purchased — 450 credits remaining." };

export const ActiveYearly: Story = () => (
	<Wrapper>
		<BillingSection
			billingState={{
				plan: "yearly",
				creditBalance: 0,
				subscriptionStatus: "active",
				cancelAtPeriodEnd: false,
				unlimitedAccess: { kind: "subscription" },
				queueBand: "priority",
			}}
		/>
	</Wrapper>
);
ActiveYearly.meta = {
	description: "Active yearly subscription. Shows 'Manage subscription' link.",
};

export const EndingSubscription: Story = () => (
	<Wrapper>
		<BillingSection
			billingState={{
				plan: "yearly",
				creditBalance: 0,
				subscriptionStatus: "ending",
				cancelAtPeriodEnd: true,
				unlimitedAccess: { kind: "subscription" },
				queueBand: "priority",
			}}
		/>
	</Wrapper>
);
EndingSubscription.meta = {
	description: "Subscription will cancel at period end (orange dot).",
};

export const PastDue: Story = () => (
	<Wrapper>
		<BillingSection
			billingState={{
				plan: "yearly",
				creditBalance: 0,
				subscriptionStatus: "past_due",
				cancelAtPeriodEnd: false,
				unlimitedAccess: { kind: "subscription" },
				queueBand: "priority",
			}}
		/>
	</Wrapper>
);
PastDue.meta = { description: "Subscription is past due (red dot)." };

export const SelfHosted: Story = () => (
	<Wrapper>
		<BillingSection
			billingState={{
				plan: "free",
				creditBalance: 0,
				subscriptionStatus: "none",
				cancelAtPeriodEnd: false,
				unlimitedAccess: { kind: "self_hosted" },
				queueBand: "priority",
			}}
		/>
	</Wrapper>
);
SelfHosted.meta = {
	description: "Self-hosted unlimited — no portal link, no pack entry.",
};
