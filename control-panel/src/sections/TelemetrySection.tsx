import {
	ArrowClockwiseIcon,
	ChartBarIcon,
	ChartLineUpIcon,
	CompassIcon,
	CurrencyDollarIcon,
	DatabaseIcon,
	FunnelIcon,
	GaugeIcon,
	GlobeIcon,
	HeartIcon,
	HourglassIcon,
	LightningIcon,
	PulseIcon,
	ShieldCheckIcon,
	SparkleIcon,
	UserCheckIcon,
	UserPlusIcon,
	UsersIcon,
	WarningCircleIcon,
	WarningIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import {
	Badge,
	Bar,
	Card,
	ErrorState,
	Loading,
	Stat,
} from "../components/primitives";
import { useApi } from "../lib/api";
import { duration, fmt, relativeTime, usd } from "../lib/format";
import type {
	EventCoverageRow,
	FunnelCohortReport,
	TelemetryActivityData,
	TelemetryEconomicsData,
	TelemetryEngagementData,
	TelemetryEnvelope,
	TelemetryPreset,
	TelemetrySourceStatus,
	TelemetrySummaryData,
} from "../lib/types";

const PRESETS = [
	"24h",
	"7d",
	"14d",
	"30d",
	"90d",
	"launch",
] as const satisfies readonly TelemetryPreset[];

type TelemetryTab =
	| "summary"
	| "funnel"
	| "activity"
	| "engagement"
	| "economics"
	| "coverage";

function readPreset(): TelemetryPreset {
	const val = new URL(window.location.href).searchParams.get("t_range");
	return PRESETS.find((p) => p === val) ?? "30d";
}

function updatePreset(preset: TelemetryPreset) {
	const url = new URL(window.location.href);
	if (preset === "30d") url.searchParams.delete("t_range");
	else url.searchParams.set("t_range", preset);
	window.history.pushState({ controlPanel: true }, "", url);
}

function SourceBadge({
	name,
	status,
}: {
	name: string;
	status: TelemetrySourceStatus;
}) {
	if (status.status === "available") {
		return (
			<span className="badge success" title={`Fetched: ${status.fetchedAt}`}>
				● {name}: Available
			</span>
		);
	}
	if (status.status === "quiet") {
		return (
			<span className="badge warning" title="No recent traffic observed">
				◐ {name}: Quiet
			</span>
		);
	}
	if (status.status === "unconfigured") {
		return (
			<span className="badge default" title={status.message}>
				○ {name}: Unconfigured
			</span>
		);
	}
	return (
		<span className="badge danger" title={status.message}>
			✕ {name}: Unavailable
		</span>
	);
}

export function TelemetrySection({ refreshKey = 0 }: { refreshKey?: number }) {
	const [preset, setPreset] = useState<TelemetryPreset>(readPreset);
	const [tab, setTab] = useState<TelemetryTab>("summary");

	useEffect(() => {
		const onPop = () => setPreset(readPreset());
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);

	const changePreset = (next: TelemetryPreset) => {
		setPreset(next);
		updatePreset(next);
	};

	// Lazy load ONLY the active tab's endpoint with the numeric refreshKey
	const summaryRes = useApi<TelemetryEnvelope<TelemetrySummaryData>>(
		`/api/telemetry/summary?range=${preset}`,
		refreshKey,
		tab === "summary",
	);

	const funnelRes = useApi<TelemetryEnvelope<FunnelCohortReport>>(
		`/api/telemetry/funnel?cohort=${preset}`,
		refreshKey,
		tab === "funnel",
	);

	const activityRes = useApi<TelemetryEnvelope<TelemetryActivityData>>(
		`/api/telemetry/activity?range=${preset}`,
		refreshKey,
		tab === "activity",
	);

	const engagementRes = useApi<TelemetryEnvelope<TelemetryEngagementData>>(
		`/api/telemetry/engagement?range=${preset}`,
		refreshKey,
		tab === "engagement",
	);

	const economicsRes = useApi<TelemetryEnvelope<TelemetryEconomicsData>>(
		`/api/telemetry/economics?range=${preset}`,
		refreshKey,
		tab === "economics",
	);

	const coverageRes = useApi<
		TelemetryEnvelope<{
			rows: EventCoverageRow[];
			freshness: { dbLatest: string | null; posthogLatest: string | null };
		}>
	>(`/api/telemetry/coverage?range=${preset}`, refreshKey, tab === "coverage");

	// Extract active envelope based on currently selected tab
	const activeRes =
		tab === "summary"
			? summaryRes
			: tab === "funnel"
				? funnelRes
				: tab === "activity"
					? activityRes
					: tab === "engagement"
						? engagementRes
						: tab === "economics"
							? economicsRes
							: coverageRes;

	const sources = activeRes.data?.sources ?? {
		supabase: { status: "available", fetchedAt: "", latestObservedAt: null },
		posthog: { status: "unconfigured", message: "Loading telemetry..." },
	};

	const caveats = activeRes.data?.caveats ?? [];
	const rangeMeta = activeRes.data?.range;
	const generatedAt = activeRes.data?.generatedAt;

	return (
		<div className="telemetry-section enter">
			{/* Shared Header */}
			<div
				className="card span-12"
				style={{
					marginBottom: 16,
					display: "flex",
					flexDirection: "column",
					gap: 12,
					padding: "16px 20px",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						flexWrap: "wrap",
						gap: 12,
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
						<ChartLineUpIcon
							size={22}
							weight="bold"
							style={{ color: "var(--accent)" }}
						/>
						<div>
							<h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
								Product Telemetry & Observability
							</h1>
							<div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
								Canonical business facts from Supabase · Behavioral traffic from
								PostHog
							</div>
						</div>
					</div>

					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							flexWrap: "wrap",
						}}
					>
						<SourceBadge name="Supabase" status={sources.supabase} />
						<SourceBadge name="PostHog" status={sources.posthog} />

						<div className="btn-row" style={{ marginLeft: 8 }}>
							{PRESETS.map((p) => (
								<button
									key={p}
									type="button"
									className={`btn mini ${preset === p ? "primary" : ""}`}
									onClick={() => changePreset(p)}
								>
									{p}
								</button>
							))}
						</div>

						<button
							type="button"
							className="btn mini"
							style={{ display: "flex", alignItems: "center", gap: 4 }}
							onClick={() => activeRes.refetch()}
							title="Force fresh query execution"
						>
							<ArrowClockwiseIcon size={13} />
							Refresh
						</button>
					</div>
				</div>

				{/* Range Metadata & Generated Timestamp */}
				{rangeMeta && (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							fontSize: 12,
							color: "var(--text-dim)",
							borderTop: "1px solid var(--border)",
							paddingTop: 8,
						}}
					>
						<div>
							Range:{" "}
							<span style={{ fontFamily: "monospace", color: "var(--text)" }}>
								{rangeMeta.from}
							</span>{" "}
							→{" "}
							<span style={{ fontFamily: "monospace", color: "var(--text)" }}>
								{rangeMeta.to}
							</span>{" "}
							({rangeMeta.timezone})
						</div>
						{generatedAt && <div>Generated {relativeTime(generatedAt)}</div>}
					</div>
				)}

				{/* Subview Tabs */}
				<div
					style={{
						display: "flex",
						gap: 6,
						borderTop: rangeMeta ? "none" : "1px solid var(--border)",
						paddingTop: rangeMeta ? 0 : 12,
						overflowX: "auto",
					}}
				>
					{(
						[
							{ id: "summary", label: "Summary", icon: GaugeIcon },
							{ id: "funnel", label: "Canonical Funnel", icon: FunnelIcon },
							{ id: "activity", label: "Activity & DAU", icon: PulseIcon },
							{
								id: "engagement",
								label: "Matching Engagement",
								icon: HeartIcon,
							},
							{
								id: "economics",
								label: "LLM Economics",
								icon: CurrencyDollarIcon,
							},
							{
								id: "coverage",
								label: "Data Quality & Coverage",
								icon: ShieldCheckIcon,
							},
						] as const
					).map((t) => (
						<button
							key={t.id}
							type="button"
							className={`btn small ${tab === t.id ? "primary" : ""}`}
							style={{ display: "flex", alignItems: "center", gap: 6 }}
							onClick={() => setTab(t.id)}
						>
							<t.icon size={14} weight={tab === t.id ? "bold" : "regular"} />
							{t.label}
						</button>
					))}
				</div>

				{/* Caveats Drawer */}
				{caveats.length > 0 && (
					<div
						className="alert warning"
						style={{
							marginTop: 4,
							display: "flex",
							alignItems: "center",
							gap: 8,
						}}
					>
						<WarningCircleIcon size={16} weight="bold" />
						<span>{caveats.join(" · ")}</span>
					</div>
				)}
			</div>

			{/* Subview Rendering */}
			{tab === "summary" && (
				<SummaryView
					res={summaryRes}
					onDrill={(targetTab) => setTab(targetTab)}
				/>
			)}
			{tab === "funnel" && <FunnelView res={funnelRes} />}
			{tab === "activity" && <ActivityView res={activityRes} />}
			{tab === "engagement" && <EngagementView res={engagementRes} />}
			{tab === "economics" && <EconomicsView res={economicsRes} />}
			{tab === "coverage" && <CoverageView res={coverageRes} />}
		</div>
	);
}

