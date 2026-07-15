import {
	BrainIcon,
	CurrencyDollarIcon,
	FileTextIcon,
	LockKeyOpenIcon,
	SparkleIcon,
	VinylRecordIcon,
	WaveformIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import {
	Card,
	ErrorState,
	Loading,
	Stat,
	UserLink,
} from "../components/primitives";
import { useApi } from "../lib/api";
import { fmt, pct, usd } from "../lib/format";
import type {
	EnrichmentAccountRow,
	EnrichmentMetrics,
	PageResult,
} from "../lib/types";

function MissCell({ missing, total }: { missing: number; total: number }) {
	if (missing === 0) return <span className="dim">—</span>;
	return (
		<span className="cell-num" style={{ color: "var(--warning)" }}>
			{fmt(missing)}
			<span className="dim"> ({pct(missing, total)}%)</span>
		</span>
	);
}

const columns: DataTableColumn<EnrichmentAccountRow>[] = [
	{
		key: "label",
		header: "Account",
		sortable: true,
		render: (r) => <UserLink id={r.id} label={r.label} handle={r.handle} />,
	},
	{
		key: "entitledSongs",
		header: "Entitled",
		sortable: true,
		right: true,
		render: (r) => <span className="cell-num">{fmt(r.entitledSongs)}</span>,
	},
	{
		key: "missingAudio",
		header: "Missing audio",
		sortable: true,
		right: true,
		render: (r) => (
			<MissCell missing={r.missingAudio} total={r.entitledSongs} />
		),
	},
	{
		key: "missingLyrics",
		header: "Missing lyrics",
		sortable: true,
		right: true,
		render: (r) => (
			<MissCell missing={r.missingLyrics} total={r.entitledSongs} />
		),
	},
	{
		key: "missingAnalysis",
		header: "Missing analysis",
		sortable: true,
		right: true,
		render: (r) => (
			<MissCell missing={r.missingAnalysis} total={r.entitledSongs} />
		),
	},
	{
		key: "missingEmbedding",
		header: "Missing embed",
		sortable: true,
		right: true,
		render: (r) => (
			<MissCell missing={r.missingEmbedding} total={r.entitledSongs} />
		),
	},
];

type TableState = {
	search: string;
	missing: "any" | "audio" | "lyrics" | "analysis" | "embedding";
	coverageBelow: string;
	sort: string;
	direction: "asc" | "desc";
	page: number;
	pageSize: 25 | 50 | 100;
};

function readTableState(): TableState {
	const params = new URL(window.location.href).searchParams;
	const missing = params.get("missing");
	const page = Number(params.get("page"));
	const pageSize = params.get("pageSize");
	return {
		search: params.get("q") ?? "",
		missing:
			missing === "audio" ||
			missing === "lyrics" ||
			missing === "analysis" ||
			missing === "embedding"
				? missing
				: "any",
		coverageBelow: params.get("coverageBelow") ?? "",
		sort: params.get("sort") ?? "missingAnalysis",
		direction: params.get("direction") === "asc" ? "asc" : "desc",
		page: Number.isInteger(page) && page > 0 ? page : 1,
		pageSize: pageSize === "25" ? 25 : pageSize === "100" ? 100 : 50,
	};
}

export function EnrichmentSection({ refreshKey }: { refreshKey: number }) {
	const { data, error } = useApi<EnrichmentMetrics>(
		"/api/metrics/enrichment",
		refreshKey,
	);
	const [table, setTable] = useState<TableState>(readTableState);
	useEffect(() => {
		const onPopState = () => setTable(readTableState());
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);
	function updateTable(patch: Partial<TableState>) {
		const next = { ...table, ...patch };
		setTable(next);
		const url = new URL(window.location.href);
		for (const key of [
			"q",
			"missing",
			"coverageBelow",
			"sort",
			"direction",
			"page",
			"pageSize",
		] as const) {
			const value =
				key === "q"
					? next.search
					: key === "missing"
						? next.missing
						: key === "coverageBelow"
							? next.coverageBelow
							: key === "sort"
								? next.sort
								: key === "direction"
									? next.direction
									: key === "page"
										? String(next.page)
										: String(next.pageSize);
			if (
				(key === "missing" && value === "any") ||
				(key === "coverageBelow" && value === "") ||
				(key === "q" && value === "")
			)
				url.searchParams.delete(key);
			else url.searchParams.set(key, value);
		}
		window.history.pushState({ controlPanel: true }, "", url);
	}
	const params = new URLSearchParams({
		q: table.search,
		missing: table.missing,
		coverageBelow: table.coverageBelow,
		sort: table.sort,
		direction: table.direction,
		page: String(table.page),
		pageSize: String(table.pageSize),
	});
	const accounts = useApi<PageResult<EnrichmentAccountRow>>(
		`/api/enrichment/accounts?${params.toString()}`,
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
				<DataTable
					tableId="enrichment-accounts"
					columns={columns}
					rows={accounts.data?.rows ?? []}
					total={accounts.data?.total ?? 0}
					page={accounts.data?.page ?? table.page}
					pageSize={accounts.data?.pageSize ?? table.pageSize}
					search={table.search}
					filters={
						<>
							<select
								className="select"
								aria-label="Missing stage"
								value={table.missing}
								onChange={(event) => {
									const value = event.target.value;
									updateTable({
										missing:
											value === "audio" ||
											value === "lyrics" ||
											value === "analysis" ||
											value === "embedding"
												? value
												: "any",
										page: 1,
									});
								}}
							>
								<option value="any">Any missing stage</option>
								<option value="audio">Audio</option>
								<option value="lyrics">Lyrics</option>
								<option value="analysis">Analysis</option>
								<option value="embedding">Embedding</option>
							</select>
							<input
								className="input"
								type="number"
								min="0"
								max="100"
								placeholder="Coverage below %"
								aria-label="Coverage below"
								value={table.coverageBelow}
								onChange={(event) =>
									updateTable({ coverageBelow: event.target.value, page: 1 })
								}
							/>
						</>
					}
					hasActiveFilters={
						table.missing !== "any" || table.coverageBelow !== ""
					}
					sort={table.sort}
					direction={table.direction}
					getRowId={(row) => row.id}
					onSearchChange={(search) => updateTable({ search, page: 1 })}
					onSortChange={(sort) =>
						updateTable({
							sort,
							page: 1,
							direction:
								table.sort === sort && table.direction === "asc"
									? "desc"
									: "asc",
						})
					}
					onPageChange={(page) => updateTable({ page })}
					onPageSizeChange={(pageSize) => updateTable({ pageSize, page: 1 })}
					onReset={() =>
						updateTable({
							search: "",
							missing: "any",
							coverageBelow: "",
							sort: "missingAnalysis",
							direction: "desc",
							page: 1,
							pageSize: 50,
						})
					}
					loading={accounts.loading}
					refreshing={accounts.refreshing}
					error={accounts.error}
					onRetry={accounts.refetch}
					empty="Every entitled account is fully enriched."
					noMatches="No accounts match these enrichment filters."
				/>
			</Card>
		</div>
	);
}
