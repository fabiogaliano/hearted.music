import {
	CaretDownIcon,
	PlayIcon,
	TerminalWindowIcon,
	TestTubeIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AccountPicker } from "../components/AccountPicker";
import { ConfirmModal } from "../components/ConfirmModal";
import { Badge, Card, ErrorState, Loading } from "../components/primitives";
import { postJson, useApi } from "../lib/api";
import { noAutofill } from "../lib/form";
import { useNavigate } from "../lib/navigation";
import { readOperatorLabel, writeOperatorLabel } from "../lib/operator";
import type {
	OperationDef,
	OperationField,
	OperationPreview,
	OperationPreviewResponse,
	OperationPreviewRow,
	OperationResult,
} from "../lib/types";

function initialValue(
	f: OperationField,
	prefillAccount: string,
	operatorLabel: string,
): string {
	if (f.type === "account") return prefillAccount;
	if (f.type === "select") return f.options?.[0]?.value ?? "";
	if (f.type === "number") return f.default ?? "";
	// Seed the audit "requested-by" from the locally stored operator label; still
	// fully editable per action.
	if (f.name === "requestedBy") return operatorLabel;
	return "";
}

const ROW_GROUPS: { kind: OperationPreviewRow["kind"]; heading: string }[] = [
	{ kind: "identity", heading: "Target" },
	{ kind: "current", heading: "Current state" },
	{ kind: "change", heading: "Intended change" },
	{ kind: "skip", heading: "No-op" },
	{ kind: "downstream", heading: "Downstream effects" },
	{ kind: "warning", heading: "Warnings" },
];

// How stale a preview is, and a re-run affordance when it's expired. The server
// already fingerprints input + prod state and 409s a stale commit; surfacing the
// expiry here turns that hard failure into a visible, self-service one.
function PreviewFreshness({
	capturedAt,
	expiresAt,
	now,
	onRerun,
	rerunning,
}: {
	capturedAt: number | null;
	expiresAt: string | null;
	now: number;
	onRerun: () => void;
	rerunning: boolean;
}) {
	if (capturedAt == null) return null;
	const stale = expiresAt != null && now > Date.parse(expiresAt);
	const seconds = Math.max(0, Math.round((now - capturedAt) / 1000));
	const ago =
		seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
	return (
		<div className={`op-fresh${stale ? " stale" : ""}`}>
			<span className="op-fresh-dot" />
			<span>
				{stale
					? "Prod state changed since capture — re-run before committing"
					: `Captured ${ago} · prod state matches · safe to commit`}
			</span>
			<button
				type="button"
				className="btn mini"
				onClick={onRerun}
				disabled={rerunning}
			>
				{rerunning ? "Checking…" : "Re-run dry run"}
			</button>
		</div>
	);
}

// The flat preview rows as a grouped-by-intent change ledger. Each group is a
// tag-labelled block of bordered rows; tone colours the value and warnings tint
// the whole row so the operator reads the impact at a glance.
function PreviewRows({ preview }: { preview: OperationPreview }) {
	return (
		<div className="op-ledger-rows">
			{ROW_GROUPS.map((group) => {
				const rows = preview.rows.filter((r) => r.kind === group.kind);
				if (rows.length === 0) return null;
				return (
					<div className={`op-grp kind-${group.kind}`} key={group.kind}>
						<span className="rv-tag">{group.heading}</span>
						<div className="op-rows">
							{rows.map((row) => (
								<div
									key={`${row.label}-${row.value}`}
									className={`op-r kind-${group.kind}${
										row.tone ? ` tone-${row.tone}` : ""
									}`}
								>
									<span className="op-k">{row.label}</span>
									<span className="op-v">{row.value}</span>
								</div>
							))}
						</div>
					</div>
				);
			})}
		</div>
	);
}