// ============================================================================
// 1. Summary View
// ============================================================================

function SummaryView({
	res,
	onDrill,
}: {
	res: ReturnType<typeof useApi<TelemetryEnvelope<TelemetrySummaryData>>>;
	onDrill: (tab: TelemetryTab) => void;
}) {
	if (res.loading && !res.data) return <Loading />;
	if (res.error) return <ErrorState message={res.error} />;
	if (!res.data) return null;

	const s = res.data.data;

	const renderDelta = (deltaPercent: number | null) => {
		if (deltaPercent === null) return <span className="dim">no prev data</span>;
		const isPos = deltaPercent > 0;
		const isZero = deltaPercent === 0;
		return (
			<span
				style={{
					color: isZero
						? "var(--text-dim)"
						: isPos
							? "var(--success)"
							: "var(--danger)",
				}}
			>
				{isPos ? "+" : ""}
				{deltaPercent}% vs prior period
			</span>
		);
	};

	return (
		<div className="grid">
			{/* KPI Headline Cards */}
			<button
				type="button"
				className="card span-4"
				style={{ cursor: "pointer", textAlign: "left" }}
				onClick={() => onDrill("funnel")}
			>
				<Stat
					label="Accounts Created"
					value={s.accountsCreated.current}
					icon={UserPlusIcon}
					sub={renderDelta(s.accountsCreated.deltaPercent)}
				/>
				<div className="stat-sub" style={{ marginTop: 8 }}>
					<span className="dim">Canonical: Supabase account.created_at</span>
				</div>
			</button>

			<button
				type="button"
				className="card span-4"
				style={{ cursor: "pointer", textAlign: "left" }}
				onClick={() => onDrill("funnel")}
			>
				<Stat
					label="Activated Accounts"
					value={s.activatedAccounts.current}
					icon={UserCheckIcon}
					sub={renderDelta(s.activatedAccounts.deltaPercent)}
				/>
				<div className="stat-sub" style={{ marginTop: 8 }}>
					<span className="dim">Canonical: onboarding_completed_at</span>
				</div>
			</button>

			<button
				type="button"
				className="card span-4"
				style={{ cursor: "pointer", textAlign: "left" }}
				onClick={() => onDrill("activity")}
			>
				<Stat
					label="7-Day Active Accounts (WAU)"
					value={s.current7DayActive}
					icon={PulseIcon}
					sub={<span className="dim">Rolling 7-day heartbeat window</span>}
				/>
				<div className="stat-sub" style={{ marginTop: 8 }}>
					<span className="dim">Canonical: account_activity.last_seen_at</span>
				</div>
			</button>

			<button
				type="button"
				className="card span-4"
				style={{ cursor: "pointer", textAlign: "left" }}
				onClick={() => onDrill("engagement")}
			>
				<Stat
					label="Engaged Matching Accounts"
					value={s.engagedMatchingAccounts.current}
					icon={HeartIcon}
					sub={renderDelta(s.engagedMatchingAccounts.deltaPercent)}
				/>
				<div className="stat-sub" style={{ marginTop: 8 }}>
					<span className="dim">Canonical: Supabase match_event</span>
				</div>
			</button>

			<button
				type="button"
				className="card span-4"
				style={{ cursor: "pointer", textAlign: "left" }}
				onClick={() => onDrill("economics")}
			>
				<Stat
					label="Paid Activations"
					value={s.paidAccounts.current}
					icon={LightningIcon}
					sub={renderDelta(s.paidAccounts.deltaPercent)}
				/>
				<div className="stat-sub" style={{ marginTop: 8 }}>
					<span className="dim">Canonical: billing_activation</span>
				</div>
			</button>

			<button
				type="button"
				className="card span-4"
				style={{ cursor: "pointer", textAlign: "left" }}
				onClick={() => onDrill("economics")}
			>
				<div className="stat">
					<div className="stat-label">
						<span className="stat-icon">
							<CurrencyDollarIcon size={13} weight="bold" />
						</span>
						Total LLM Spend
					</div>
					<div className="stat-value" style={{ fontSize: 24, fontWeight: 700 }}>
						{usd(s.llmSpend.currentCostUsd)}
					</div>
					<div className="stat-sub">{renderDelta(s.llmSpend.deltaPercent)}</div>
				</div>
				<div className="stat-sub" style={{ marginTop: 8 }}>
					<span className="dim">Canonical: Supabase llm_usage ledger</span>
				</div>
			</button>
		</div>
	);
}

