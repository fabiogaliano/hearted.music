import {
	CaretDownIcon,
	PlayIcon,
	TerminalWindowIcon,
	TestTubeIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
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

function PreviewRows({ preview }: { preview: OperationPreview }) {
	return (
		<div className="op-preview">
			{ROW_GROUPS.map((group) => {
				const rows = preview.rows.filter((r) => r.kind === group.kind);
				if (rows.length === 0) return null;
				return (
					<div className="op-preview-group" key={group.kind}>
						<h4>{group.heading}</h4>
						<dl className="drawer-kv">
							{rows.map((row) => (
								<div
									key={`${row.label}-${row.value}`}
									className="op-preview-row"
								>
									<dt>{row.label}</dt>
									<dd className={row.tone ? `tone-${row.tone}` : undefined}>
										{row.value}
									</dd>
								</div>
							))}
						</dl>
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

	function invalidatePreview() {
		// Any input change makes the previous preview stale; drop it so Commit
		// disables until a fresh dry run.
		setPreview(null);
		setPreviewId(null);
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
		} catch (e) {
			setPreview(null);
			setPreviewId(null);
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
		setResult(null);
		setError(null);
	}

	const canCommit = previewId !== null && busy === null;

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
				<button
					type="button"
					className="btn primary"
					disabled={!canCommit || missingRequired}
					onClick={() => setConfirmOpen(true)}
					title={
						previewId === null
							? "Run a dry run first to preview the exact change"
							: undefined
					}
				>
					<PlayIcon size={14} weight="fill" />
					Commit
				</button>
			</div>

			{previewId === null && preview === null && !result && (
				<p className="field-hint" style={{ marginTop: 8 }}>
					Commit is available only after a successful dry run.
				</p>
			)}

			{error && <div className="result err">{error}</div>}

			{preview && (
				<div className="result ok" style={{ marginTop: 12 }}>
					<PreviewRows preview={preview} />
					{!preview.willChange && (
						<p className="field-hint">
							This would be a no-op against current state.
						</p>
					)}
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
