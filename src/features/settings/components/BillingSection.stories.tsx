import type { Story } from "@ladle/react";
import type { BillingState } from "@/lib/domains/billing/state";
import { BillingSection } from "./BillingSection";

export default {
	title: "Settings/BillingSection",
};

function Wrapper({ children }: { children: React.ReactNode }) {
	return (
		<div style={{ maxWidth: 560, margin: "40px auto", padding: "0 24px" }}>
			{children}
		</div>
	);
}

function billing(overrides: Partial<BillingState> = {}): BillingState {
	return {
		plan: "free",
		creditBalance: 0,
		subscriptionStatus: "none",
		cancelAtPeriodEnd: false,
		subscriptionPeriodEnd: null,
		unlimitedAccess: { kind: "none" },
		queueBand: "low",
		...overrides,
	};
}

// ── Free ────────────────────────────────────────────────────────────

export const Free: Story = () => (
	<Wrapper>
		<BillingSection billingState={billing()} />
	</Wrapper>
);
Free.meta = {
	description: "New free user. Shows pack + unlimited CTAs, no discount.",
};

// ── Song Pack ───────────────────────────────────────────────────────

export const PackWithBalance: Story = () => (
	<Wrapper>
		<BillingSection
			billingState={billing({ creditBalance: 496, queueBand: "standard" })}
		/>
	</Wrapper>
);
PackWithBalance.meta = {
	description:
		"Pack user, 496 remaining. Discount on unlimited, confirmation dialog on Song Pack click.",
};

// ── Subscription (active / ending / past due) ───────────────────────

export const SubscriptionActive: Story = () => (
	<Wrapper>
		<div style={{ display: "flex", flexDirection: "column", gap: 48 }}>
			<div>
				<p
					style={{
						fontSize: 11,
						textTransform: "uppercase",
						letterSpacing: "0.1em",
						opacity: 0.4,
						marginBottom: 12,
					}}
				>
					Backstage Pass
				</p>
				<BillingSection
					billingState={billing({
						plan: "yearly",
						subscriptionStatus: "active",
						unlimitedAccess: { kind: "subscription" },
						queueBand: "priority",
					})}
				/>
			</div>
			<div>
				<p
					style={{
						fontSize: 11,
						textTransform: "uppercase",
						letterSpacing: "0.1em",
						opacity: 0.4,
						marginBottom: 12,
					}}
				>
					3-Month Unlimited
				</p>
				<BillingSection
					billingState={billing({
						plan: "quarterly",
						subscriptionStatus: "active",
						unlimitedAccess: { kind: "subscription" },
						queueBand: "standard",
					})}
				/>
			</div>
		</div>
	</Wrapper>
);
SubscriptionActive.meta = {
	description:
		"Active subscriptions — yearly and quarterly side by side. Green dot, portal link.",
};

export const SubscriptionEnding: Story = () => (
	<Wrapper>
		<div style={{ display: "flex", flexDirection: "column", gap: 48 }}>
			<div>
				<p
					style={{
						fontSize: 11,
						textTransform: "uppercase",
						letterSpacing: "0.1em",
						opacity: 0.4,
						marginBottom: 12,
					}}
				>
					Backstage Pass
				</p>
				<BillingSection
					billingState={billing({
						plan: "yearly",
						subscriptionStatus: "ending",
						cancelAtPeriodEnd: true,
						subscriptionPeriodEnd: "2027-02-14T00:00:00Z",
						unlimitedAccess: { kind: "subscription" },
						queueBand: "priority",
					})}
				/>
			</div>
			<div>
				<p
					style={{
						fontSize: 11,
						textTransform: "uppercase",
						letterSpacing: "0.1em",
						opacity: 0.4,
						marginBottom: 12,
					}}
				>
					3-Month Unlimited
				</p>
				<BillingSection
					billingState={billing({
						plan: "quarterly",
						subscriptionStatus: "ending",
						cancelAtPeriodEnd: true,
						subscriptionPeriodEnd: "2026-08-11T00:00:00Z",
						unlimitedAccess: { kind: "subscription" },
						queueBand: "standard",
					})}
				/>
			</div>
		</div>
	</Wrapper>
);
SubscriptionEnding.meta = {
	description:
		"Canceling subscriptions — both plans. Orange dot, 'Cancels at end of period'.",
};

export const SubscriptionPastDue: Story = () => (
	<Wrapper>
		<BillingSection
			billingState={billing({
				plan: "yearly",
				subscriptionStatus: "past_due",
				unlimitedAccess: { kind: "subscription" },
				queueBand: "priority",
			})}
		/>
	</Wrapper>
);
SubscriptionPastDue.meta = {
	description: "Payment failed. Red dot, 'Payment failed', portal link.",
};

// ── Self-hosted ─────────────────────────────────────────────────────

export const SelfHosted: Story = () => (
	<Wrapper>
		<BillingSection
			billingState={billing({
				unlimitedAccess: { kind: "self_hosted" },
				queueBand: "priority",
			})}
		/>
	</Wrapper>
);
SelfHosted.meta = {
	description: "Self-hosted unlimited — no actions, no portal.",
};
