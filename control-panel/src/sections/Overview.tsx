import {
	CaretRightIcon,
	CheckCircleIcon,
	HeartIcon,
	HourglassIcon,
	MusicNotesIcon,
	SparkleIcon,
	UserPlusIcon,
	UsersIcon,
	WarningCircleIcon,
	WarningIcon,
} from "@phosphor-icons/react";
import {
	Bar,
	Card,
	ErrorState,
	Loading,
	Sparkline,
	Stat,
} from "../components/primitives";
import { useApi } from "../lib/api";
import { compact, duration, pct } from "../lib/format";
import { useNavigate } from "../lib/navigation";
import type {
	BillingMetrics,
	EnrichmentMetrics,
	JobMetrics,
	LibraryMetrics,
	UsersMetrics,
} from "../lib/types";

export function Overview({ refreshKey }: { refreshKey: number }) {
	const users = useApi<UsersMetrics>("/api/metrics/users", refreshKey);
	const library = useApi<LibraryMetrics>("/api/metrics/library", refreshKey);
	const jobs = useApi<JobMetrics>("/api/metrics/jobs", refreshKey);
	const billing = useApi<BillingMetrics>("/api/metrics/billing", refreshKey);
	const enrich = useApi<EnrichmentMetrics>(
		"/api/metrics/enrichment",
		refreshKey,
	);
	const navigate = useNavigate();

	const error =
		users.error || library.error || jobs.error || billing.error || enrich.error;
	if (error) return <ErrorState message={error} />;
	if (
		!users.data ||
		!library.data ||
		!jobs.data ||
		!billing.data ||
		!enrich.data
	)
		return <Loading />;

	const u = users.data;
	const l = library.data;
	const j = jobs.data;
	const b = billing.data;
	const e = enrich.data;

	const attention: {
		tone: "danger" | "warning" | "ok";
		icon: typeof WarningIcon;
		label: string;
		value: string;
		target: string;
	}[] = [];
	if (j.failed > 0)
		attention.push({
			tone: "danger",
			icon: WarningCircleIcon,
			label: "Failed jobs",
			value: String(j.failed),
			target: "jobs",
		});
	if (j.staleRunning > 0)
		attention.push({
			tone: "danger",
			icon: WarningIcon,
			label: "Stale running jobs (>5m)",
			value: String(j.staleRunning),
			target: "jobs",
		});
	if (j.unresolvedFailures > 0)
		attention.push({
			tone: "warning",
			icon: WarningIcon,
			label: "Unresolved item failures",
			value: String(j.unresolvedFailures),
			target: "jobs",
		});
	if (j.pending > 0)
		attention.push({
			tone: "warning",
			icon: HourglassIcon,
			label: "Pending jobs",
			value: `${j.pending} · oldest ${duration(j.oldestPendingSeconds)}`,
			target: "jobs",
		});
	if (b.grants.pending > 0)
		attention.push({
			tone: "warning",
			icon: WarningIcon,
			label: "Pending liked-song grants",
			value: String(b.grants.pending),
			target: "billing",
		});
	if (u.accountsWithoutLibrary > 0)
		attention.push({
			tone: "warning",
			icon: WarningIcon,
			label: "Accounts with no synced library",
			value: String(u.accountsWithoutLibrary),
			target: "users",
		});

	const coverage = [
		{ label: "Audio feat.", missing: e.missingAudio },
		{ label: "Lyrics", missing: e.missingLyrics },
		{ label: "Analysis", missing: e.missingAnalysis },
		{ label: "Embedding", missing: e.missingEmbedding },
	];

	return (
		<div className="grid">
			<Card span={3}>
				<Stat
					label="Total accounts"
					value={u.totalAccounts}
					icon={UsersIcon}
					sub={
						<>
							<strong>+{u.signups7d}</strong> this week
						</>
					}
				/>
			</Card>
			<Card span={3}>
				<Stat
					label="Active liked songs"
					value={l.activeLiked}
					icon={HeartIcon}
					sub={
						<>
							<strong>{compact(l.distinctLibrarySongs)}</strong> distinct
						</>
					}
				/>
			</Card>
			<Card span={3}>
				<Stat
					label="Playlists"
					value={l.totalPlaylists}
					icon={MusicNotesIcon}
					sub={
						<>
							<strong>{compact(l.totalSongs)}</strong> songs in catalog
						</>
					}
				/>
			</Card>
			<Card span={3}>
				<Stat
					label="Waitlist"
					value={u.waitlistTotal}
					icon={UserPlusIcon}
					sub="emails awaiting access"
				/>
			</Card>

			<Card title="Needs attention" icon={WarningIcon} span={6}>
				{attention.length === 0 ? (
					<div className="alert ok">
						<CheckCircleIcon className="alert-icon" size={16} weight="fill" />
						All clear — no failures, stale jobs, or pending grants.
					</div>
				) : (
					attention.map((a) => (
						<button
							type="button"
							key={a.label}
							className={`alert alert-btn ${a.tone}`}
							onClick={() => navigate(a.target)}
						>
							<a.icon className="alert-icon" size={16} weight="bold" />
							{a.label}
							<span className="alert-value">{a.value}</span>
							<CaretRightIcon className="alert-caret" size={13} weight="bold" />
						</button>
					))
				)}
			</Card>

			<Card title="Signups · last 14 days" icon={UserPlusIcon} span={6}>
				<Sparkline points={u.signupTrend.map((d) => d.count)} />
				<div className="stat-sub" style={{ marginTop: 8 }}>
					<strong>{u.signups1d}</strong> today · <strong>{u.signups30d}</strong>{" "}
					in 30 days
				</div>
			</Card>

			<Card
				title="Enrichment coverage · entitled songs"
				icon={SparkleIcon}
				span={12}
			>
				{e.entitledSongs === 0 ? (
					<div className="empty">No entitled (unlocked) songs yet.</div>
				) : (
					coverage.map((c) => {
						const covered = e.entitledSongs - c.missing;
						return (
							<Bar
								key={c.label}
								label={`${c.label} · ${pct(covered, e.entitledSongs)}%`}
								value={covered}
								max={e.entitledSongs}
							/>
						);
					})
				)}
			</Card>
		</div>
	);
}
