import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { registerOpenModal } from "../lib/modal-open";

/**
 * Local confirmation modal — replaces native window.confirm for prod writes.
 *
 * Unlike window.confirm it traps focus, restores focus to its trigger on close,
 * and exposes an accessible title/description. Escape dismisses only *before*
 * submission: once the operator confirms, the request is in flight against prod
 * and a stray keypress must not tear the dialog down mid-write. `onConfirm` is
 * awaited; a rejection keeps the modal open and surfaces the error so the
 * operator can retry or cancel.
 *
 * When `requireReason` is set the confirm button stays disabled until a
 * non-empty reason is entered — the plan's rule that destructive single-record
 * actions capture a reason while simple corrections do not.
 */
export function ConfirmModal({
	title,
	description,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	danger = false,
	requireReason = false,
	reasonLabel = "Reason",
	reasonPlaceholder,
	onConfirm,
	onClose,
}: {
	title: string;
	description: ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
	requireReason?: boolean;
	reasonLabel?: string;
	reasonPlaceholder?: string;
	onConfirm: (reason: string) => Promise<void>;
	onClose: () => void;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLElement | null>(
		document.activeElement as HTMLElement | null,
	);
	const [reason, setReason] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const titleId = useId();
	const descId = useId();

	// Submitting is read inside the mount-only key handler; keep it in a ref so the
	// listener always sees the latest value without rebinding.
	const submittingRef = useRef(false);
	submittingRef.current = submitting;

	useEffect(() => {
		const unregister = registerOpenModal();
		const first = panelRef.current?.querySelector<HTMLElement>(
			"input, textarea, button",
		);
		(first ?? panelRef.current)?.focus();
		const trigger = triggerRef.current;

		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape" && !submittingRef.current) {
				event.stopPropagation();
				onClose();
				return;
			}
			if (event.key !== "Tab") return;
			const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
				"a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
			);
			if (!focusables || focusables.length === 0) return;
			const list = Array.from(focusables);
			const firstEl = list[0];
			const lastEl = list[list.length - 1];
			if (!firstEl || !lastEl) return;
			if (event.shiftKey && document.activeElement === firstEl) {
				event.preventDefault();
				lastEl.focus();
			} else if (!event.shiftKey && document.activeElement === lastEl) {
				event.preventDefault();
				firstEl.focus();
			}
		}

		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
			unregister();
			trigger?.focus();
		};
	}, [onClose]);

	const canConfirm =
		!submitting && (!requireReason || reason.trim().length > 0);

	async function confirm() {
		if (!canConfirm) return;
		setSubmitting(true);
		setError(null);
		try {
			await onConfirm(reason.trim());
		} catch (e) {
			setSubmitting(false);
			setError(e instanceof Error ? e.message : String(e));
		}
	}

	return (
		<div className="modal-root">
			<button
				type="button"
				className="modal-backdrop"
				aria-label="Cancel"
				disabled={submitting}
				onClick={() => !submitting && onClose()}
			/>
			<div
				ref={panelRef}
				className="modal-panel"
				role="alertdialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={descId}
				tabIndex={-1}
			>
				<h2 id={titleId} className="modal-title">
					{title}
				</h2>
				<div id={descId} className="modal-desc">
					{description}
				</div>

				{requireReason && (
					<div className="field">
						<label htmlFor={`${titleId}-reason`}>
							{reasonLabel}
							<span style={{ color: "var(--accent)" }}> *</span>
						</label>
						<input
							id={`${titleId}-reason`}
							className="input"
							placeholder={reasonPlaceholder}
							value={reason}
							disabled={submitting}
							onChange={(e) => setReason(e.target.value)}
						/>
					</div>
				)}

				{error && <div className="result err">{error}</div>}

				<div className="btn-row modal-actions">
					<button
						type="button"
						className="btn"
						disabled={submitting}
						onClick={() => onClose()}
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						className={`btn ${danger ? "danger" : "primary"}`}
						disabled={!canConfirm}
						onClick={confirm}
					>
						{submitting ? "Working…" : confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
