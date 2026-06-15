import {
	HeartIcon,
	MusicNotesIcon,
	StackIcon,
	UsersIcon,
} from "@phosphor-icons/react";
import {
	Bar,
	Card,
	type Column,
	ErrorState,
	Loading,
	Stat,
	Table,
	UserLink,
} from "../components/primitives";
import { useApi } from "../lib/api";
import { compact, fmt } from "../lib/format";
import type { LibraryMetrics } from "../lib/types";
import { useShowAccounts } from "../lib/user-selection";

type TopUser = LibraryMetrics["topUsers"][number];

const columns: Column<TopUser>[] = [
	{
		key: "user",
		header: "Account",
		render: (r) => <UserLink id={r.id} label={r.label} handle={r.handle} />,
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
];

export function LibrarySection({ refreshKey }: { refreshKey: number }) {
	const { data, error } = useApi<LibraryMetrics>(
		"/api/metrics/library",
		refreshKey,
	);
	const showAccounts = useShowAccounts();
	if (error) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	const maxBucket = Math.max(...data.distribution.map((d) => d.accounts), 1);

	return (
		<div className="grid">
			<Card span={3}>
				<Stat
					label="Active liked songs"
					value={data.activeLiked}
					icon={HeartIcon}
				/>
			</Card>
			<Card span={3}>
				<Stat
					label="Distinct library songs"
					value={data.distinctLibrarySongs}
					icon={MusicNotesIcon}
				/>
			</Card>
			<Card span={3}>
				<Stat label="Playlists" value={data.totalPlaylists} icon={StackIcon} />
			</Card>
			<Card span={3}>
				<Stat
					label="Catalog songs"
					value={data.totalSongs}
					icon={MusicNotesIcon}
					sub="rows in song table"
				/>
			</Card>

			<Card title="Accounts by liked-song count" icon={UsersIcon} span={4}>
				{data.distribution.map((d) => (
					<Bar
						key={d.bucket}
						label={d.bucket}
						value={d.accounts}
						max={maxBucket}
						onClick={() =>
							showAccounts({
								title: `${d.bucket} liked songs`,
								minLiked: d.min,
								maxLiked: d.max,
							})
						}
					/>
				))}
				<div className="stat-sub" style={{ marginTop: 8 }}>
					Click a tier to list its accounts
				</div>
			</Card>

			<Card title="Top libraries" icon={HeartIcon} span={8}>
				<Table
					columns={columns}
					rows={data.topUsers}
					empty="No synced libraries yet."
				/>
				{data.topUsers.length > 0 && (
					<div className="stat-sub" style={{ marginTop: 12 }}>
						Showing top {data.topUsers.length} · {compact(data.activeLiked)}{" "}
						total liked
					</div>
				)}
			</Card>
		</div>
	);
}