// ============================================================================
// 2. Canonical Funnel View
// ============================================================================

function FunnelView({
	res,
}: {
	res: ReturnType<typeof useApi<TelemetryEnvelope<FunnelCohortReport>>>;
}) {
	if (res.loading && !res.data) return <Loading />;
	if (res.error) return <ErrorState message={res.error} />;
	if (!res.data) return null;

	const f = res.data.data;

	return (
		<div className="grid">
			<Card
				title="Cohort Milestone Progression"
				icon={FunnelIcon}
				span={12}
				action={
					<span className="dim" style={{ fontSize: 12 }}>
						Cohort size: <strong>{f.totalSignups}</strong> accounts
					</span>
				}
			>
				{!f.hasSufficientData && (
					<div className="alert warning" style={{ marginBottom: 16 }}>
						<WarningIcon size={16} weight="bold" />
						<span>
							Insufficient cohort data ({f.totalSignups} accounts). Milestone
							conversion rates are withheld until the cohort reaches 10
							accounts.
						</span>
					</div>
				)}

				<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
					{f.stages.map((stage, idx) => {
						const isFirst = idx === 0;
						const pctFromSignup = stage.conversionFromSignup;
						const pctFromPrev = stage.conversionFromPrevious;

						return (
							<div
								key={stage.stageId}
								style={{
									border: "1px solid var(--border)",
									borderRadius: 8,
									padding: "14px 18px",
									background: "var(--card-bg, #16181d)",
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									gap: 16,
									flexWrap: "wrap",
								}}
							>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: 14,
										minWidth: 220,
									}}
								>
									<div
										style={{
											width: 28,
											height: 28,
											borderRadius: 14,
											background: "var(--accent-dim, rgba(255,255,255,0.08))",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											fontWeight: 700,
											fontSize: 12,
										}}
									>
										{idx + 1}
									</div>
									<div>
										<div style={{ fontWeight: 600, fontSize: 14 }}>
											{stage.name}
										</div>
										<div className="dim" style={{ fontSize: 12 }}>
											{stage.count} {stage.count === 1 ? "account" : "accounts"}
											{stage.limitationNote && (
												<span style={{ marginLeft: 6, fontStyle: "italic" }}>
													({stage.limitationNote})
												</span>
											)}
										</div>
									</div>
								</div>

								{/* Progress Bar Representation */}
								<div style={{ flex: 1, minWidth: 160, maxWidth: 320 }}>
									<div
										style={{
											height: 8,
											borderRadius: 4,
											background: "rgba(255,255,255,0.08)",
											overflow: "hidden",
										}}
									>
										<div
											style={{
												height: "100%",
												width: `${Math.min(100, Math.max(0, pctFromSignup ?? 0))}%`,
												background: "var(--accent, #6366f1)",
												transition: "width 200ms ease-out",
											}}
										/>
									</div>
								</div>

								{/* Metrics summary */}
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: 16,
										textAlign: "right",
									}}
								>
									<div>
										<div style={{ fontWeight: 600, fontSize: 13 }}>
											{pctFromSignup !== null ? `${pctFromSignup}%` : "—"}
										</div>
										<div className="dim" style={{ fontSize: 11 }}>
											from signup
										</div>
									</div>

									{!isFirst && (
										<div>
											<div
												style={{
													fontWeight: 600,
													fontSize: 13,
													color:
														pctFromPrev !== null && pctFromPrev >= 50
															? "var(--success)"
															: "var(--text)",
												}}
											>
												{pctFromPrev !== null ? `${pctFromPrev}%` : "—"}
											</div>
											<div className="dim" style={{ fontSize: 11 }}>
												from step
											</div>
										</div>
									)}

									{stage.medianSeconds !== null && (
										<div>
											<div style={{ fontWeight: 500, fontSize: 12 }}>
												{duration(stage.medianSeconds)}
											</div>
											<div className="dim" style={{ fontSize: 11 }}>
												median time
											</div>
										</div>
									)}

									{stage.stuckCount > 0 && (
										<Badge tone="warning">{stage.stuckCount} stuck here</Badge>
									)}
								</div>
							</div>
						);
					})}
				</div>
			</Card>
		</div>
	);
}

