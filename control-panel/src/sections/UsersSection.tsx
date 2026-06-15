import { DatabaseIcon, UserPlusIcon, UsersIcon } from "@phosphor-icons/react";
import {
	Badge,
	Bar,
	Card,
	type Column,
	ErrorState,
	Loading,
	Sparkline,
	Stat,
	Table,
	UserLink,
} from "../components/primitives";
import { useApi } from "../lib/api";
import { fmt, pct, relativeTime } from "../lib/format";
import type { UserRow, UsersMetrics } from "../lib/types";

const columns: Column<UserRow>[] = [
	{
		key: "user",
		header: "Account",
		render: (r) => <UserLink id={r.id} label={r.label} handle={r.handle} />,
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
		key: "liked",
		header: "Liked",
		right: true,
		render: (r) => <span className="cell-num">{fmt(r.liked)}</span>,
	},
	{
		key: "playlists",
		header: "Playlists",
		right: true,
		render: (r) => <span className="cell-num">{fmt(r.playlists)}</span>,
	},
	{
		key: "unlocks",
		header: "Unlocks",
		right: true,
		render: (r) =>
			r.unlocks > 0 ? (
				<span className="cell-num">{fmt(r.unlocks)}</span>
			) : (
				<span className="dim">—</span>
			),
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
		key: "joined",
		header: "Joined",
		right: true,
		render: (r) => <span className="dim">{relativeTime(r.createdAt)}</span>,
	},
];

export function UsersSection({ refreshKey }: { refreshKey: number }) {
	const { data, error } = useApi<UsersMetrics>(
		"/api/metrics/users",
		refreshKey,
	);
	const list = useApi<{ users: UserRow[] }>("/api/users/list", refreshKey);
	if (error) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	const users = list.data?.users ?? [];

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
				<Table
					columns={columns}
					rows={users}
					empty={list.loading ? "Loading accounts…" : "No accounts."}
				/>
				{users.length > 0 && (
					<div className="stat-sub" style={{ marginTop: 12 }}>
						{users.length === 500 ? "First 500" : `${users.length}`} accounts,
						newest first · click any account to see their library
					</div>
				)}
			</Card>
		</div>
	);
}
