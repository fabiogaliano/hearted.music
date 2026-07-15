import {
	CheckCircleIcon,
	ClockCounterClockwiseIcon,
	FlaskIcon,
	WarningIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { Badge, Card, Stat } from "../components/primitives";
import { getJson, postJson, useApi } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useNavigate } from "../lib/navigation";
import type {
	ActionRunMode,
	ActionRunRow,
	ActionRunStatus,
	ActionRunTodaySummary,
	PageResult,
} from "../lib/types";
import type { SectionKey } from "../lib/url-state";

const ACTION_TYPES = [
	"grant-access",
	"email-send",
	"release-year-set",
	"release-year-revert",
	"lyrics-save",
	"lyrics-mark-instrumental",
	"audio-approve",
	"audio-reject",
	"audio-replace",
	"audio-submit-url",
	"instrumental-approve",
	"instrumental-reject",
] as const;

const MODES: readonly ActionRunMode[] = ["dry_run", "commit"];
const STATUSES: readonly ActionRunStatus[] = [
	"started",
	"succeeded",
	"failed",
	"partial",
	"interrupted",
];

function statusTone(
	status: ActionRunStatus,
): "default" | "accent" | "success" | "warning" | "danger" {
	if (status === "succeeded") return "success";
	if (status === "failed") return "danger";
	if (status === "partial" || status === "interrupted") return "warning";
	if (status === "started") return "accent";
	return "default";
}

type HistoryTableState = {
	action: string;
	mode: string;
	status: string;
	target: string;
	from: string;
	to: string;
	page: number;
	pageSize: 25 | 50 | 100;
};

function readHistoryState(): HistoryTableState {
	const params = new URL(window.location.href).searchParams;
	const pageSize = params.get("pageSize");
	const page = Number(params.get("page"));
	return {
		action: params.get("action") ?? "",
		mode: params.get("mode") ?? "",
		status: params.get("status") ?? "",
		target: params.get("target") ?? "",
		from: params.get("from") ?? "",
		to: params.get("to") ?? "",
		page: Number.isInteger(page) && page > 0 ? page : 1,
		pageSize: pageSize === "25" ? 25 : pageSize === "100" ? 100 : 50,
	};
}

function updateHistoryUrl(next: HistoryTableState) {
	const url = new URL(window.location.href);
	for (const key of [
		"action",
		"mode",
		"status",
		"target",
		"from",
		"to",
	] as const) {
		if (next[key]) url.searchParams.set(key, next[key]);
		else url.searchParams.delete(key);
	}
	url.searchParams.set("page", String(next.page));
	url.searchParams.set("pageSize", String(next.pageSize));
	window.history.pushState({ controlPanel: true }, "", url);
}

// Date inputs bound the whole selected day; started_at is stored as an ISO
// instant, so string comparison against these UTC bounds is correct.
function toQuery(state: HistoryTableState): string {
	const params = new URLSearchParams();
	if (state.action) params.set("action", state.action);
	if (state.mode) params.set("mode", state.mode);
	if (state.status) params.set("status", state.status);
	if (state.target) params.set("target", state.target);
	if (state.from) params.set("from", `${state.from}T00:00:00.000Z`);
	if (state.to) params.set("to", `${state.to}T23:59:59.999Z`);
	params.set("page", String(state.page));
	params.set("pageSize", String(state.pageSize));
	return params.toString();
}

function targetSection(run: ActionRunRow): SectionKey | null {
	switch (run.actionType) {
		case "grant-access":
			return "operations";
		case "email-send":
			return "email";
		case "release-year-set":
		case "release-year-revert":
			return "release-year";
		case "lyrics-save":
		case "lyrics-mark-instrumental":
			return "lyrics-review";
		case "audio-approve":
		case "audio-reject":
		case "audio-replace":
		case "audio-submit-url":
			return "audio-review";
		case "instrumental-approve":
		case "instrumental-reject":
			return "instrumental-review";
		default:
			return null;
	}
}

// Release-year is the only action with a recovery contract. Revert is offered
// only when a prior non-null year existed (the preservation trigger blocks
// restoring null); the server still re-checks the current==written precondition
// and 409s if it moved.
function releaseYearRevertTarget(
	run: ActionRunRow,
): { songId: string; previousYear: number } | null {
	if (run.actionType !== "release-year-set" || run.status !== "succeeded") {
		return null;
	}
	if (!run.targetId) return null;
	const previous = run.resultSummary?.previousYear;
	return typeof previous === "number"
		? { songId: run.targetId, previousYear: previous }
		: null;
}

