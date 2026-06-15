import {
	BrainIcon,
	CurrencyDollarIcon,
	FileTextIcon,
	LockKeyOpenIcon,
	SparkleIcon,
	VinylRecordIcon,
	WaveformIcon,
} from "@phosphor-icons/react";
import {
	Card,
	type Column,
	ErrorState,
	Loading,
	Stat,
	Table,
	UserLink,
} from "../components/primitives";
import { useApi } from "../lib/api";
import { fmt, pct, usd } from "../lib/format";
import type { EnrichmentMetrics } from "../lib/types";

type GapRow = EnrichmentMetrics["gapsByUser"][number];

function MissCell({ missing, total }: { missing: number; total: number }) {
	if (missing === 0) return <span className="dim">—</span>;
	return (
		<span className="cell-num" style={{ color: "var(--warning)" }}>
			{fmt(missing)}
			<span className="dim"> ({pct(missing, total)}%)</span>
		</span>
	);
}

const columns: Column<GapRow>[] = [
	{
		key: "user",
		header: "Account",
		render: (r) => <UserLink id={r.id} label={r.label} handle={r.handle} />,
	},
	{
		key: "ent",
		header: "Entitled",
		right: true,
		render: (r) => <span className="cell-num">{fmt(r.entitledSongs)}</span>,
	},
	{
		key: "audio",
		header: "Missing audio",
		right: true,
		render: (r) => (
			<MissCell missing={r.missingAudio} total={r.entitledSongs} />
		),
	},
	{
		key: "lyrics",
		header: "Missing lyrics",
		right: true,
		render: (r) => (
			<MissCell missing={r.missingLyrics} total={r.entitledSongs} />
		),
	},
	{
		key: "analysis",
		header: "Missing analysis",
		right: true,
		render: (r) => (
			<MissCell missing={r.missingAnalysis} total={r.entitledSongs} />
		),
	},
	{
		key: "embed",
		header: "Missing embed",
		right: true,
		render: (r) => (
			<MissCell missing={r.missingEmbedding} total={r.entitledSongs} />
		),
	},
];

export function EnrichmentSection({ refreshKey }: { refreshKey: number }) {
	const { data, error } = useApi<EnrichmentMetrics>(
		"/api/metrics/enrichment",
		refreshKey,
	);
	if (error) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	const cards: { label: string; missing: number; icon: typeof WaveformIcon }[] =
		[
			{
				label: "Missing audio features",
				missing: data.missingAudio,
				icon: WaveformIcon,
			},
			{
				label: "Missing lyrics",
				missing: data.missingLyrics,
				icon: FileTextIcon,
			},
			{
				label: "Missing analysis",
				missing: data.missingAnalysis,
				icon: BrainIcon,
			},
			{
				label: "Missing embeddings",
				missing: data.missingEmbedding,
				icon: VinylRecordIcon,
			},
		];

	return (
		<div className="grid">
			<Card span={12}>
				<p className="muted-text">
					Coverage is measured against <strong>entitled songs only</strong> —
					songs an account has unlocked, or all liked songs when the account has
					unlimited access. Enrichment never runs on locked songs, so the rest
					of the library is excluded by design.
				</p>
			</Card>

			{cards.map((c) => (
				<Card key={c.label} span={3}>
					<Stat
						label={c.label}
						value={c.missing}
						icon={c.icon}
						sub={
							data.entitledSongs > 0 ? (
								<>
									<strong>
										{pct(data.entitledSongs - c.missing, data.entitledSongs)}%
									</strong>{" "}
									covered of {fmt(data.entitledSongs)} entitled
								</>
							) : (
								"no entitled songs yet"
							)
						}
					/>
				</Card>
			))}

			<Card span={4}>
				<Stat
					label="Entitled songs"
					value={data.entitledSongs}
					icon={LockKeyOpenIcon}
					sub="unlocked or unlimited-access"
				/>
			</Card>
			<Card span={4}>
				<Stat
					label="Songs analyzed"
					value={data.analysisCount}
					icon={SparkleIcon}
					sub="rows in song_analysis (all-time)"
				/>
			</Card>
			<Card span={4}>
				<div className="stat">
					<div className="stat-label">
						<span className="stat-icon">
							<CurrencyDollarIcon size={13} weight="bold" />
						</span>
						Analysis spend
					</div>
					<div className="stat-value">{usd(data.analysisCostUsd)}</div>
					<div className="stat-sub">summed cost_usd across analyses</div>
				</div>
			</Card>

			<Card title="Enrichment gaps by account" icon={SparkleIcon} span={12}>
				<Table
					columns={columns}
					rows={data.gapsByUser}
					empty="Every entitled song is fully enriched."
				/>
				{data.gapsByUser.length > 0 && (
					<div className="stat-sub" style={{ marginTop: 12 }}>
						Accounts with any missing enrichment on entitled songs, most missing
						analysis first · top {data.gapsByUser.length} · click a row to
						inspect
					</div>
				)}
			</Card>
		</div>
	);
}
