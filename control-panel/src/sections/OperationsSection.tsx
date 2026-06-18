import {
	PlayIcon,
	TerminalWindowIcon,
	TestTubeIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { AccountPicker } from "../components/AccountPicker";
import { Badge, Card, ErrorState, Loading } from "../components/primitives";
import { postJson, useApi } from "../lib/api";
import { noAutofill } from "../lib/form";
import type {
	OperationDef,
	OperationField,
	OperationResult,
} from "../lib/types";

function initialValue(f: OperationField): string {
	if (f.type === "select") return f.options?.[0]?.value ?? "";
	if (f.type === "number") return f.default ?? "";
	return "";
}

function OperationForm({ op }: { op: OperationDef }) {
	const [values, setValues] = useState<Record<string, string>>(() =>
		Object.fromEntries(op.fields.map((f) => [f.name, initialValue(f)])),
	);
	// Display labels for non-text fields (e.g. the picked account name), used in
	// the run confirmation since the stored value is an opaque id.
	const [labels, setLabels] = useState<Record<string, string>>({});
	const [result, setResult] = useState<OperationResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<null | "dry" | "run">(null);

	const isVisible = (f: OperationField): boolean =>
		!f.visibleWhen || values[f.visibleWhen.field] === f.visibleWhen.equals;

	const missingRequired = op.fields.some(
		(f) => isVisible(f) && f.required && !values[f.name]?.trim(),
	);

	const accountField = op.fields.find((f) => f.type === "account");

	async function submit(dryRun: boolean) {
		if (!dryRun) {
			const target = accountField
				? labels[accountField.name] || "this account"
				: values.selectorValue || "this account";
			if (
				!window.confirm(
					`Run "${op.title}" against PRODUCTION for ${target}?\n\nThis is a real write.`,
				)
			)
				return;
		}
		setBusy(dryRun ? "dry" : "run");
		setError(null);
		setResult(null);
		try {
			const res = await postJson<OperationResult>(`/api/operations/${op.id}`, {
				...values,
				dryRun,
			});
			setResult(res);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
		}
	}

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
								onChange={(e) =>
									setValues((v) => ({ ...v, [f.name]: e.target.value }))
								}
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
								onChange={(e) =>
									setValues((v) => ({ ...v, [f.name]: e.target.value }))
								}
							/>
						) : (
							<input
								id={fieldId}
								className="input"
								placeholder={f.placeholder}
								value={values[f.name]}
								{...noAutofill}
								onChange={(e) =>
									setValues((v) => ({ ...v, [f.name]: e.target.value }))
								}
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
						onClick={() => submit(true)}
					>
						<TestTubeIcon size={14} weight="bold" />
						{busy === "dry" ? "Checking…" : "Dry run"}
					</button>
				)}
				<button
					type="button"
					className="btn primary"
					disabled={busy !== null || missingRequired}
					onClick={() => submit(false)}
				>
					<PlayIcon size={14} weight="fill" />
					{busy === "run" ? "Running…" : "Run"}
				</button>
			</div>

			{error && <div className="result err">{error}</div>}
			{result && (
				<div className={`result ${result.ok ? "ok" : "err"}`}>
					<strong>
						{result.status === "dry_run" ? "Preview" : result.status}
					</strong>{" "}
					— {result.message}
					{result.details && (
						<pre>{JSON.stringify(result.details, null, 2)}</pre>
					)}
				</div>
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