function RunDetail({
	run,
	onClose,
	onReverted,
}: {
	run: ActionRunRow;
	onClose: () => void;
	onReverted: () => void;
}) {
	const navigate = useNavigate();
	const section = targetSection(run);
	const [reverting, setReverting] = useState(false);
	const revert = releaseYearRevertTarget(run);

	async function copyDetails() {
		await navigator.clipboard.writeText(JSON.stringify(run, null, 2));
		toast.success("Run details copied");
	}

	async function revertReleaseYear() {
		if (!revert) return;
		setReverting(true);
		try {
			await postJson(`/api/release-year-reviews/${revert.songId}/revert`, {
				runId: run.id,
			});
			toast.success(`Reverted to ${revert.previousYear}`);
			onReverted();
			onClose();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			setReverting(false);
		}
	}

	function openTarget() {
		// Accounts deep-link to User Detail; song/review targets have no per-row
		// deep link, so we open the owning queue section.
		if (run.targetType === "account" && run.targetId) {
			navigate("users", { user: run.targetId });
		} else if (section) {
			navigate(section);
		}
	}

	function duplicateEmail() {
		// The body is deliberately absent from SQLite history. EmailSection restores
		// the browser-local copy made at send time, or explains why it is unavailable.
		navigate("email", { duplicateRun: run.id });
	}

	return (
		<Drawer title="Action run" onClose={onClose}>
			<div className="drawer-section">
				<h3>Identity</h3>
				<dl className="drawer-kv">
					<dt>Action</dt>
					<dd>{run.actionType}</dd>
					<dt>Mode</dt>
					<dd>
						<Badge tone={run.mode === "commit" ? "default" : "accent"}>
							{run.mode}
						</Badge>
					</dd>
					<dt>Status</dt>
					<dd>
						<Badge tone={statusTone(run.status)}>{run.status}</Badge>
					</dd>
					<dt>Target</dt>
					<dd>
						{run.targetLabel ?? run.targetId ?? "—"}
						{run.targetType && <span className="dim"> · {run.targetType}</span>}
					</dd>
					<dt>Production ref</dt>
					<dd>{run.prodRef}</dd>
					{run.externalId && (
						<>
							<dt>External ID</dt>
							<dd>{run.externalId}</dd>
						</>
					)}
					{run.parentRunId && (
						<>
							<dt>Parent run</dt>
							<dd>{run.parentRunId}</dd>
						</>
					)}
				</dl>
			</div>

			<div className="drawer-section">
				<h3>Timestamps</h3>
				<dl className="drawer-kv">
					<dt>Started</dt>
					<dd>{run.startedAt}</dd>
					<dt>Completed</dt>
					<dd>{run.completedAt ?? "—"}</dd>
				</dl>
			</div>

			<div className="drawer-section">
				<h3>Input summary</h3>
				{run.inputSummary ? (
					<pre className="drawer-json">
						{JSON.stringify(run.inputSummary, null, 2)}
					</pre>
				) : (
					<div className="dim">No input summary recorded.</div>
				)}
			</div>

			<div className="drawer-section">
				<h3>Result</h3>
				{run.resultSummary ? (
					<pre className="drawer-json">
						{JSON.stringify(run.resultSummary, null, 2)}
					</pre>
				) : (
					<div className="dim">No result summary recorded.</div>
				)}
			</div>

			{run.errorMessage && (
				<div className="drawer-section">
					<h3>Error</h3>
					<div className="drawer-error">{run.errorMessage}</div>
				</div>
			)}

			<div className="btn-row">
				{(run.targetType === "account" || section) && (
					<button type="button" className="btn" onClick={openTarget}>
						Open target
					</button>
				)}
				{revert && (
					<button
						type="button"
						className="btn"
						disabled={reverting}
						onClick={revertReleaseYear}
					>
						{reverting ? "Reverting…" : `Revert to ${revert.previousYear}`}
					</button>
				)}
				{run.actionType === "email-send" && (
					<button type="button" className="btn" onClick={duplicateEmail}>
						Duplicate into composer
					</button>
				)}
				<button type="button" className="btn" onClick={copyDetails}>
					Copy details
				</button>
			</div>
		</Drawer>
	);
}

const historyColumns = (
	onOpen: (row: ActionRunRow) => void,
): DataTableColumn<ActionRunRow>[] => [
	{
		key: "startedAt",
		header: "When",
		render: (r) => <span className="dim">{relativeTime(r.startedAt)}</span>,
	},
	{
		key: "action",
		header: "Action",
		render: (r) => <span className="primary">{r.actionType}</span>,
	},
	{
		key: "mode",
		header: "Mode",
		render: (r) => (
			<Badge tone={r.mode === "commit" ? "default" : "accent"}>{r.mode}</Badge>
		),
	},
	{
		key: "status",
		header: "Status",
		render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
	},
	{
		key: "target",
		header: "Target",
		render: (r) => (
			<span className="dim" title={r.targetId ?? ""}>
				{r.targetLabel ?? r.targetId ?? "—"}
			</span>
		),
	},
	{
		key: "view",
		header: "",
		render: (r) => (
			<button type="button" className="btn mini" onClick={() => onOpen(r)}>
				View
			</button>
		),
	},
];

