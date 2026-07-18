import {
	EnvelopeSimpleIcon,
	HeartIcon,
	LockKeyOpenIcon,
	SparkleIcon,
	StackIcon,
	TerminalWindowIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import {
	Badge,
	Bar,
	Card,
	ErrorState,
	Loading,
	Stat,
} from "../components/primitives";
import { useApi } from "../lib/api";
import { fmt, pct, relativeTime } from "../lib/format";
import { useNavigate } from "../lib/navigation";
import type {
	PageResult,
	UserDetail as UserDetailData,
	UserSong,
} from "../lib/types";

function CopyButton({ value, label }: { value: string | null; label: string }) {
	const [copied, setCopied] = useState(false);
	if (!value) return null;
	const copyValue = value;
	async function copy() {
		try {
			await navigator.clipboard.writeText(copyValue);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1200);
		} catch {
			setCopied(false);
		}
	}
	return (
		<button type="button" className="btn" onClick={() => void copy()}>
			{copied ? "Copied" : `Copy ${label}`}
		</button>
	);
}

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

const songColumns: DataTableColumn<UserSong>[] = [
	{
		key: "name",
		header: "Song",
		sortable: true,
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
		key: "likedAt",
		header: "Liked",
		sortable: true,
		right: true,
		render: (s) => <span className="dim">{relativeTime(s.likedAt)}</span>,
	},
];

type SongTableState = {
	search: string;
	sort: string;
	direction: "asc" | "desc";
	page: number;
	pageSize: 25 | 50 | 100;
};

function readSongTableState(): SongTableState {
	const params = new URL(window.location.href).searchParams;
	const page = Number(params.get("page"));
	const pageSize = params.get("pageSize");
	return {
		search: params.get("q") ?? "",
		sort: params.get("sort") ?? "likedAt",
		direction: params.get("direction") === "asc" ? "asc" : "desc",
		page: Number.isInteger(page) && page > 0 ? page : 1,
		pageSize: pageSize === "25" ? 25 : pageSize === "100" ? 100 : 50,
	};
}

export function UserDetail({ accountId }: { accountId: string }) {
	const navigate = useNavigate();
	const { data, error } = useApi<UserDetailData>(`/api/users/${accountId}`);
	const [songsTable, setSongsTable] =
		useState<SongTableState>(readSongTableState);
	useEffect(() => {
		const onPopState = () => setSongsTable(readSongTableState());
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);
	function updateSongsTable(patch: Partial<SongTableState>) {
		const next = { ...songsTable, ...patch };
		setSongsTable(next);
		const url = new URL(window.location.href);
		url.searchParams.set("q", next.search);
		url.searchParams.set("sort", next.sort);
		url.searchParams.set("direction", next.direction);
		url.searchParams.set("page", String(next.page));
		url.searchParams.set("pageSize", String(next.pageSize));
		window.history.pushState({ controlPanel: true }, "", url);
	}
	const songParams = new URLSearchParams({
		q: songsTable.search,
		sort: songsTable.sort,
		direction: songsTable.direction,
		page: String(songsTable.page),
		pageSize: String(songsTable.pageSize),
	});
	const songsResult = useApi<PageResult<UserSong>>(
		`/api/users/${accountId}/songs?${songParams.toString()}`,
	);
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
						<div className="btn-row" style={{ marginTop: 8 }}>
							<CopyButton value={data.id} label="ID" />
							<CopyButton value={data.email} label="email" />
							<CopyButton value={data.handle} label="handle" />
							<CopyButton value={data.spotifyId} label="Spotify ID" />
						</div>
						<div className="btn-row" style={{ marginTop: 8 }}>
							<button
								type="button"
								className="btn"
								onClick={() =>
									navigate("operations", {
										account: data.id,
										accountLabel: data.displayName || data.email || data.id,
									})
								}
							>
								<TerminalWindowIcon size={14} weight="bold" />
								Grant access…
							</button>
							<button
								type="button"
								className="btn"
								disabled={!data.email}
								title={
									data.email ? undefined : "No email on file for this account"
								}
								onClick={() =>
									data.email &&
									navigate("email", {
										to: data.email,
										toLabel: data.displayName || data.email,
									})
								}
							>
								<EnvelopeSimpleIcon size={14} weight="bold" />
								Send email…
							</button>
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

			{data.grant && (
				<Card title="Access grant" span={12}>
					<div className="stat-sub">
						<strong>{data.grant.origin}</strong> ·{" "}
						{data.grant.appliedAt
							? `applied ${relativeTime(data.grant.appliedAt)}`
							: "pending"}
						{data.grant.requestedBy && (
							<> · requested by {data.grant.requestedBy}</>
						)}
						{data.grant.note && <> · {data.grant.note}</>}
					</div>
				</Card>
			)}

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
				<DataTable
					tableId="user-songs"
					columns={songColumns}
					rows={songsResult.data?.rows ?? []}
					total={songsResult.data?.total ?? 0}
					page={songsResult.data?.page ?? songsTable.page}
					pageSize={songsResult.data?.pageSize ?? songsTable.pageSize}
					search={songsTable.search}
					sort={songsTable.sort}
					direction={songsTable.direction}
					getRowId={(song) => song.songId}
					onSearchChange={(search) => updateSongsTable({ search, page: 1 })}
					onSortChange={(sort) =>
						updateSongsTable({
							sort,
							page: 1,
							direction:
								songsTable.sort === sort && songsTable.direction === "asc"
									? "desc"
									: "asc",
						})
					}
					onPageChange={(page) => updateSongsTable({ page })}
					onPageSizeChange={(pageSize) =>
						updateSongsTable({ pageSize, page: 1 })
					}
					onReset={() =>
						updateSongsTable({
							search: "",
							sort: "likedAt",
							direction: "desc",
							page: 1,
							pageSize: 50,
						})
					}
					loading={songsResult.loading}
					refreshing={songsResult.refreshing}
					error={songsResult.error}
					onRetry={songsResult.refetch}
					empty="No liked songs."
					noMatches="No liked songs match these filters."
				/>
				{songsResult.data && (
					<div className="stat-sub" style={{ marginTop: 12 }}>
						{songsResult.data.total} liked songs · green dots = enrichment
						present
					</div>
				)}
			</Card>
		</div>
	);
}
