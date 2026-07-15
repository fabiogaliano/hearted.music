import {
	CheckCircleIcon,
	MusicNotesIcon,
	TrashIcon,
	WaveformIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { BatchLauncher } from "../components/BatchLauncher";
import { ConfirmModal } from "../components/ConfirmModal";
import { Badge, Card, ErrorState, Loading } from "../components/primitives";
import { QueueToolbar } from "../components/QueueToolbar";
import { postJson, useApi } from "../lib/api";
import { useQueueKeyboard } from "../lib/queue-keyboard";
import { useQueueState } from "../lib/queue-state";
import type { PageResult } from "../lib/types";

interface InstrumentalReviewRow {
	id: string;
	status: "pending" | "approved" | "rejected";
	signal: "instrumentalness" | "genre";
	instrumentalness: number | null;
	matchedGenre: string | null;
	createdAt: string;

	songId: string;
	songName: string;
	artistLabel: string;
	albumName: string | null;
	imageUrl: string | null;
	durationMs: number | null;
}

type Status = "pending" | "approved" | "rejected";
type FilterKey = "signal" | "minInstrumentalness";

interface InstrumentalPage extends PageResult<InstrumentalReviewRow> {
	pendingTotal: number;
}

// Plain-language reason the classifier called this instrumental, so the operator
// can sanity-check the guess at a glance.
function reasonText(r: InstrumentalReviewRow): string {
	if (r.signal === "genre") {
		return r.matchedGenre
			? `Instrumental genre: ${r.matchedGenre}`
			: "Instrumental genre";
	}
	return r.instrumentalness != null
		? `Instrumentalness ${r.instrumentalness.toFixed(2)}`
		: "High instrumentalness";
}

const STATUS_BADGE: Record<
	Status,
	{ tone: "warning" | "success" | "danger"; label: string }
> = {
	pending: { tone: "warning", label: "pending · live" },
	approved: { tone: "success", label: "approved" },
	rejected: { tone: "danger", label: "rejected" },
};

function ReviewCard({
	r,
	busy,
	error,
	onApprove,
	onReject,
	selected,
	onToggleSelect,
}: {
	r: InstrumentalReviewRow;
	busy: boolean;
	error: string | null;
	onApprove?: () => void;
	onReject?: () => void;
	selected?: boolean;
	onToggleSelect?: () => void;
}) {
	// Em dash, not hyphen: song names here often already contain " - " (e.g.
	// "Intro - Live"), so a hyphen separator would blur together.
	const title = r.artistLabel ? `${r.artistLabel} — ${r.songName}` : r.songName;
	const badge = STATUS_BADGE[r.status];

	return (
		<Card
			title="Instrumental guess"
			icon={WaveformIcon}
			span={12}
			action={
				<div className="btn-row">
					{onToggleSelect && (
						<label className="batch-select">
							<input
								type="checkbox"
								checked={selected ?? false}
								onChange={onToggleSelect}
							/>
							Select
						</label>
					)}
					<Badge tone={badge.tone}>{badge.label}</Badge>
				</div>
			}
		>
			<div className="ar-panel">
				{r.imageUrl ? (
					<img
						className="ar-art cover"
						src={r.imageUrl}
						alt=""
						loading="lazy"
					/>
				) : (
					<span className="ar-art cover placeholder" />
				)}
				<div className="ar-body">
					<div className="ar-eyebrow">
						<MusicNotesIcon className="sp" size={12} weight="fill" />
						Spotify song
					</div>
					<div className="ar-title">{title}</div>
					<div className="ar-sub">{r.albumName ?? "—"}</div>
				</div>
			</div>

			<div className="ar-verdict">
				<div className="ar-verdict-line">
					<span className="ar-score">{reasonText(r)}</span>
				</div>
			</div>

			{onApprove && onReject && (
				<div className="btn-row" style={{ marginTop: 14 }}>
					<button
						type="button"
						className="btn primary"
						disabled={busy}
						onClick={onApprove}
					>
						<CheckCircleIcon size={14} weight="fill" />
						{busy ? "Working…" : "Instrumental — correct"}
					</button>
					<button
						type="button"
						className="btn"
						disabled={busy}
						onClick={onReject}
						style={{ color: "var(--danger)" }}
					>
						<TrashIcon size={14} weight="bold" />
						Has vocals — reject
					</button>
				</div>
			)}

			{error && (
				<div className="result err" style={{ marginTop: 10 }}>
					{error}
				</div>
			)}
		</Card>
	);
}

const EMPTY_COPY: Record<Status, string> = {
	pending: "No pending instrumental guesses to review.",
	approved: "No approved instrumental guesses yet.",
	rejected: "No rejected instrumental guesses yet.",
};

export function InstrumentalReviewSection({
	refreshKey,
}: {
	refreshKey: number;
}) {
	const queue = useQueueState<Status, FilterKey>({
		storageKey: "instrumental",
		tabs: ["pending", "approved", "rejected"],
		defaultTab: "pending",
		filterKeys: ["signal", "minInstrumentalness"],
		filterDefaults: { signal: "all", minInstrumentalness: "" },
	});
	const searchRef = useRef<HTMLInputElement>(null);
	const [actioning, setActioning] = useState<string | null>(null);
	const [actionError, setActionError] = useState<{
		id: string;
		message: string;
	} | null>(null);
	// The row awaiting a reject confirmation; reject is destructive and requires a
	// reason, so it goes through the modal rather than a bare window.confirm.
	const [rejectTarget, setRejectTarget] =
		useState<InstrumentalReviewRow | null>(null);
	// Live pending rows selected for a safe approval batch (list mode only).
	const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [batchOpen, setBatchOpen] = useState(false);

	const params = new URLSearchParams(queue.listParams);
	params.set("status", queue.tab);
	const { data, error, loading, refreshing, refetch } =
		useApi<InstrumentalPage>(
			`/api/instrumental-reviews?${params.toString()}`,
			refreshKey,
		);

	const rows = data?.rows ?? [];
	const total = data?.total ?? 0;
	const pageCount = Math.max(1, Math.ceil(total / queue.pageSize));
	const { page, focusIndex, setPage, setFocusIndex } = queue;

	useEffect(() => {
		if (loading) return;
		if (rows.length === 0) {
			if (page > 1) setPage(page - 1);
			return;
		}
		if (focusIndex > rows.length - 1) setFocusIndex(rows.length - 1);
	}, [rows.length, loading, page, focusIndex, setPage, setFocusIndex]);

	const globalIndex = (queue.page - 1) * queue.pageSize + queue.focusIndex;
	const isFocus = queue.mode === "focus";
	const isPending = queue.tab === "pending";

	// A selection is only meaningful for the rows currently in view; leaving the
	// pending tab or switching to focus mode drops it rather than silently acting
	// on rows the operator can no longer see.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset-on-change; tab/mode are the intended triggers
	useEffect(() => {
		setSelectedIds(new Set());
	}, [queue.tab, queue.mode]);

	function goNext() {
		if (isFocus && queue.focusIndex < rows.length - 1) {
			queue.setFocusIndex(queue.focusIndex + 1);
		} else if (queue.page < pageCount) {
			queue.setPage(queue.page + 1);
		}
	}
	function goPrev() {
		if (isFocus && queue.focusIndex > 0) {
			queue.setFocusIndex(queue.focusIndex - 1);
		} else if (queue.page > 1) {
			if (isFocus) queue.setFocusIndex(queue.pageSize - 1);
			queue.setPage(queue.page - 1);
		}
	}

	async function approve(id: string) {
		setActioning(id);
		setActionError(null);
		try {
			await postJson(`/api/instrumental-reviews/${id}/approve`, {});
			refetch();
		} catch (e) {
			setActionError({
				id,
				message: e instanceof Error ? e.message : String(e),
			});
		} finally {
			setActioning(null);
		}
	}
	async function confirmReject(r: InstrumentalReviewRow, reason: string) {
		setActioning(r.id);
		setActionError(null);
		try {
			await postJson(`/api/instrumental-reviews/${r.id}/reject`, { reason });
			setRejectTarget(null);
			refetch();
		} catch (e) {
			setActionError({
				id: r.id,
				message: e instanceof Error ? e.message : String(e),
			});
			throw e;
		} finally {
			setActioning(null);
		}
	}

	const focusRow = rows[Math.min(queue.focusIndex, rows.length - 1)];

	useQueueKeyboard({
		onNext: goNext,
		onPrev: goPrev,
		onSearch: () => searchRef.current?.focus(),
		// A approves the focused, still-live card only — never the destructive
		// reject, which stays behind an explicit confirm.
		onApprove: () => {
			if (isPending && isFocus && focusRow && actioning === null) {
				void approve(focusRow.id);
			}
		},
	});

	if (error && !data) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	const hasNext = isFocus ? globalIndex < total - 1 : queue.page < pageCount;
	const hasPrev = isFocus ? globalIndex > 0 : queue.page > 1;

	// Selection is a list-mode + pending-tab affordance for safe bulk approval.
	const canSelect = isPending && !isFocus;
	function toggleSelect(id: string) {
		setSelectedIds((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function card(r: InstrumentalReviewRow) {
		return (
			<ReviewCard
				key={r.id}
				r={r}
				busy={actioning === r.id}
				error={actionError?.id === r.id ? actionError.message : null}
				onApprove={isPending ? () => approve(r.id) : undefined}
				onReject={isPending ? () => setRejectTarget(r) : undefined}
				selected={canSelect ? selectedIds.has(r.id) : undefined}
				onToggleSelect={canSelect ? () => toggleSelect(r.id) : undefined}
			/>
		);
	}

	return (
		<div className="grid">
			<Card
				title="Instrumental review"
				icon={WaveformIcon}
				span={12}
				action={
					data.pendingTotal > 0 ? (
						<Badge tone="warning">{data.pendingTotal} to review</Badge>
					) : (
						<Badge tone="success">all clear</Badge>
					)
				}
			>
				<p className="muted-text">
					When a song has no lyrics, analysis guesses{" "}
					<strong>instrumental</strong> from its genre or Spotify
					instrumentalness — usually right, occasionally wrong for a vocal track
					tagged with an instrumental-ish genre. Each guess is{" "}
					<strong>already live</strong>. <strong>Approve</strong> the correct
					ones; <strong>Reject</strong> a vocal track to strip the instrumental
					tag and its analysis and send it to the lyrics queue for manual entry
					(it won't be auto-guessed instrumental again). The{" "}
					<strong>Approved</strong> and <strong>Rejected</strong> tabs are a
					read-only history.
				</p>
				<div className="btn-row" style={{ marginTop: 12 }}>
					<button
						type="button"
						className={`btn ${queue.tab === "pending" ? "primary" : ""}`}
						onClick={() => queue.setTab("pending")}
					>
						Pending
					</button>
					<button
						type="button"
						className={`btn ${queue.tab === "approved" ? "primary" : ""}`}
						onClick={() => queue.setTab("approved")}
					>
						Approved
					</button>
					<button
						type="button"
						className={`btn ${queue.tab === "rejected" ? "primary" : ""}`}
						onClick={() => queue.setTab("rejected")}
					>
						Rejected
					</button>
				</div>
			</Card>

			<Card span={12}>
				<QueueToolbar
					searchRef={searchRef}
					search={queue.q}
					onSearchChange={queue.setSearch}
					order={queue.order}
					onOrderChange={queue.setOrder}
					mode={queue.mode}
					onModeChange={queue.setMode}
					pageSize={queue.pageSize}
					onPageSizeChange={queue.setPageSize}
					onReset={queue.reset}
					refreshing={refreshing}
					filters={
						<>
							<select
								className="select"
								aria-label="Signal"
								value={queue.filters.signal}
								onChange={(e) => queue.setFilter("signal", e.target.value)}
							>
								<option value="all">Any signal</option>
								<option value="instrumentalness">Instrumentalness</option>
								<option value="genre">Genre</option>
							</select>
							<input
								className="input"
								type="number"
								step="0.05"
								min="0"
								max="1"
								aria-label="Min instrumentalness"
								placeholder="Min instr."
								style={{ maxWidth: 120 }}
								value={queue.filters.minInstrumentalness}
								onChange={(e) =>
									queue.setFilter("minInstrumentalness", e.target.value)
								}
							/>
						</>
					}
					total={total}
					page={queue.page}
					focusIndex={isFocus ? queue.focusIndex : undefined}
					onPrev={goPrev}
					onNext={goNext}
					hasPrev={hasPrev}
					hasNext={hasNext}
				/>
			</Card>

			{canSelect && selectedIds.size > 0 && (
				<div className="batch-bar span-12">
					<span>{selectedIds.size} selected</span>
					<button
						type="button"
						className="btn primary"
						onClick={() => setBatchOpen(true)}
					>
						Approve {selectedIds.size} selected…
					</button>
				</div>
			)}

			{batchOpen && (
				<BatchLauncher
					actionType="instrumental-approve-batch"
					title="Approve instrumental reviews — batch"
					description="Approves the selected live pending guesses. Rows that are no longer live pending are skipped. This confirms each verdict in production."
					buildInput={() => ({ reviewIds: [...selectedIds] })}
					onClose={() => setBatchOpen(false)}
					onCommitted={() => {
						setSelectedIds(new Set());
						refetch();
					}}
				/>
			)}

			{rows.length === 0 ? (
				<div className="card span-12">
					<div className="empty">
						{queue.q ? "No songs match your search." : EMPTY_COPY[queue.tab]}
					</div>
				</div>
			) : isFocus ? (
				focusRow && <div className="ar-list span-12">{card(focusRow)}</div>
			) : (
				<div className="ar-list span-12">{rows.map((r) => card(r))}</div>
			)}

			{rejectTarget && (
				<ConfirmModal
					title="Mark as having vocals"
					danger
					confirmLabel="Reject (has vocals)"
					requireReason
					reasonPlaceholder="Why this isn't instrumental"
					description={
						<>
							Mark <strong>{rejectTarget.songName}</strong> as having vocals?
							This runs against <strong>production</strong>: it removes the
							instrumental tag and its analysis, and sends the song back to the
							lyrics queue for manual entry. This is{" "}
							<strong>not reversible</strong> from the panel.
						</>
					}
					onConfirm={(reason) => confirmReject(rejectTarget, reason)}
					onClose={() => setRejectTarget(null)}
				/>
			)}
		</div>
	);
}
