import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
	type BatchPreview,
	batchTracker,
	commitBatch,
	previewBatch,
	sendEmailTest,
} from "../lib/batch";
import { registerOpenModal } from "../lib/modal-open";

/**
 * Batch preview → confirm → commit modal. Preview resolves the exact cohort
 * server-side and snapshots it; only then does Commit run it. Production and the
 * irreversible effects are named in the confirmation, and a committed batch is
 * handed to the persistent progress drawer (via batchTracker) so it survives
 * navigation and reload.
 *
 * `emailGate` enforces the plan's mandatory test-send: a real send to the
 * operator's own address must succeed for the current draft before Commit is
 * offered, and the server re-checks the draft hash on commit.
 */
export function BatchLauncher({
	actionType,
	title,
	description,
	buildInput,
	children,
	emailGate,
	onClose,
	onCommitted,
}: {
	actionType: string;
	title: string;
	description?: ReactNode;
	buildInput: () => Record<string, unknown>;
	children?: ReactNode;
	emailGate?: {
		getDraft: () => Record<string, unknown>;
		// A composer test can satisfy this gate when it matches the unchanged
		// draft. The server still verifies the hash at commit time.
		testedBodyHash?: string | null;
	};
	onClose: () => void;
	onCommitted?: () => void;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLElement | null>(
		document.activeElement as HTMLElement | null,
	);
	const [preview, setPreview] = useState<BatchPreview | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [testAddress, setTestAddress] = useState("");
	const [testedHash, setTestedHash] = useState<string | null>(
		emailGate?.testedBodyHash ?? null,
	);
	const titleId = useId();

	// The preview is invalidated by any input change, mirroring registry commits:
	// a stale snapshot must never be committed. Bodies changing also void the test.
	const busyRef = useRef(false);
	busyRef.current = busy;

	useEffect(() => {
		const unregister = registerOpenModal();
		const trigger = triggerRef.current;
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape" && !busyRef.current) {
				event.stopPropagation();
				onClose();
			}
		}
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
			unregister();
			trigger?.focus();
		};
	}, [onClose]);

	async function runPreview() {
		setBusy(true);
		setError(null);
		setTestedHash(emailGate?.testedBodyHash ?? null);
		try {
			const result = await previewBatch({ ...buildInput(), actionType });
			setPreview(result);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	async function runTest() {
		if (!emailGate) return;
		setBusy(true);
		setError(null);
		try {
			const result = await sendEmailTest({
				...emailGate.getDraft(),
				to: testAddress.trim(),
			});
			setTestedHash(result.bodyHash);
			toast.success(`Test sent to ${testAddress.trim()}`);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	async function commit() {
		if (!preview) return;
		setBusy(true);
		setError(null);
		try {
			await commitBatch(preview.batchId, testedHash);
			batchTracker.track(preview.batchId);
			toast.success(`Batch started — ${preview.eligible} target(s)`);
			onCommitted?.();
			onClose();
		} catch (e) {
			setBusy(false);
			setError(e instanceof Error ? e.message : String(e));
		}
	}

	const emailReady = !emailGate || testedHash !== null;
	const canCommit =
		!busy && preview !== null && preview.eligible > 0 && emailReady;

	return (
		<div className="modal-root">
			<button
				type="button"
				className="modal-backdrop"
				aria-label="Cancel"
				disabled={busy}
				onClick={() => !busy && onClose()}
			/>
			<div
				ref={panelRef}
				className="modal-panel batch-launcher"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
			>
				<h2 id={titleId} className="modal-title">
					{title}
				</h2>
				{description && <div className="modal-desc">{description}</div>}

				{children && <div className="batch-form">{children}</div>}

				<div className="btn-row">
					<button
						type="button"
						className="btn"
						disabled={busy}
						onClick={runPreview}
					>
						{preview ? "Re-preview" : "Preview"}
					</button>
				</div>

				{preview && (
					<div className="batch-preview">
						<div className="batch-preview-summary">
							<strong>{preview.eligible}</strong> eligible ·{" "}
							<strong>{preview.skipped}</strong> skipped ·{" "}
							<strong>{preview.estimatedActions}</strong> production action(s)
						</div>
						{Object.entries(preview.summary).length > 0 && (
							<ul className="batch-preview-buckets">
								{Object.entries(preview.summary).map(([key, value]) => (
									<li key={key}>
										<span className="dim">{key}</span> {value}
									</li>
								))}
							</ul>
						)}
						{preview.skippedReasons.length > 0 && (
							<ul className="batch-preview-skipped">
								{preview.skippedReasons.map((row) => (
									<li key={row.reason}>
										<span className="dim">{row.reason}</span> — {row.count}
									</li>
								))}
							</ul>
						)}
						{preview.warnings.map((warning) => (
							<div key={warning} className="result warn">
								{warning}
							</div>
						))}
						{preview.targetsPreview.length > 0 && (
							<details className="batch-preview-targets">
								<summary>
									First {preview.targetsPreview.length} target(s)
								</summary>
								<ul>
									{preview.targetsPreview.map((target) => (
										<li key={target.targetId}>
											{target.label ?? target.targetId}
										</li>
									))}
								</ul>
							</details>
						)}
						{preview.eligible === 0 && (
							<div className="result err">
								Nothing eligible to run — adjust the selection.
							</div>
						)}
					</div>
				)}

				{preview && preview.eligible > 0 && emailGate && (
					<div className="batch-email-test">
						<div className="field">
							<label htmlFor={`${titleId}-test`}>
								Send a test to yourself first (required)
							</label>
							<div className="btn-row">
								<input
									id={`${titleId}-test`}
									className="input"
									type="email"
									placeholder="you@hearted.music"
									value={testAddress}
									disabled={busy}
									onChange={(event) => setTestAddress(event.target.value)}
								/>
								<button
									type="button"
									className="btn"
									disabled={busy || !testAddress.trim()}
									onClick={runTest}
								>
									Send test
								</button>
							</div>
							{testedHash && (
								<span className="dim">
									Test sent — Send is enabled for this draft.
								</span>
							)}
						</div>
					</div>
				)}

				{error && <div className="result err">{error}</div>}

				<div className="btn-row modal-actions">
					<button
						type="button"
						className="btn"
						disabled={busy}
						onClick={onClose}
					>
						Cancel
					</button>
					<button
						type="button"
						className="btn primary"
						disabled={!canCommit}
						onClick={commit}
					>
						{busy
							? "Working…"
							: preview
								? `Commit to production (${preview.eligible})`
								: "Commit"}
					</button>
				</div>
			</div>
		</div>
	);
}
