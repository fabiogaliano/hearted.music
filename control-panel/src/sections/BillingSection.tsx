import {
	CoinsIcon,
	CreditCardIcon,
	GiftIcon,
	SealCheckIcon,
} from "@phosphor-icons/react";
import {
	Badge,
	Card,
	type Column,
	ErrorState,
	Loading,
	Stat,
	Table,
} from "../components/primitives";
import { useApi } from "../lib/api";
import { fmt } from "../lib/format";
import type { BillingMetrics } from "../lib/types";

type PlanRow = BillingMetrics["plans"][number];
type OriginRow = BillingMetrics["grants"]["byOrigin"][number];

const planColumns: Column<PlanRow>[] = [
	{
		key: "plan",
		header: "Plan",
		render: (r) => <span className="primary">{r.plan}</span>,
	},
	{
		key: "status",
		header: "Subscription",
		render: (r) => (
			<Badge tone={r.status === "active" ? "success" : "default"}>
				{r.status}
			</Badge>
		),
	},
	{
		key: "accounts",
		header: "Accounts",
		right: true,
		render: (r) => <span className="cell-num">{fmt(r.accounts)}</span>,
	},
];

const originColumns: Column<OriginRow>[] = [
	{
		key: "origin",
		header: "Origin",
		render: (r) => <span className="primary">{r.origin}</span>,
	},
	{
		key: "applied",
		header: "Applied",
		right: true,
		render: (r) => <span className="cell-num">{fmt(r.applied)}</span>,
	},
	{
		key: "pending",
		header: "Pending",
		right: true,
		render: (r) =>
			r.pending > 0 ? (
				<span className="cell-num" style={{ color: "var(--warning)" }}>
					{r.pending}
				</span>
			) : (
				<span className="dim">—</span>
			),
	},
];

export function BillingSection({ refreshKey }: { refreshKey: number }) {
	const { data, error } = useApi<BillingMetrics>(
		"/api/metrics/billing",
		refreshKey,
	);
	if (error) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	return (
		<div className="grid">
			<Card span={3}>
				<Stat
					label="Active subscriptions"
					value={data.activeSubscriptions}
					icon={SealCheckIcon}
				/>
			</Card>
			<Card span={3}>
				<Stat
					label="Credit balance"
					value={data.creditBalanceTotal}
					icon={CoinsIcon}
					sub="summed across accounts"
				/>
			</Card>
			<Card span={3}>
				<Stat
					label="Grants applied"
					value={data.grants.applied}
					icon={GiftIcon}
					sub={
						<>
							of <strong>{data.grants.total}</strong> total
						</>
					}
				/>
			</Card>
			<Card span={3}>
				<Stat
					label="Grants pending"
					value={data.grants.pending}
					icon={GiftIcon}
					sub="awaiting next sync"
				/>
			</Card>

			<Card title="Plans & subscription status" icon={CreditCardIcon} span={6}>
				<Table
					columns={planColumns}
					rows={data.plans}
					empty="No billing rows."
				/>
			</Card>

			<Card title="Liked-song grants by origin" icon={GiftIcon} span={6}>
				<Table
					columns={originColumns}
					rows={data.grants.byOrigin}
					empty="No grants issued yet."
				/>
			</Card>
		</div>
	);
}