function OperationForm({ op }: { op: OperationDef }) {
	const navigate = useNavigate();
	// User Detail's "Grant access…" button arrives here with ?account=&accountLabel=
	// prefilled; consume it once so a second operation card on the page doesn't
	// also pick it up after the operator clears the first one.
	const [prefill] = useState(() => {
		const params = new URL(window.location.href).searchParams;
		const account = params.get("account") ?? "";
		const accountLabel = params.get("accountLabel") ?? "";
		if (account) {
			const next = new URL(window.location.href);
			next.searchParams.delete("account");
			next.searchParams.delete("accountLabel");
			window.history.replaceState({ controlPanel: true }, "", next);
		}
		return { account, accountLabel };
	});
	const [operatorLabel] = useState(readOperatorLabel);
	const [values, setValues] = useState<Record<string, string>>(() =>
		Object.fromEntries(
			op.fields.map((f) => [
				f.name,
				initialValue(f, prefill.account, operatorLabel),
			]),
		),
	);
	// Display labels for non-text fields (e.g. the picked account name), used in
	// the commit confirmation since the stored value is an opaque id.
	const [labels, setLabels] = useState<Record<string, string>>(() =>
		prefill.account
			? Object.fromEntries(
					op.fields
						.filter((f) => f.type === "account")
						.map((f) => [f.name, prefill.accountLabel]),
				)
			: {},
	);
	// A valid preview is required before commit; changing any input clears it so a
	// stale preview can never gate a write.
	const [preview, setPreview] = useState<OperationPreview | null>(null);
	const [previewId, setPreviewId] = useState<string | null>(null);
	const [previewExpiresAt, setPreviewExpiresAt] = useState<string | null>(null);
	const [previewCapturedAt, setPreviewCapturedAt] = useState<number | null>(
		null,
	);
	// Must acknowledge any warning rows before commit unlocks.
	const [ackWarnings, setAckWarnings] = useState(false);
	const [nowTick, setNowTick] = useState(() => Date.now());
	const [result, setResult] = useState<OperationResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<null | "dry" | "commit">(null);
	const [showDebug, setShowDebug] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);

	const isVisible = (f: OperationField): boolean =>
		!f.visibleWhen || values[f.visibleWhen.field] === f.visibleWhen.equals;

	const missingRequired = op.fields.some(
		(f) => isVisible(f) && f.required && !values[f.name]?.trim(),
	);

	const accountField = op.fields.find((f) => f.type === "account");
	const targetLabel = accountField
		? labels[accountField.name] || "this account"
		: values.selectorValue || "this account";

	// Tick once a second while a preview is live so "captured Ns ago" advances and
	// the commit gate flips the moment the preview outlives its server expiry.
	useEffect(() => {
		if (preview == null || previewExpiresAt == null) return;
		const id = setInterval(() => setNowTick(Date.now()), 1000);
		return () => clearInterval(id);
	}, [preview, previewExpiresAt]);

	function invalidatePreview() {
		// Any input change makes the previous preview stale; drop it so Commit
		// disables until a fresh dry run.
		setPreview(null);
		setPreviewId(null);
		setPreviewExpiresAt(null);
		setPreviewCapturedAt(null);
		setAckWarnings(false);
	}

	function setValue(name: string, value: string) {
		setValues((v) => ({ ...v, [name]: value }));
		invalidatePreview();
	}

	async function dryRun() {
		setBusy("dry");
		setError(null);
		setResult(null);
		try {
			const res = await postJson<OperationPreviewResponse>(
				`/api/operations/${op.id}/preview`,
				values,
			);
			setPreview(res.preview);
			setPreviewId(res.previewId);
			setPreviewExpiresAt(res.expiresAt);
			setPreviewCapturedAt(Date.now());
			setNowTick(Date.now());
			setAckWarnings(false);
		} catch (e) {
			setPreview(null);
			setPreviewId(null);
			setPreviewExpiresAt(null);
			setPreviewCapturedAt(null);
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
		}
	}

	async function commit() {
		setBusy("commit");
		setError(null);
		try {
			const res = await postJson<OperationResult>(
				`/api/operations/${op.id}/commit`,
				{ ...values, previewId },
			);
			setResult(res);
			// A committed preview is consumed server-side; require a new dry run
			// before another commit.
			setPreview(null);
			setPreviewId(null);
			setPreviewExpiresAt(null);
			setPreviewCapturedAt(null);
			setAckWarnings(false);
			setConfirmOpen(false);
			// Persist whatever the operator typed as requested-by as the new default.
			if (values.requestedBy?.trim())
				writeOperatorLabel(values.requestedBy.trim());
			toast.success(
				res.ok ? "Operation committed" : "Operation reported an issue",
			);
		} catch (e) {
			// Keep the modal open on failure so the error is visible in context; a
			// 409 here means the preview went stale and the operator must re-run it.
			const message = e instanceof Error ? e.message : String(e);
			setError(message);
			throw e;
		} finally {
			setBusy(null);
		}
	}

	function reset() {
		setValues(
			Object.fromEntries(
				op.fields.map((f) => [f.name, initialValue(f, "", operatorLabel)]),
			),
		);
		setLabels({});
		setPreview(null);
		setPreviewId(null);
		setPreviewExpiresAt(null);
		setPreviewCapturedAt(null);
		setAckWarnings(false);
		setResult(null);
		setError(null);
	}

	const warningRows = preview?.rows.filter((r) => r.kind === "warning") ?? [];
	const needsAck = warningRows.length > 0;
	const isStale =
		preview != null &&
		previewExpiresAt != null &&
		nowTick > Date.parse(previewExpiresAt);
	const canCommit =
		previewId !== null &&
		busy === null &&
		!isStale &&
		(!needsAck || ackWarnings);

	return (
		<Card
			title={op.title}
			icon={TerminalWindowIcon}
			span={6}
			action={op.danger ? <Badge tone="danger">danger</Badge> : undefined}
		>
			<p className="muted-text" style={{ marginBottom: 16 }}>
				{op.description}
			</p>

			{op.fields.map((f) => {
				if (!isVisible(f)) return null;
				const fieldId = `${op.id}-${f.name}`;
				return (
					<div className="field" key={f.name}>
						<label htmlFor={fieldId}>
							{f.label}
							{f.required && <span style={{ color: "var(--accent)" }}> *</span>}
						</label>
						{f.type === "select" ? (
							<select
								id={fieldId}
								className="select"
								value={values[f.name]}
								onChange={(e) => setValue(f.name, e.target.value)}
							>
								{f.options?.map((o) => (
									<option key={o.value} value={o.value}>
										{o.label}
									</option>
								))}
							</select>
						) : f.type === "account" ? (
							<AccountPicker
								inputId={fieldId}
								placeholder={f.placeholder}
								value={values[f.name]}
								label={labels[f.name]}
								onChange={(id, label) => {
									setValues((v) => ({ ...v, [f.name]: id }));
									setLabels((l) => ({ ...l, [f.name]: label }));
									invalidatePreview();
								}}
							/>
						) : f.type === "number" ? (
							<input
								id={fieldId}
								className="input"
								type="number"
								inputMode="numeric"
								min={f.min}
								max={f.max}
								placeholder={f.placeholder}
								value={values[f.name]}
								{...noAutofill}
								onChange={(e) => setValue(f.name, e.target.value)}
							/>
						) : (
							<input
								id={fieldId}
								className="input"
								placeholder={f.placeholder}
								value={values[f.name]}
								{...noAutofill}
								onChange={(e) => setValue(f.name, e.target.value)}
							/>
						)}
					</div>
				);
			})}

			<div className="btn-row">
				{op.supportsDryRun && (
					<button
						type="button"
						className="btn"
						disabled={busy !== null || missingRequired}
						onClick={dryRun}
					>
						<TestTubeIcon size={14} weight="bold" />
						{busy === "dry" ? "Checking…" : "Dry run"}
					</button>
				)}
				{/* Ops without a dry run gate commit here; dry-run ops commit from the
				    ledger foot below once a preview exists. */}
				{!op.supportsDryRun && (
					<button
						type="button"
						className="btn primary"
						disabled={!canCommit || missingRequired}
						onClick={() => setConfirmOpen(true)}
					>
						<PlayIcon size={14} weight="fill" />
						Commit
					</button>
				)}
			</div>

			{previewId === null &&
				preview === null &&
				!result &&
				op.supportsDryRun && (
					<p className="field-hint" style={{ marginTop: 8 }}>
						Run a dry run to preview the exact change — commit unlocks after.
					</p>
				)}

			{error && <div className="result err">{error}</div>}

			{preview && (
				<div className="op-ledger" style={{ marginTop: 12 }}>
					<div className="op-ledger-head">
						<span className="op-ledger-title serif upright">{op.title}</span>
						<span
							className={`op-verdict ${preview.willChange ? "change" : "noop"}`}
						>
							{preview.willChange ? "Will change production" : "No-op"}
						</span>
					</div>
					<div className="op-ledger-target num">target · {targetLabel}</div>

					<PreviewFreshness
						capturedAt={previewCapturedAt}
						expiresAt={previewExpiresAt}
						now={nowTick}
						onRerun={dryRun}
						rerunning={busy === "dry"}
					/>

					<PreviewRows preview={preview} />

					{needsAck && (
						<label className="op-ack">
							<input
								type="checkbox"
								checked={ackWarnings}
								onChange={(e) => setAckWarnings(e.target.checked)}
							/>
							I've read the warning{warningRows.length > 1 ? "s" : ""} above.
						</label>
					)}

					<div className="op-ledger-foot">
						<button
							type="button"
							className="btn commit"
							disabled={!canCommit || missingRequired}
							onClick={() => setConfirmOpen(true)}
							title={
								isStale
									? "Preview may be stale — re-run the dry run"
									: needsAck && !ackWarnings
										? "Acknowledge the warning before committing"
										: undefined
							}
						>
							<PlayIcon size={14} weight="fill" />
							Commit to production
						</button>
						<button
							type="button"
							className="op-debug-toggle"
							onClick={() => setShowDebug((s) => !s)}
							aria-expanded={showDebug}
						>
							<CaretDownIcon
								size={12}
								weight="bold"
								style={{
									transform: showDebug ? "rotate(0)" : "rotate(-90deg)",
									transition: "transform 120ms ease",
								}}
							/>
							Debug
						</button>
					</div>
					{showDebug && (
						<pre className="drawer-json">
							{JSON.stringify(preview.raw, null, 2)}
						</pre>
					)}
				</div>
			)}

			{result && (
				<div className={`result ${result.ok ? "ok" : "err"}`}>
					<strong>{result.status}</strong> — {result.message}
					<div className="btn-row" style={{ marginTop: 10 }}>
						{result.runId && (
							<button
								type="button"
								className="btn mini"
								onClick={() => navigate("history", { run: result.runId ?? "" })}
							>
								View in action history
							</button>
						)}
						<button type="button" className="btn mini" onClick={reset}>
							Reset form
						</button>
					</div>
				</div>
			)}

			{confirmOpen && (
				<ConfirmModal
					title={`Commit "${op.title}" to production`}
					danger
					confirmLabel="Commit to production"
					description={
						<>
							This runs a real write against <strong>production</strong> for{" "}
							<strong>{targetLabel}</strong> (1 target). Grant and Backstage
							writes are <strong>not reversible</strong> from the panel. Review
							the preview above before committing.
						</>
					}
					onConfirm={async () => {
						await commit();
					}}
					onClose={() => setConfirmOpen(false)}
				/>
			)}
		</Card>
	);
}

export function OperationsSection({ refreshKey }: { refreshKey: number }) {
	const { data, error } = useApi<{ operations: OperationDef[] }>(
		"/api/operations",
		refreshKey,
	);
	if (error) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	return (
		<div className="grid">
			{data.operations.map((op) => (
				<OperationForm key={op.id} op={op} />
			))}
		</div>
	);
}
