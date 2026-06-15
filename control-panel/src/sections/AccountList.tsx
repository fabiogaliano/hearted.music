import { HeartIcon } from "@phosphor-icons/react";
import {
	Card,
	type Column,
	ErrorState,
	Loading,
	Table,
	UserLink,
} from "../components/primitives";
import { useApi } from "../lib/api";
import { fmt, relativeTime } from "../lib/format";
import type { AccountLikedRow } from "../lib/types";
import type { AccountListQuery } from "../lib/user-selection";

const columns: Column<AccountLikedRow>[] = [
	{
		key: "user",
		header: "Account",
		render: (r) => <UserLink id={r.id} label={r.label} handle={r.handle} />,
	},
	{
		key: "email",
		header: "Email",
		render: (r) => <span className="dim num">{r.email ?? "—"}</span>,
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
		key: "joined",
		header: "Joined",
		right: true,
		render: (r) => <span className="dim">{relativeTime(r.createdAt)}</span>,
	},
];

export function AccountList({ query }: { query: AccountListQuery }) {
	const params = new URLSearchParams({ min: String(query.minLiked) });
	if (query.maxLiked != null) params.set("max", String(query.maxLiked));
	const { data, error } = useApi<{ accounts: AccountLikedRow[] }>(
		`/api/accounts/by-liked?${params.toString()}`,
	);
	if (error) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	return (
		<div className="grid">
			<Card
				title={`${query.title} · ${data.accounts.length} accounts`}
				icon={HeartIcon}
				span={12}
			>
				<Table
					columns={columns}
					rows={data.accounts}
					empty="No accounts in this range."
				/>
				{data.accounts.length === 200 && (
					<div className="stat-sub" style={{ marginTop: 12 }}>
						Showing the first 200 · click an account to inspect
					</div>
				)}
			</Card>
		</div>
	);
}