// ============================================================================
// 3. Activity View (DAU & Cohorts)
// ============================================================================

function ActivityView({
	res,
}: {
	res: ReturnType<typeof useApi<TelemetryEnvelope<TelemetryActivityData>>>;
}) {
	if (res.loading && !res.data) return <Loading />;
	if (res.error) return <ErrorState message={res.error} />;
	if (!res.data) return null;

	const a = res.data.data;
	const maxDaily = Math.max(
		1,
		...a.dailyActive.map((d) => (d.count !== null ? d.count : 0)),
	);

	return (
		<div className="grid">
			{/* Canonical Active Accounts */}
			<div className="card span-6">
				<header className="card-head">
					<PulseIcon className="icon" size={15} weight="bold" />
					<h2>Canonical Active Accounts</h2>
				</header>
				<div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
					<Stat label="24-Hour Active" value={a.current24hActive} />
					<Stat label="Current WAU (7d)" value={a.currentWau} />
					<Stat label="Current MAU (30d)" value={a.currentMau} />
				</div>
				<div className="stat-sub">
					<span className="dim">
						Derived strictly from authenticated account_activity heartbeats.
					</span>
				</div>
			</div>

			{/* Observed Web Activity */}
			<div className="card span-6">
				<header className="card-head">
					<GlobeIcon className="icon" size={15} weight="bold" />
					<h2>Observed Analytics Traffic (PostHog)</h2>
				</header>
				<div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
					<div className="stat">
						<div className="stat-label">Visitors</div>
						<div
							className="stat-value"
							style={{ fontSize: 24, fontWeight: 700 }}
						>
							{a.observedWebActivity.visitors !== null
								? fmt(a.observedWebActivity.visitors)
								: "—"}
						</div>
					</div>
					<div className="stat">
						<div className="stat-label">Pageviews</div>
						<div
							className="stat-value"
							style={{ fontSize: 24, fontWeight: 700 }}
						>
							{a.observedWebActivity.pageviews !== null
								? fmt(a.observedWebActivity.pageviews)
								: "—"}
						</div>
					</div>
					<div className="stat">
						<div className="stat-label">Sessions</div>
						<div
							className="stat-value"
							style={{ fontSize: 24, fontWeight: 700 }}
						>
							{a.observedWebActivity.sessions !== null
								? fmt(a.observedWebActivity.sessions)
								: "—"}
						</div>
					</div>
				</div>
				<div className="stat-sub">
					<span className="dim">
						Subject to ad-blockers and privacy consent. Identified activity from
						accounts excluded from product metrics is filtered out; traffic with
						no linked account is still counted here.
					</span>
				</div>
			</div>

			{/* Daily Active History */}
			<Card
				title="Daily Active Accounts (DAU History)"
				icon={ChartBarIcon}
				span={12}
			>
				{a.dailyActive.length === 0 ? (
					<div className="dim" style={{ padding: 16, textAlign: "center" }}>
						No historical daily activity records in this period yet.
					</div>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
						{a.dailyActive.map((day) => (
							<Bar
								key={day.date}
								label={
									day.isComplete
										? day.date
										: `${day.date} (unavailable or incomplete)`
								}
								value={day.count !== null ? day.count : 0}
								max={maxDaily}
							/>
						))}
					</div>
				)}
			</Card>

			{/* Signup Cohorts Retention */}
			<Card title="Signup Cohorts Retention" icon={UsersIcon} span={8}>
				{a.cohortRetention.length === 0 ? (
					<div className="dim" style={{ padding: 16, textAlign: "center" }}>
						Insufficient historical cohorts to calculate weekly retention.
					</div>
				) : (
					<table className="data-table" style={{ width: "100%" }}>
						<thead>
							<tr>
								<th>Cohort Week</th>
								<th style={{ textAlign: "right" }}>Signups</th>
								<th style={{ textAlign: "right" }}>Week 1 Active</th>
								<th style={{ textAlign: "right" }}>Week 1 Retention</th>
								<th style={{ textAlign: "right" }}>Week 4 Active</th>
								<th style={{ textAlign: "right" }}>Week 4 Retention</th>
							</tr>
						</thead>
						<tbody>
							{a.cohortRetention.map((c) => (
								<tr key={c.cohortWeek}>
									<td>{c.cohortWeek}</td>
									<td style={{ textAlign: "right" }}>{fmt(c.signups)}</td>
									<td style={{ textAlign: "right" }}>
										{c.week1Active !== null ? fmt(c.week1Active) : "—"}
									</td>
									<td style={{ textAlign: "right", fontWeight: 600 }}>
										{c.week1Rate !== null ? `${c.week1Rate}%` : "—"}
									</td>
									<td style={{ textAlign: "right" }}>
										{c.week4Active !== null ? fmt(c.week4Active) : "—"}
									</td>
									<td style={{ textAlign: "right", fontWeight: 600 }}>
										{c.week4Rate !== null ? `${c.week4Rate}%` : "—"}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</Card>

			{/* Route Usage */}
			<Card title="Observed Route Usage" icon={CompassIcon} span={4}>
				{a.routeUsage.length === 0 ? (
					<div className="dim" style={{ padding: 16, textAlign: "center" }}>
						No PostHog route data available.
					</div>
				) : (
					<table className="data-table" style={{ width: "100%" }}>
						<thead>
							<tr>
								<th>Path</th>
								<th style={{ textAlign: "right" }}>Views</th>
							</tr>
						</thead>
						<tbody>
							{a.routeUsage.slice(0, 10).map((r) => (
								<tr key={r.pathname}>
									<td style={{ fontFamily: "monospace", fontSize: 12 }}>
										{r.pathname}
									</td>
									<td style={{ textAlign: "right" }}>{fmt(r.count)}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</Card>
		</div>
	);
}

// ============================================================================
// 4. Engagement View
// ============================================================================

function EngagementView({
	res,
}: {
	res: ReturnType<typeof useApi<TelemetryEnvelope<TelemetryEngagementData>>>;
}) {
	if (res.loading && !res.data) return <Loading />;
	if (res.error) return <ErrorState message={res.error} />;
	if (!res.data) return null;

	const e = res.data.data;
	const totalDecisions = e.totalDecisions;

	return (
		<div className="grid">
			<div className="card span-3">
				<Stat
					label="Sessions Started"
					value={e.sessionsStarted}
					icon={PulseIcon}
				/>
			</div>
			<div className="card span-3">
				<Stat
					label="Sessions Completed"
					value={e.sessionsCompleted}
					icon={SparkleIcon}
				/>
			</div>
			<div className="card span-3">
				<Stat
					label="Suggestions Served"
					value={e.suggestionsServed}
					icon={LightningIcon}
				/>
			</div>
			<div className="card span-3">
				<Stat label="Total Decisions" value={totalDecisions} icon={HeartIcon} />
			</div>

			<Card
				title="Decision Breakdown & Conversion"
				icon={ChartBarIcon}
				span={8}
			>
				<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
					<div style={{ display: "flex", justifyContent: "space-between" }}>
						<span>
							Explicit Decision Add Rate:{" "}
							<strong>
								{e.explicitDecisionAddRate !== null
									? `${e.explicitDecisionAddRate}%`
									: "—"}
							</strong>
						</span>
						<span className="dim">
							Served Item Add Rate:{" "}
							<strong>
								{e.servedAddRate !== null ? `${e.servedAddRate}%` : "—"}
							</strong>
						</span>
					</div>

					<div style={{ display: "flex", gap: 12, marginTop: 8 }}>
						<div
							style={{
								flex: 1,
								padding: 12,
								borderRadius: 6,
								background: "rgba(34, 197, 94, 0.1)",
								border: "1px solid rgba(34, 197, 94, 0.3)",
							}}
						>
							<div className="dim" style={{ fontSize: 12 }}>
								Songs Added
							</div>
							<div
								style={{
									fontSize: 20,
									fontWeight: 700,
									color: "var(--success)",
								}}
							>
								{fmt(e.added)}
							</div>
						</div>

						<div
							style={{
								flex: 1,
								padding: 12,
								borderRadius: 6,
								background: "rgba(239, 68, 68, 0.1)",
								border: "1px solid rgba(239, 68, 68, 0.3)",
							}}
						>
							<div className="dim" style={{ fontSize: 12 }}>
								Songs Dismissed
							</div>
							<div
								style={{
									fontSize: 20,
									fontWeight: 700,
									color: "var(--danger)",
								}}
							>
								{fmt(e.dismissed)}
							</div>
						</div>

						<div
							style={{
								flex: 1,
								padding: 12,
								borderRadius: 6,
								background: "rgba(156, 163, 175, 0.1)",
								border: "1px solid rgba(156, 163, 175, 0.3)",
							}}
						>
							<div className="dim" style={{ fontSize: 12 }}>
								Songs Skipped
							</div>
							<div style={{ fontSize: 20, fontWeight: 700 }}>
								{fmt(e.skipped)}
							</div>
						</div>
					</div>
				</div>
			</Card>

			<Card title="Orientation & Timing" icon={HourglassIcon} span={4}>
				<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
					<div>
						<div className="dim" style={{ fontSize: 12 }}>
							Orientation Split
						</div>
						<div style={{ fontWeight: 600, marginTop: 4 }}>
							{fmt(e.orientationSplit.song)} Song-first ·{" "}
							{fmt(e.orientationSplit.playlist)} Playlist-first
						</div>
					</div>

					<div>
						<div className="dim" style={{ fontSize: 12 }}>
							Time to First Decision
						</div>
						<div style={{ fontWeight: 600, marginTop: 4 }}>
							{e.timeToFirstDecisionSeconds !== null
								? duration(e.timeToFirstDecisionSeconds)
								: "—"}
						</div>
					</div>

					<div>
						<div className="dim" style={{ fontSize: 12 }}>
							Time from Decision to First Add
						</div>
						<div style={{ fontWeight: 600, marginTop: 4 }}>
							{e.timeToFirstAddSeconds !== null
								? duration(e.timeToFirstAddSeconds)
								: "—"}
						</div>
					</div>
				</div>
			</Card>
		</div>
	);
}

// ============================================================================
// 5. Economics View
// ============================================================================

function EconomicsView({
	res,
}: {
	res: ReturnType<typeof useApi<TelemetryEnvelope<TelemetryEconomicsData>>>;
}) {
	if (res.loading && !res.data) return <Loading />;
	if (res.error) return <ErrorState message={res.error} />;
	if (!res.data) return null;

	const ec = res.data.data;

	return (
		<div className="grid">
			<div className="card span-3">
				<div className="stat">
					<div className="stat-label">
						<CurrencyDollarIcon size={13} weight="bold" /> Product-audience
						spend
					</div>
					<div className="stat-value" style={{ fontSize: 22, fontWeight: 700 }}>
						{usd(ec.totalCostUsd)}
					</div>
					<div className="stat-sub">
						Actual all-account spend: {usd(ec.allAccountCostUsd)}
					</div>
					<div className="stat-sub">
						{ec.costDeltaPercent !== null
							? `${ec.costDeltaPercent > 0 ? "+" : ""}${ec.costDeltaPercent}% vs prior`
							: "no prior period"}
					</div>
				</div>
			</div>

			<div className="card span-3">
				<div className="stat">
					<div className="stat-label">Cost / Song Analysis</div>
					<div className="stat-value" style={{ fontSize: 22, fontWeight: 700 }}>
						{ec.costPerAnalyzedSong !== null
							? usd(ec.costPerAnalyzedSong)
							: "—"}
					</div>
					<div className="stat-sub">Per distinct song analyzed</div>
				</div>
			</div>

			<div className="card span-3">
				<div className="stat">
					<div className="stat-label">Cost / Activated Account</div>
					<div className="stat-value" style={{ fontSize: 22, fontWeight: 700 }}>
						{ec.costPerActivatedAccount !== null
							? usd(ec.costPerActivatedAccount)
							: "—"}
					</div>
					<div className="stat-sub">Per completed onboarding</div>
				</div>
			</div>

			<div className="card span-3">
				<div className="stat">
					<div className="stat-label">Active Subscriptions</div>
					<div className="stat-value" style={{ fontSize: 22, fontWeight: 700 }}>
						{ec.activeSubscriptions}
					</div>
					<div className="stat-sub">{ec.newPaidActivations} new in period</div>
				</div>
			</div>

			{/* Spend by Provider */}
			<Card title="LLM Spend by Provider" icon={SparkleIcon} span={4}>
				<table className="data-table" style={{ width: "100%" }}>
					<thead>
						<tr>
							<th>Provider</th>
							<th style={{ textAlign: "right" }}>Calls</th>
							<th style={{ textAlign: "right" }}>Cost (USD)</th>
						</tr>
					</thead>
					<tbody>
						{ec.byProvider.map((p) => (
							<tr key={p.provider}>
								<td style={{ fontFamily: "monospace", fontSize: 12 }}>
									{p.provider}
								</td>
								<td style={{ textAlign: "right" }}>{fmt(p.calls)}</td>
								<td style={{ textAlign: "right", fontWeight: 600 }}>
									{usd(p.costUsd)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</Card>

			{/* Spend by Function */}
			<Card title="LLM Spend by Function" icon={SparkleIcon} span={4}>
				<table className="data-table" style={{ width: "100%" }}>
					<thead>
						<tr>
							<th>Function</th>
							<th style={{ textAlign: "right" }}>Calls</th>
							<th style={{ textAlign: "right" }}>Cost (USD)</th>
						</tr>
					</thead>
					<tbody>
						{ec.byFunction.map((f) => (
							<tr key={f.functionId}>
								<td style={{ fontFamily: "monospace", fontSize: 12 }}>
									{f.functionId}
								</td>
								<td style={{ textAlign: "right" }}>{fmt(f.calls)}</td>
								<td style={{ textAlign: "right", fontWeight: 600 }}>
									{usd(f.costUsd)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</Card>

			{/* Spend by Model */}
			<Card title="LLM Spend by Model" icon={LightningIcon} span={4}>
				<table className="data-table" style={{ width: "100%" }}>
					<thead>
						<tr>
							<th>Model</th>
							<th style={{ textAlign: "right" }}>Calls</th>
							<th style={{ textAlign: "right" }}>Cost (USD)</th>
						</tr>
					</thead>
					<tbody>
						{ec.byModel.map((m) => (
							<tr key={m.model}>
								<td style={{ fontFamily: "monospace", fontSize: 12 }}>
									{m.model}
								</td>
								<td style={{ textAlign: "right" }}>{fmt(m.calls)}</td>
								<td style={{ textAlign: "right", fontWeight: 600 }}>
									{usd(m.costUsd)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</Card>
		</div>
	);
}

// ============================================================================
// 6. Data Quality & Coverage View
// ============================================================================

function CoverageView({
	res,
}: {
	res: ReturnType<
		typeof useApi<
			TelemetryEnvelope<{
				rows: EventCoverageRow[];
				freshness: { dbLatest: string | null; posthogLatest: string | null };
			}>
		>
	>;
}) {
	if (res.loading && !res.data) return <Loading />;
	if (res.error) return <ErrorState message={res.error} />;
	if (!res.data) return null;

	const { rows, freshness } = res.data.data;

	return (
		<div className="grid">
			<Card title="Source Freshness & Latency" icon={DatabaseIcon} span={12}>
				<div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
					<div style={{ flex: 1, minWidth: 200 }}>
						<div className="dim" style={{ fontSize: 12 }}>
							Supabase Canonical Facts
						</div>
						<div style={{ fontWeight: 600, fontSize: 14, marginTop: 4 }}>
							{freshness.dbLatest
								? relativeTime(freshness.dbLatest)
								: "No activity"}
						</div>
						<div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
							{freshness.dbLatest ?? "—"}
						</div>
					</div>

					<div style={{ flex: 1, minWidth: 200 }}>
						<div className="dim" style={{ fontSize: 12 }}>
							PostHog Observed Telemetry
						</div>
						<div style={{ fontWeight: 600, fontSize: 14, marginTop: 4 }}>
							{freshness.posthogLatest
								? relativeTime(freshness.posthogLatest)
								: "No activity"}
						</div>
						<div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
							{freshness.posthogLatest ?? "—"}
						</div>
					</div>
				</div>
			</Card>

			<Card
				title="Event Parity & Reconciliation"
				icon={ShieldCheckIcon}
				span={12}
			>
				<table className="data-table" style={{ width: "100%" }}>
					<thead>
						<tr>
							<th>Fact / Milestone</th>
							<th>Canonical Source</th>
							<th style={{ textAlign: "right" }}>DB Fact Count</th>
							<th style={{ textAlign: "right" }}>PostHog Count</th>
							<th style={{ textAlign: "right" }}>Coverage %</th>
							<th>Semantic Note</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.id}>
								<td style={{ fontWeight: 600 }}>{row.name}</td>
								<td className="dim" style={{ fontSize: 12 }}>
									{row.canonicalSource}
								</td>
								<td style={{ textAlign: "right" }}>{fmt(row.dbCount)}</td>
								<td style={{ textAlign: "right" }}>
									{row.posthogCount !== null ? fmt(row.posthogCount) : "—"}
								</td>
								<td style={{ textAlign: "right" }}>
									{row.isLowVolume ? (
										<span className="dim">
											{row.coveragePercent !== null
												? `${row.coveragePercent}% (low vol)`
												: "—"}
										</span>
									) : row.coveragePercent !== null ? (
										<Badge
											tone={
												row.coveragePercent >= 90
													? "success"
													: row.coveragePercent >= 70
														? "warning"
														: "danger"
											}
										>
											{row.coveragePercent}%
										</Badge>
									) : (
										<span className="dim">—</span>
									)}
								</td>
								<td className="dim" style={{ fontSize: 12 }}>
									{row.semanticNote}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</Card>
		</div>
	);
}
