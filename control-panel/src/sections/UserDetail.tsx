import {
	HeartIcon,
	LockKeyOpenIcon,
	SparkleIcon,
	StackIcon,
} from "@phosphor-icons/react";
import {
	Badge,
	Bar,
	Card,
	type Column,
	ErrorState,
	Loading,
	Stat,
	Table,
} from "../components/primitives";
import { useApi } from "../lib/api";
import { fmt, pct, relativeTime } from "../lib/format";
import type { UserDetail as UserDetailData, UserSong } from "../lib/types";

function EnrichDots({ song }: { song: UserSong }) {
	const dots: { on: boolean; label: string }[] = [
		{ on: song.hasAudio, label: "audio features" },
		{ on: song.hasLyrics, label: "lyrics" },
		{ on: song.hasAnalysis, label: "analysis" },
		{ on: song.hasEmbedding, label: "embedding" },
	];
	return (
		<span className="dots">
			{dots.map((d) => (
				<span
					key={d.label}
					className={`dot ${d.on ? "on" : ""}`}
					title={`${d.label}: ${d.on ? "present" : "missing"}`}
				/>
			))}
		</span>
	);
}

const songColumns: Column<UserSong>[] = [
	{
		key: "song",
		header: "Song",
		render: (s) => (
			<span className="song-cell">
				{s.imageUrl ? (
					<img className="song-cover" src={s.imageUrl} alt="" loading="lazy" />
				) : (
					<span className="song-cover placeholder" />
				)}
				<span className="song-meta">
					<span className="primary">{s.name}</span>
					<span className="dim">{s.artist}</span>
				</span>
			</span>
		),
	},
	{
		key: "unlocked",
		header: "Access",
		render: (s) =>
			s.unlocked ? (
				<Badge tone="accent">unlocked</Badge>
			) : (
				<span className="dim">locked</span>
			),
	},
	{
		key: "enrich",
		header: "Audio · Lyrics · Analysis · Embed",
		render: (s) => <EnrichDots song={s} />,
	},
	{
		key: "liked",
		header: "Liked",
		right: true,
		render: (s) => <span className="dim">{relativeTime(s.likedAt)}</span>,
	},
];

export function UserDetail({ accountId }: { accountId: string }) {
	const { data, error } = useApi<UserDetailData>(`/api/users/${accountId}`);
	if (error) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	const initial = (data.displayName || data.email || "?")
		.charAt(0)
		.toUpperCase();
	const isUnlimited = data.unlimitedAccessSource != null;

	const coverage = [
		{ label: "Audio feat.", missing: data.missingAudio },
		{ label: "Lyrics", missing: data.missingLyrics },
		{ label: "Analysis", missing: data.missingAnalysis },
		{ label: "Embedding", missing: data.missingEmbedding },
	];

	return (
		<div className="grid">
			<Card span={12}>
				<div className="user-header">
					{data.imageUrl ? (
						<img className="avatar" src={data.imageUrl} alt="" />
					) : (
						<span className="avatar placeholder">{initial}</span>
					)}
					<div className="user-id">
						<div className="user-name">{data.displayName ?? "(no name)"}</div>
						<div className="user-sub">
							{data.handle && <span>@{data.handle}</span>}
							{data.email && <span className="num">{data.email}</span>}
						</div>
						<div className="user-sub dim">
							<span className="num">{data.spotifyId ?? "no spotify id"}</span>
							<span>joined {relativeTime(data.createdAt)}</span>
						</div>
					</div>
					<div className="user-badges">
						<Badge tone={data.plan === "free" ? "default" : "accent"}>
							{data.plan ?? "no billing"}
						</Badge>
						{isUnlimited && (
							<Badge tone="success">
								unlimited · {data.unlimitedAccessSource}
							</Badge>
						)}
						{data.subscriptionStatus && data.subscriptionStatus !== "none" && (
							<Badge tone="accent">{data.subscriptionStatus}</Badge>
						)}
						{data.grant && (
							<Badge tone={data.grant.appliedAt ? "success" : "warning"}>
								grant · {data.grant.appliedAt ? "applied" : "pending"}
							</Badge>
						)}
					</div>
				</div>
			</Card>

			<Card span={3}>
				<Stat
					label="Active liked"
					value={data.activeLiked}
					icon={HeartIcon}
					sub={
						<>
							<strong>{fmt(data.totalLikedEver)}</strong> ever
						</>
					}
				/>
			</Card>
			<Card span={3}>
				<Stat label="Playlists" value={data.playlists} icon={StackIcon} />
			</Card>
			<Card span={3}>
				<Stat
					label="Active unlocks"
					value={data.activeUnlocks}
					icon={LockKeyOpenIcon}
					sub={
						data.revokedUnlocks > 0 ? (
							<>
								<strong>{data.revokedUnlocks}</strong> revoked
							</>
						) : (
							"none revoked"
						)
					}
				/>
			</Card>
			<Card span={3}>
				<Stat
					label="Entitled songs"
					value={data.entitledSongs}
					icon={SparkleIcon}
					sub={isUnlimited ? "via unlimited access" : "via unlocks"}
				/>
			</Card>

			<Card
				title="Enrichment coverage · entitled songs"
				icon={SparkleIcon}
				span={5}
			>
				{data.entitledSongs === 0 ? (
					<div className="empty">No entitled songs to enrich.</div>
				) : (
					coverage.map((c) => (
						<Bar
							key={c.label}
							label={`${c.label} · ${pct(data.entitledSongs - c.missing, data.entitledSongs)}%`}
							value={data.entitledSongs - c.missing}
							max={data.entitledSongs}
						/>
					))
				)}
			</Card>

			<Card title="Liked songs" icon={HeartIcon} span={7}>
				<Table
					columns={songColumns}
					rows={data.songs}
					empty="No liked songs."
				/>
				{data.songs.length > 0 && (
					<div className="stat-sub" style={{ marginTop: 12 }}>
						Most recent {data.songs.length} of {fmt(data.activeLiked)} · green
						dots = enrichment present
					</div>
				)}
			</Card>
		</div>
	);
}
