import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	type ActiveBatch,
	BATCH_LABELS,
	type BatchStatus,
	type BatchView,
	batchTracker,
	cancelBatch,
	getBatch,
	listActiveBatches,
	resumeBatch,
	retryFailedBatch,
	TERMINAL_STATUSES,
} from "../lib/batch";

/**
 * Persistent batch progress affordance, mounted once in the app shell so it
 * survives section navigation and browser refresh. The server owns batch state;
 * this polls it — every second while any batch is running, slower when idle —
 * and stops once everything is terminal. Partial completion is never shown as
 * success: the terminal line reads "N succeeded · M failed · K skipped".
 */
const STATUS_TONE: Record<BatchStatus, string> = {
	preview: "",
	running: "accent",
	succeeded: "success",
	failed: "danger",
	partial: "warning",
	cancelled: "",
	interrupted: "warning",
};

export function BatchProgressDrawer() {
	const [open, setOpen] = useState(false);
	const [views, setViews] = useState<Record<string, BatchView>>({});

	const refresh = useCallback(async () => {
		// The union of what this browser committed and any batch the server still
		// considers active (e.g. a crash-interrupted run from a prior session).
		let active: ActiveBatch[] = [];
		try {
			active = (await listActiveBatches()).batches;
		} catch {
			active = [];
		}
		for (const batch of active) batchTracker.track(batch.id);
		const ids = new Set([
			...batchTracker.get(),
			...active.map((batch) => batch.id),
		]);
		const results = await Promise.all(
			[...ids].map(async (id) => {
				try {
					return [id, await getBatch(id)] as const;
				} catch {
					// A batch that no longer resolves (e.g. a stale tracked id) is dropped.
					batchTracker.untrack(id);
					return null;
				}
			}),
		);
		const next: Record<string, BatchView> = {};
		for (const entry of results) {
			if (entry?.[1].batch) next[entry[0]] = entry[1];
		}
		setViews(next);
	}, []);

	// A track/untrack elsewhere (e.g. a commit from a section) refreshes at once
	// rather than waiting for the next poll tick.
	useEffect(() => batchTracker.subscribe(() => void refresh()), [refresh]);

	const batches = Object.values(views)
		.map((view) => view.batch)
		.filter((batch): batch is NonNullable<typeof batch> => batch !== null)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	const running = batches.filter((batch) => batch.status === "running").length;
	const resumable = batches.filter(
		(batch) => batch.status === "interrupted",
	).length;
	const active = running + resumable;

	useEffect(() => {
		void refresh();
		const anyRunning = running > 0;
		// Poll fast while work is in flight, slow while only terminal/interrupted
		// rows remain (so a Resume elsewhere is still noticed), and not at all when
		// nothing is tracked.
		if (batches.length === 0) return;
		const interval = anyRunning ? 1000 : open ? 5000 : 15000;
		const timer = window.setInterval(() => void refresh(), interval);
		return () => window.clearInterval(timer);
	}, [refresh, running, open, batches.length]);

	if (batches.length === 0) return null;

	function exportResults(view: BatchView) {
		const blob = new Blob([JSON.stringify(view, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `batch-${view.batch?.id ?? "results"}.json`;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	async function act(
		fn: (id: string) => Promise<BatchView>,
		id: string,
		label: string,
	) {
		try {
			await fn(id);
			await refresh();
			toast.success(label);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	}

	return (
		<div className="batch-drawer-root">
			<button
				type="button"
				className={`batch-drawer-pill ${active > 0 ? "active" : ""}`}
				onClick={() => setOpen((value) => !value)}
			>
				{running > 0
					? `${running} batch running…`
					: resumable > 0
						? `${resumable} batch interrupted`
						: `${batches.length} batch(es)`}
			</button>

			{open && (
				<section className="batch-drawer" aria-label="Batch progress">
					<div className="batch-drawer-head">
						<strong>Batches</strong>
						<button
							type="button"
							className="btn"
							onClick={() => setOpen(false)}
						>
							Close
						</button>
					</div>
					{batches.map((batch) => {
						const view = views[batch.id];
						const terminal = TERMINAL_STATUSES.has(batch.status);
						const done = batch.succeeded + batch.failed + batch.skipped;
						const runningTargets = (view?.targets ?? []).filter(
							(target) => target.status === "running",
						);
						return (
							<div className="batch-drawer-item" key={batch.id}>
								<div className="batch-drawer-item-head">
									<span>
										{BATCH_LABELS[batch.actionType] ?? batch.actionType}
									</span>
									<span className={`badge ${STATUS_TONE[batch.status]}`}>
										{batch.status}
									</span>
								</div>
								<div className="batch-drawer-progress">
									<div
										className="batch-drawer-bar"
										style={{
											width: `${
												batch.total > 0
													? Math.round((done / batch.total) * 100)
													: 100
											}%`,
										}}
									/>
								</div>
								<div className="batch-drawer-counts dim">
									{batch.succeeded} succeeded · {batch.failed} failed ·{" "}
									{batch.skipped} skipped
									{batch.cancelled > 0 ? ` · ${batch.cancelled} cancelled` : ""}
									{batch.total > 0 ? ` · of ${batch.total}` : ""}
								</div>
								{runningTargets.length > 0 && (
									<div className="batch-drawer-current dim">
										Running:{" "}
										{runningTargets
											.slice(0, 3)
											.map((target) => target.targetLabel ?? target.targetId)
											.join(", ")}
									</div>
								)}
								<div className="btn-row">
									{batch.status === "running" && (
										<button
											type="button"
											className="btn"
											onClick={() =>
												act(cancelBatch, batch.id, "Cancelling pending targets")
											}
										>
											Cancel
										</button>
									)}
									{batch.status === "interrupted" && (
										<button
											type="button"
											className="btn primary"
											onClick={() =>
												act(resumeBatch, batch.id, "Resuming batch")
											}
										>
											Resume
										</button>
									)}
									{terminal && batch.failed > 0 && (
										<button
											type="button"
											className="btn"
											onClick={() =>
												act(
													retryFailedBatch,
													batch.id,
													"Retrying failed targets",
												)
											}
										>
											Retry failed
										</button>
									)}
									{view && (
										<button
											type="button"
											className="btn"
											onClick={() => exportResults(view)}
										>
											Export results
										</button>
									)}
									{terminal && (
										<button
											type="button"
											className="btn"
											onClick={() => batchTracker.untrack(batch.id)}
										>
											Dismiss
										</button>
									)}
								</div>
							</div>
						);
					})}
				</section>
			)}
		</div>
	);
}
