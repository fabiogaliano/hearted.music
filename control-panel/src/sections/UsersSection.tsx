import { DatabaseIcon, UserPlusIcon, UsersIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { BatchLauncher } from "../components/BatchLauncher";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import {
	Badge,
	Bar,
	Card,
	ErrorState,
	Loading,
	Sparkline,
	Stat,
	UserLink,
} from "../components/primitives";
import { useApi } from "../lib/api";
import { fmt, humanDate, pct } from "../lib/format";
import { readOperatorLabel } from "../lib/operator";
import type { PageResult, UserRow, UsersMetrics } from "../lib/types";

const columns: DataTableColumn<UserRow>[] = [
	{
		key: "label",
		header: "Account",
		sortable: true,
		render: (r) => <UserLink id={r.id} label={r.label} handle={r.handle} />,
	},
	{
		key: "lastSeenAt",
		header: "Last seen",
		sortable: true,
		render: (r) => <span className="dim">{humanDate(r.lastSeenAt)}</span>,
	},
	{
		key: "plan",
		header: "Plan",
		render: (r) =>
			r.unlimited ? (
				<Badge tone="accent">unlimited</Badge>
			) : (
				<span className="dim">{r.plan ?? "—"}</span>
			),
	},
	{
		key: "liked",
		header: "Liked",
		sortable: true,
		right: true,
		render: (r) => <span className="cell-num">{fmt(r.liked)}</span>,
	},
	{
		key: "playlists",
		header: "Playlists",
		sortable: true,
		right: true,
		render: (r) => <span className="cell-num">{fmt(r.playlists)}</span>,
	},
	{
		key: "unlocks",
		header: "Unlocks",
		sortable: true,
		right: true,
		render: (r) =>
			r.unlocks > 0 ? (
				<span className="cell-num">{fmt(r.unlocks)}</span>
			) : (
				<span className="dim">—</span>
			),
	},
	{
		key: "onboarding",
		header: "Onboarding",
		render: (r) =>
			r.onboarded ? (
				<Badge tone="success">complete</Badge>
			) : r.onboardingStep ? (
				<Badge tone="warning">{r.onboardingStep}</Badge>
			) : (
				<span className="dim">not started</span>
			),
	},
	{
		key: "createdAt",
		header: "Joined",
		sortable: true,
		render: (r) => <span className="dim">{humanDate(r.createdAt)}</span>,
	},
];

type TableState = {
	search: string;
	plan: string;
	access: "all" | "unlimited" | "limited";
	library: "all" | "synced" | "none";
	onboarding: "all" | "complete" | "incomplete" | "not_started";
	lastSeen: "all" | "24h" | "7d" | "30d" | "inactive_30d" | "never";
	sort: string;
	direction: "asc" | "desc";
	page: number;
	pageSize: 25 | 50 | 100;
};

function enumValue<T extends string>(
	value: string,
	allowed: readonly T[],
	fallback: T,
): T {
	return allowed.find((candidate) => candidate === value) ?? fallback;
}

function readTableState(): TableState {
	const params = new URL(window.location.href).searchParams;
	const pageSize = params.get("pageSize");
	const page = Number(params.get("page"));
	return {
		search: params.get("q") ?? "",
		plan: params.get("plan") ?? "",
		access: enumValue(
			params.get("access") ?? "",
			["all", "unlimited", "limited"],
			"all",
		),
		library: enumValue(
			params.get("library") ?? "",
			["all", "synced", "none"],
			"all",
		),
		onboarding: enumValue(
			params.get("onboarding") ?? "",
			["all", "complete", "incomplete", "not_started"],
			"all",
		),
		lastSeen: enumValue(
			params.get("lastSeen") ?? "",
			["all", "24h", "7d", "30d", "inactive_30d", "never"],
			"all",
		),
		sort: params.get("sort") ?? "createdAt",
		direction: params.get("direction") === "asc" ? "asc" : "desc",
		page: Number.isInteger(page) && page > 0 ? page : 1,
		pageSize: pageSize === "25" ? 25 : pageSize === "100" ? 100 : 50,
	};
}

const PLAN_OPTIONS = [
	{ value: "", label: "All plans" },
	{ value: "free", label: "Free" },
	{ value: "quarterly", label: "Quarterly" },
	{ value: "yearly", label: "Yearly" },
];

export function UsersSection({ refreshKey }: { refreshKey: number }) {
	const { data, error } = useApi<UsersMetrics>(
		"/api/metrics/users",
		refreshKey,
	);
	const [table, setTable] = useState<TableState>(readTableState);
	const [filtersOpen, setFiltersOpen] = useState(false);
	const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [selectAllMatching, setSelectAllMatching] = useState(false);
	const [grantOpen, setGrantOpen] = useState(false);
	const [grantLimit, setGrantLimit] = useState("500");
	useEffect(() => {
		const onPopState = () => setTable(readTableState());
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	function updateTable(patch: Partial<TableState>) {
		const next = { ...table, ...patch };
		setTable(next);
		// Paging/page-size alone doesn't change which rows match; anything else
		// (search, a filter, sort, or Reset) invalidates a "select all matching".
		const filterKeys: (keyof TableState)[] = [
			"search",
			"plan",
			"access",
			"library",
			"onboarding",
			"lastSeen",
			"sort",
			"direction",
		];
		if (filterKeys.some((key) => key in patch)) setSelectAllMatching(false);
		const url = new URL(window.location.href);
		url.searchParams.set("q", next.search);
		for (const key of [
			"plan",
			"access",
			"library",
			"onboarding",
			"lastSeen",
		] as const) {
			const value = next[key];
			if (value && value !== "all") url.searchParams.set(key, value);
			else url.searchParams.delete(key);
		}
		url.searchParams.set("sort", next.sort);
		url.searchParams.set("direction", next.direction);
		url.searchParams.set("page", String(next.page));
		url.searchParams.set("pageSize", String(next.pageSize));
		window.history.pushState({ controlPanel: true }, "", url);
	}

	const params = new URLSearchParams({
		q: table.search,
		plan: table.plan,
		access: table.access,
		library: table.library,
		onboarding: table.onboarding,
		lastSeen: table.lastSeen,
		sort: table.sort,
		direction: table.direction,
		page: String(table.page),
		pageSize: String(table.pageSize),
	});
	const list = useApi<PageResult<UserRow>>(
		`/api/users/list?${params.toString()}`,
		refreshKey,
	);
	const users = list.data?.rows ?? [];
	const activeFilterCount = [
		table.plan !== "",
		table.access !== "all",
		table.library !== "all",
		table.onboarding !== "all",
		table.lastSeen !== "all",
	].filter(Boolean).length;
	useEffect(() => {
		// "Select all matching" is a standing intent, not a snapshot of loaded
		// rows, so a page's rows disappearing from view shouldn't prune it.
		if (selectAllMatching) return;
		setSelectedIds((current) => {
			const valid = new Set(users.map((row) => row.id));
			const next = new Set([...current].filter((id) => valid.has(id)));
			return next.size === current.size ? current : next;
		});
	}, [users, selectAllMatching]);
	if (error) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	return (
		<div className="grid">
			<Card span={3}>
				<Stat
					label="Total accounts"
					value={data.totalAccounts}
					icon={UsersIcon}
				/>
			</Card>
			<Card span={3}>
				<Stat
					label="New today"
					value={data.signups1d}
					icon={UserPlusIcon}
					sub={
						<>
							<strong>{data.signups7d}</strong> in 7d ·{" "}
							<strong>{data.signups30d}</strong> in 30d
						</>
					}
				/>
			</Card>
			<Card span={3}>
				<Stat
					label="With synced library"
					value={data.accountsWithLibrary}
					icon={DatabaseIcon}
					sub={
						<>
							<strong>
								{pct(data.accountsWithLibrary, data.totalAccounts)}%
							</strong>{" "}
							of accounts
						</>
					}
				/>
			</Card>
			<Card span={3}>
				<Stat label="Waitlist" value={data.waitlistTotal} icon={UserPlusIcon} />
			</Card>

			<Card title="Signups · last 14 days" icon={UserPlusIcon} span={8}>
				<Sparkline points={data.signupTrend.map((d) => d.count)} />
			</Card>

			<Card title="Library adoption" icon={DatabaseIcon} span={4}>
				<Bar
					label="Synced"
					value={data.accountsWithLibrary}
					max={data.totalAccounts}
				/>
				<Bar
					label="No library"
					value={data.accountsWithoutLibrary}
					max={data.totalAccounts}
					tone="muted"
				/>
			</Card>

			<Card title="All accounts" icon={UsersIcon} span={12}>
				{(selectedIds.size > 0 || selectAllMatching) && (
					<div className="batch-bar">
						<span>
							{selectAllMatching
								? `All ${list.data?.total ?? 0} matching selected`
								: `${selectedIds.size} selected`}
						</span>
						<button
							type="button"
							className="btn primary"
							onClick={() => setGrantOpen(true)}
						>
							Grant song access…
						</button>
					</div>
				)}
				{grantOpen && (
					<BatchLauncher
						actionType="grant-batch"
						title="Grant song access — batch"
						description="Runs each eligible account through the same shared grant helper as a single grant. Already-granted accounts are skipped. This writes to production and is not reversible."
						buildInput={() => {
							const base = {
								limit: Number(grantLimit) || 500,
								requestedBy: readOperatorLabel() || null,
							};
							return selectAllMatching
								? {
										...base,
										filter: {
											q: table.search,
											plan: table.plan,
											access: table.access,
											library: table.library,
											onboarding: table.onboarding,
											lastSeen: table.lastSeen,
										},
									}
								: { ...base, accountIds: [...selectedIds] };
						}}
						onClose={() => setGrantOpen(false)}
						onCommitted={() => {
							setSelectedIds(new Set());
							setSelectAllMatching(false);
						}}
					>
						<div className="field">
							<label htmlFor="grant-batch-limit">
								Songs to unlock per account
							</label>
							<input
								id="grant-batch-limit"
								className="input"
								type="number"
								min={1}
								max={10000}
								value={grantLimit}
								onChange={(event) => setGrantLimit(event.target.value)}
							/>
						</div>
					</BatchLauncher>
				)}
				<DataTable
					tableId="users"
					columns={columns}
					rows={users}
					total={list.data?.total ?? 0}
					page={list.data?.page ?? table.page}
					pageSize={list.data?.pageSize ?? table.pageSize}
					search={table.search}
					filters={
						<>
							<button
								type="button"
								className="btn"
								aria-expanded={filtersOpen}
								onClick={() => setFiltersOpen((open) => !open)}
							>
								Filters
								{activeFilterCount > 0 && (
									<Badge tone="accent">{activeFilterCount}</Badge>
								)}
							</button>
							{filtersOpen && (
								<>
									<select
										className="select"
										aria-label="Plan"
										value={table.plan}
										onChange={(event) =>
											updateTable({ plan: event.target.value, page: 1 })
										}
									>
										{PLAN_OPTIONS.map((o) => (
											<option key={o.value} value={o.value}>
												{o.label}
											</option>
										))}
									</select>
									<select
										className="select"
										aria-label="Access"
										value={table.access}
										onChange={(event) =>
											updateTable({
												access: enumValue<TableState["access"]>(
													event.target.value,
													["all", "unlimited", "limited"],
													"all",
												),
												page: 1,
											})
										}
									>
										<option value="all">All access</option>
										<option value="unlimited">Unlimited</option>
										<option value="limited">Limited</option>
									</select>
									<select
										className="select"
										aria-label="Library"
										value={table.library}
										onChange={(event) =>
											updateTable({
												library: enumValue<TableState["library"]>(
													event.target.value,
													["all", "synced", "none"],
													"all",
												),
												page: 1,
											})
										}
									>
										<option value="all">All libraries</option>
										<option value="synced">Synced</option>
										<option value="none">No library</option>
									</select>
									<select
										className="select"
										aria-label="Onboarding"
										value={table.onboarding}
										onChange={(event) =>
											updateTable({
												onboarding: enumValue<TableState["onboarding"]>(
													event.target.value,
													["all", "complete", "incomplete", "not_started"],
													"all",
												),
												page: 1,
											})
										}
									>
										<option value="all">All onboarding</option>
										<option value="complete">Complete</option>
										<option value="incomplete">Incomplete</option>
										<option value="not_started">Not started</option>
									</select>
									<select
										className="select"
										aria-label="Last seen"
										value={table.lastSeen}
										onChange={(event) =>
											updateTable({
												lastSeen: enumValue<TableState["lastSeen"]>(
													event.target.value,
													["all", "24h", "7d", "30d", "inactive_30d", "never"],
													"all",
												),
												page: 1,
											})
										}
									>
										<option value="all">Any activity</option>
										<option value="24h">Last 24h</option>
										<option value="7d">Last 7d</option>
										<option value="30d">Last 30d</option>
										<option value="inactive_30d">Inactive 30d</option>
										<option value="never">Never seen</option>
									</select>
								</>
							)}
						</>
					}
					hasActiveFilters={activeFilterCount > 0}
					sort={table.sort}
					direction={table.direction}
					getRowId={(row) => row.id}
					selection={{
						selectedIds: selectAllMatching
							? new Set(users.map((row) => row.id))
							: selectedIds,
						onToggleRow: (id) =>
							setSelectedIds((current) => {
								const next = new Set(current);
								if (next.has(id)) next.delete(id);
								else next.add(id);
								setSelectAllMatching(false);
								return next;
							}),
						onTogglePage: (selected) =>
							setSelectedIds((current) => {
								const next = new Set(current);
								for (const row of users) {
									if (selected) next.add(row.id);
									else next.delete(row.id);
								}
								setSelectAllMatching(false);
								return next;
							}),
						onSelectAllMatching: () => setSelectAllMatching(true),
					}}
					onSearchChange={(search) => updateTable({ search, page: 1 })}
					onSortChange={(sort) =>
						updateTable({
							sort,
							direction:
								table.sort === sort && table.direction === "asc"
									? "desc"
									: "asc",
							page: 1,
						})
					}
					onPageChange={(page) => updateTable({ page })}
					onPageSizeChange={(pageSize) => updateTable({ pageSize, page: 1 })}
					onReset={() =>
						updateTable({
							search: "",
							plan: "",
							access: "all",
							library: "all",
							onboarding: "all",
							lastSeen: "all",
							sort: "createdAt",
							direction: "desc",
							page: 1,
							pageSize: 50,
						})
					}
					loading={list.loading}
					refreshing={list.refreshing}
					error={list.error}
					onRetry={list.refetch}
					empty="No accounts exist."
					noMatches="No accounts match these filters."
					exportUrl="/api/exports/users"
				/>
			</Card>
		</div>
	);
}