export function HistorySection({ refreshKey }: { refreshKey: number }) {
	const [state, setState] = useState<HistoryTableState>(readHistoryState);
	const [openRun, setOpenRun] = useState<ActionRunRow | null>(null);

	useEffect(() => {
		const onPopState = () => setState(readHistoryState());
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	// Deep link (e.g. from an Operations commit): ?run=<id> opens that run once,
	// then the id is dropped from the URL so refresh/Back behave normally.
	useEffect(() => {
		const url = new URL(window.location.href);
		const runId = url.searchParams.get("run");
		if (!runId) return;
		url.searchParams.delete("run");
		window.history.replaceState({ controlPanel: true }, "", url);
		getJson<ActionRunRow>(`/api/history/${runId}`)
			.then((run) => setOpenRun(run))
			.catch(() => {
				toast.error("Could not open that action run.");
			});
	}, []);

	function update(patch: Partial<HistoryTableState>) {
		const next = { ...state, ...patch };
		setState(next);
		updateHistoryUrl(next);
	}

	const query = toQuery(state);
	const runs = useApi<PageResult<ActionRunRow>>(
		`/api/history?${query}`,
		refreshKey,
	);
	const summary = useApi<ActionRunTodaySummary>(
		"/api/history/summary",
		refreshKey,
	);

	const hasActiveFilters =
		state.action !== "" ||
		state.mode !== "" ||
		state.status !== "" ||
		state.from !== "" ||
		state.to !== "";

	return (
		<div className="grid">
			<Card span={4}>
				<Stat
					label="Commits today"
					value={summary.data?.commits ?? 0}
					icon={CheckCircleIcon}
				/>
			</Card>
			<Card span={4}>
				<Stat
					label="Dry runs today"
					value={summary.data?.dryRuns ?? 0}
					icon={FlaskIcon}
				/>
			</Card>
			<Card span={4}>
				<Stat
					label="Failed / partial today"
					value={summary.data?.failedOrPartial ?? 0}
					icon={WarningIcon}
				/>
			</Card>

			<Card
				title="Action history"
				icon={ClockCounterClockwiseIcon}
				span={12}
				action={
					<a
						className="btn"
						href={`/api/history/export.json?${query}`}
						download
					>
						Export history JSON
					</a>
				}
			>
				<p className="stat-sub" style={{ marginBottom: 12 }}>
					Local record for operator recall and recovery — not an authoritative
					or tamper-proof audit log.
				</p>
				<DataTable
					tableId="action-history"
					columns={historyColumns(setOpenRun)}
					rows={runs.data?.rows ?? []}
					total={runs.data?.total ?? 0}
					page={runs.data?.page ?? state.page}
					pageSize={runs.data?.pageSize ?? state.pageSize}
					search={state.target}
					sort="startedAt"
					direction="desc"
					getRowId={(row) => row.id}
					filters={
						<>
							<select
								className="select"
								aria-label="Action"
								value={state.action}
								onChange={(event) =>
									update({ action: event.target.value, page: 1 })
								}
							>
								<option value="">All actions</option>
								{ACTION_TYPES.map((action) => (
									<option key={action} value={action}>
										{action}
									</option>
								))}
							</select>
							<select
								className="select"
								aria-label="Mode"
								value={state.mode}
								onChange={(event) =>
									update({ mode: event.target.value, page: 1 })
								}
							>
								<option value="">All modes</option>
								{MODES.map((mode) => (
									<option key={mode} value={mode}>
										{mode}
									</option>
								))}
							</select>
							<select
								className="select"
								aria-label="Status"
								value={state.status}
								onChange={(event) =>
									update({ status: event.target.value, page: 1 })
								}
							>
								<option value="">All statuses</option>
								{STATUSES.map((status) => (
									<option key={status} value={status}>
										{status}
									</option>
								))}
							</select>
							<input
								className="input"
								type="date"
								aria-label="From date"
								value={state.from}
								onChange={(event) =>
									update({ from: event.target.value, page: 1 })
								}
							/>
							<input
								className="input"
								type="date"
								aria-label="To date"
								value={state.to}
								onChange={(event) =>
									update({ to: event.target.value, page: 1 })
								}
							/>
						</>
					}
					hasActiveFilters={hasActiveFilters}
					onSearchChange={(target) => update({ target, page: 1 })}
					onSortChange={() => {}}
					onPageChange={(page) => update({ page })}
					onPageSizeChange={(pageSize) => update({ pageSize, page: 1 })}
					onReset={() =>
						update({
							action: "",
							mode: "",
							status: "",
							target: "",
							from: "",
							to: "",
							page: 1,
							pageSize: 50,
						})
					}
					loading={runs.loading}
					refreshing={runs.refreshing}
					error={runs.error}
					onRetry={runs.refetch}
					empty="No actions recorded yet."
					noMatches="No actions match these filters."
				/>
			</Card>

			{openRun && (
				<RunDetail
					run={openRun}
					onClose={() => setOpenRun(null)}
					onReverted={runs.refetch}
				/>
			)}
		</div>
	);
}
