import {
	CoinsIcon,
	CreditCardIcon,
	GiftIcon,
	SealCheckIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { DataTable, type DataTableColumn } from "../components/DataTable";
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
import type {
	BillingMetrics,
	GrantRow,
	PageResult,
	SubscriptionRow,
} from "../lib/types";
import { useUrlView } from "../lib/url-state";

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

const grantColumns: DataTableColumn<GrantRow>[] = [
	{
		key: "account",
		header: "Account",
		render: (r) => <span className="primary">{r.accountLabel}</span>,
	},
	{
		key: "origin",
		header: "Origin",
		sortable: true,
		render: (r) => (
			<Badge tone={r.status === "pending" ? "warning" : "success"}>
				{r.origin}
			</Badge>
		),
	},
	{ key: "status", header: "Status", render: (r) => <span>{r.status}</span> },
	{
		key: "createdAt",
		header: "Created",
		sortable: true,
		render: (r) => <span className="dim">{r.createdAt}</span>,
	},
	{
		key: "requestedBy",
		header: "Requested by",
		render: (r) => <span className="dim">{r.requestedBy ?? "—"}</span>,
	},
];
const subscriptionColumns: DataTableColumn<SubscriptionRow>[] = [
	{
		key: "account",
		header: "Account",
		render: (r) => <span className="primary">{r.accountLabel}</span>,
	},
	{
		key: "plan",
		header: "Plan",
		sortable: true,
		render: (r) => <span>{r.plan ?? "—"}</span>,
	},
	{
		key: "status",
		header: "Status",
		sortable: true,
		render: (r) => (
			<Badge tone={r.status === "active" ? "success" : "default"}>
				{r.status}
			</Badge>
		),
	},
	{
		key: "periodEnd",
		header: "Period end",
		sortable: true,
		render: (r) => <span className="dim">{r.periodEnd ?? "—"}</span>,
	},
	{
		key: "gift",
		header: "Gift",
		render: (r) =>
			r.syntheticGift ? (
				<Badge tone="accent">synthetic</Badge>
			) : (
				<span className="dim">—</span>
			),
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

type GrantTableState = {
	search: string;
	status: "all" | "pending" | "applied";
	origin: string;
	sort: string;
	direction: "asc" | "desc";
	page: number;
	pageSize: 25 | 50 | 100;
};

type SubscriptionTableState = {
	search: string;
	gift: "all" | "synthetic";
	sort: string;
	direction: "asc" | "desc";
	page: number;
	pageSize: 25 | 50 | 100;
};

function readGrantTableState(): GrantTableState {
	const params = new URL(window.location.href).searchParams;
	const pageSize = params.get("gPageSize");
	const page = Number(params.get("gPage"));
	const status = params.get("gStatus");
	return {
		search: params.get("gQ") ?? "",
		status: status === "pending" || status === "applied" ? status : "all",
		origin: params.get("gOrigin") ?? "",
		sort: params.get("gSort") ?? "createdAt",
		direction: params.get("gDirection") === "asc" ? "asc" : "desc",
		page: Number.isInteger(page) && page > 0 ? page : 1,
		pageSize: pageSize === "25" ? 25 : pageSize === "100" ? 100 : 50,
	};
}

function readSubscriptionTableState(): SubscriptionTableState {
	const params = new URL(window.location.href).searchParams;
	const pageSize = params.get("sPageSize");
	const page = Number(params.get("sPage"));
	return {
		search: params.get("sQ") ?? "",
		gift: params.get("sGift") === "synthetic" ? "synthetic" : "all",
		sort: params.get("sSort") ?? "account",
		direction: params.get("sDirection") === "desc" ? "desc" : "asc",
		page: Number.isInteger(page) && page > 0 ? page : 1,
		pageSize: pageSize === "25" ? 25 : pageSize === "100" ? 100 : 50,
	};
}

export function BillingSection({ refreshKey }: { refreshKey: number }) {
	const { data, error } = useApi<BillingMetrics>(
		"/api/metrics/billing",
		refreshKey,
	);
	const [tab, setTab] = useUrlView(
		["grants", "subscriptions"] as const,
		"grants",
	);

	const [grantTable, setGrantTable] =
		useState<GrantTableState>(readGrantTableState);
	const [subTable, setSubTable] = useState<SubscriptionTableState>(
		readSubscriptionTableState,
	);
	useEffect(() => {
		const onPopState = () => {
			setGrantTable(readGrantTableState());
			setSubTable(readSubscriptionTableState());
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	function updateGrantTable(patch: Partial<GrantTableState>) {
		const next = { ...grantTable, ...patch };
		setGrantTable(next);
		const url = new URL(window.location.href);
		if (next.search) url.searchParams.set("gQ", next.search);
		else url.searchParams.delete("gQ");
		if (next.status !== "all") url.searchParams.set("gStatus", next.status);
		else url.searchParams.delete("gStatus");
		if (next.origin) url.searchParams.set("gOrigin", next.origin);
		else url.searchParams.delete("gOrigin");
		url.searchParams.set("gSort", next.sort);
		url.searchParams.set("gDirection", next.direction);
		url.searchParams.set("gPage", String(next.page));
		url.searchParams.set("gPageSize", String(next.pageSize));
		window.history.pushState({ controlPanel: true }, "", url);
	}

	function updateSubTable(patch: Partial<SubscriptionTableState>) {
		const next = { ...subTable, ...patch };
		setSubTable(next);
		const url = new URL(window.location.href);
		if (next.search) url.searchParams.set("sQ", next.search);
		else url.searchParams.delete("sQ");
		if (next.gift !== "all") url.searchParams.set("sGift", next.gift);
		else url.searchParams.delete("sGift");
		url.searchParams.set("sSort", next.sort);
		url.searchParams.set("sDirection", next.direction);
		url.searchParams.set("sPage", String(next.page));
		url.searchParams.set("sPageSize", String(next.pageSize));
		window.history.pushState({ controlPanel: true }, "", url);
	}

	const grantParams = new URLSearchParams({
		q: grantTable.search,
		status: grantTable.status,
		origin: grantTable.origin,
		sort: grantTable.sort,
		direction: grantTable.direction,
		page: String(grantTable.page),
		pageSize: String(grantTable.pageSize),
	});
	const subParams = new URLSearchParams({
		q: subTable.search,
		gift: subTable.gift,
		sort: subTable.sort,
		direction: subTable.direction,
		page: String(subTable.page),
		pageSize: String(subTable.pageSize),
	});
	const grants = useApi<PageResult<GrantRow>>(
		`/api/billing/grants?${grantParams.toString()}`,
	);
	const subscriptions = useApi<PageResult<SubscriptionRow>>(
		`/api/billing/subscriptions?${subParams.toString()}`,
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

			<Card title="Billing detail" icon={CreditCardIcon} span={12}>
				<div className="btn-row" style={{ marginBottom: 12 }}>
					<button
						type="button"
						className={`btn ${tab === "grants" ? "primary" : ""}`}
						onClick={() => setTab("grants")}
					>
						Grants
					</button>
					<button
						type="button"
						className={`btn ${tab === "subscriptions" ? "primary" : ""}`}
						onClick={() => setTab("subscriptions")}
					>
						Subscriptions
					</button>
				</div>
				{tab === "grants" ? (
					<DataTable
						tableId="billing-grants"
						columns={grantColumns}
						rows={grants.data?.rows ?? []}
						total={grants.data?.total ?? 0}
						page={grants.data?.page ?? grantTable.page}
						pageSize={grants.data?.pageSize ?? grantTable.pageSize}
						search={grantTable.search}
						filters={
							<>
								<select
									className="select"
									aria-label="Status"
									value={grantTable.status}
									onChange={(event) =>
										updateGrantTable({
											status:
												event.target.value === "pending" ||
												event.target.value === "applied"
													? event.target.value
													: "all",
											page: 1,
										})
									}
								>
									<option value="all">All statuses</option>
									<option value="pending">Pending</option>
									<option value="applied">Applied</option>
								</select>
								<input
									className="input"
									aria-label="Origin"
									placeholder="Origin…"
									value={grantTable.origin}
									onChange={(event) =>
										updateGrantTable({ origin: event.target.value, page: 1 })
									}
								/>
							</>
						}
						hasActiveFilters={
							grantTable.status !== "all" || grantTable.origin !== ""
						}
						sort={grantTable.sort}
						direction={grantTable.direction}
						getRowId={(row) => row.id}
						onSearchChange={(search) => updateGrantTable({ search, page: 1 })}
						onSortChange={(sort) =>
							updateGrantTable({
								sort,
								direction:
									grantTable.sort === sort && grantTable.direction === "asc"
										? "desc"
										: "asc",
								page: 1,
							})
						}
						onPageChange={(page) => updateGrantTable({ page })}
						onPageSizeChange={(pageSize) =>
							updateGrantTable({ pageSize, page: 1 })
						}
						onReset={() =>
							updateGrantTable({
								search: "",
								status: "all",
								origin: "",
								sort: "createdAt",
								direction: "desc",
								page: 1,
								pageSize: 50,
							})
						}
						loading={grants.loading}
						refreshing={grants.refreshing}
						error={grants.error}
						onRetry={grants.refetch}
						empty="No grants issued yet."
						noMatches="No grants match these filters."
						exportUrl="/api/exports/billing-grants"
					/>
				) : (
					<DataTable
						tableId="billing-subscriptions"
						columns={subscriptionColumns}
						rows={subscriptions.data?.rows ?? []}
						total={subscriptions.data?.total ?? 0}
						page={subscriptions.data?.page ?? subTable.page}
						pageSize={subscriptions.data?.pageSize ?? subTable.pageSize}
						search={subTable.search}
						filters={
							<select
								className="select"
								aria-label="Gift"
								value={subTable.gift}
								onChange={(event) =>
									updateSubTable({
										gift:
											event.target.value === "synthetic" ? "synthetic" : "all",
										page: 1,
									})
								}
							>
								<option value="all">All subscriptions</option>
								<option value="synthetic">Synthetic gifts</option>
							</select>
						}
						hasActiveFilters={subTable.gift !== "all"}
						sort={subTable.sort}
						direction={subTable.direction}
						getRowId={(row) => row.accountId}
						onSearchChange={(search) => updateSubTable({ search, page: 1 })}
						onSortChange={(sort) =>
							updateSubTable({
								sort,
								direction:
									subTable.sort === sort && subTable.direction === "asc"
										? "desc"
										: "asc",
								page: 1,
							})
						}
						onPageChange={(page) => updateSubTable({ page })}
						onPageSizeChange={(pageSize) =>
							updateSubTable({ pageSize, page: 1 })
						}
						onReset={() =>
							updateSubTable({
								search: "",
								gift: "all",
								sort: "account",
								direction: "asc",
								page: 1,
								pageSize: 50,
							})
						}
						loading={subscriptions.loading}
						refreshing={subscriptions.refreshing}
						error={subscriptions.error}
						onRetry={subscriptions.refetch}
						empty="No subscriptions found."
						noMatches="No subscriptions match these filters."
						exportUrl="/api/exports/billing-subscriptions"
					/>
				)}
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
