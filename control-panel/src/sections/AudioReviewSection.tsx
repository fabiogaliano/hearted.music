import {
	ArrowSquareOutIcon,
	CheckCircleIcon,
	MagnifyingGlassIcon,
	MusicNotesIcon,
	PaperPlaneTiltIcon,
	SwapIcon,
	TrashIcon,
	WarningCircleIcon,
	WaveformIcon,
	YoutubeLogoIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { MatchCandidateSnapshot } from "@/lib/integrations/youtube-audio/types";
import { BatchLauncher } from "../components/BatchLauncher";
import { ConfirmModal } from "../components/ConfirmModal";
import { Badge, Card, ErrorState } from "../components/primitives";
import { QueueToolbar } from "../components/QueueToolbar";
import { postJson, useApi } from "../lib/api";
import { noAutofill } from "../lib/form";
import { useQueueKeyboard } from "../lib/queue-keyboard";
import { type QueueState, useQueueState } from "../lib/queue-state";
import type { PageResult } from "../lib/types";

type AudioFeatureCandidate = MatchCandidateSnapshot;

interface AudioFeatureReviewRow {
	id: string;
	status: "pending" | "approved" | "rejected";
	sourceType: "youtube_search" | "youtube_url";
	createdAt: string;

	songId: string;
	songName: string;
	artists: string[];
	albumName: string | null;
	imageUrl: string | null;
	spotifyDurationMs: number | null;

	audioFeatureId: string | null;
	acousticness: number | null;
	danceability: number | null;
	energy: number | null;
	instrumentalness: number | null;
	liveness: number | null;
	loudness: number | null;
	speechiness: number | null;
	tempo: number | null;
	valence: number | null;

	youtubeUrl: string | null;
	youtubeVideoId: string | null;
	youtubeTitle: string | null;
	youtubeChannel: string | null;
	youtubeDurationSeconds: number | null;
	youtubeThumbnailUrl: string | null;

	searchQuery: string | null;
	matchScore: number | null;
	matchReasons: string[];
	clipStartsSeconds: number[];
	aggregationMetadata: Record<string, unknown>;
	candidates: AudioFeatureCandidate[];
}

// A stuck song with no usable feature: either awaiting a manual URL
// (manual_needed) or terminally failed (unavailable_terminal). Shape mirrors the
// audio_feature_backfill_job row the server maps.
interface AudioFeatureJobRow {
	jobId: string;
	songId: string;
	status: "manual_needed" | "failed";
	errorCode: string | null;
	errorMessage: string | null;
	attempts: number;
	sourceUrl: string | null;
	createdAt: string;
	updatedAt: string;

	songName: string;
	artistLabel: string;
	albumName: string | null;
	imageUrl: string | null;
	spotifyDurationMs: number | null;
	candidates: AudioFeatureCandidate[];
}

interface QueueBuckets {
	approval: number;
	needsUrl: number;
	failed: number;
}

type Tab = "pending" | "approved" | "rejected" | "needs_url" | "failed";
type ReviewStatus = "pending" | "approved" | "rejected";
type FilterKey = "sourceType" | "minMatchScore" | "maxDurationDelta";

function isReviewTab(tab: Tab): tab is ReviewStatus {
	return tab === "pending" || tab === "approved" || tab === "rejected";
}

// The shared duration() helper collapses to coarse units ("4m"), which is
// useless when the whole point is comparing 3:42 against 3:39. Format precisely.
function clock(seconds: number | null): string {
	if (seconds == null) return "—";
	const total = Math.round(seconds);
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

// The duration gap is the single strongest "does this match" signal — a YouTube
// result that's minutes off is almost certainly the wrong video.
function durationDelta(spotifyMs: number | null, ytSec: number | null) {
	if (spotifyMs == null || ytSec == null) return null;
	const delta = Math.round(Math.abs(spotifyMs / 1000 - ytSec));
	const tone = delta <= 2 ? "success" : delta <= 8 ? "warning" : "danger";
	return { delta, tone };
}

const FEATURE_KEYS: {
	key: keyof AudioFeatureReviewRow;
	label: string;
	digits: number;
}[] = [
	{ key: "danceability", label: "Dance", digits: 2 },
	{ key: "energy", label: "Energy", digits: 2 },
	{ key: "valence", label: "Valence", digits: 2 },
	{ key: "acousticness", label: "Acoustic", digits: 2 },
	{ key: "instrumentalness", label: "Instr.", digits: 2 },
	{ key: "liveness", label: "Live", digits: 2 },
	{ key: "speechiness", label: "Speech", digits: 2 },
	{ key: "loudness", label: "Loud (dB)", digits: 1 },
	{ key: "tempo", label: "Tempo", digits: 0 },
];

function FeatureGrid({ r }: { r: AudioFeatureReviewRow }) {
	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "repeat(3, 1fr)",
				gap: 8,
				marginTop: 10,
			}}
		>
			{FEATURE_KEYS.map(({ key, label, digits }) => {
				const value = r[key] as number | null;
				return (
					<div key={String(key)} className="stat" style={{ padding: 8 }}>
						<div className="stat-label">{label}</div>
						<div className="stat-value" style={{ fontSize: 18 }}>
							{value == null ? "—" : value.toFixed(digits)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

// Em dash, not hyphen: song names here often already contain " - " (e.g.
// "Some Might Say - Remastered"), so a hyphen separator would blur together.
function songTitle(artistLabel: string, songName: string): string {
	const name = songName || "Unknown song";
	return artistLabel ? `${artistLabel} — ${name}` : name;
}

function SpotifyPanel({ r }: { r: AudioFeatureReviewRow }) {
	return (
		<div className="ar-panel">
			{r.imageUrl ? (
				<img className="ar-art cover" src={r.imageUrl} alt="" loading="lazy" />
			) : (
				<span className="ar-art cover placeholder" />
			)}
			<div className="ar-body">
				<div className="ar-eyebrow">
					<MusicNotesIcon className="sp" size={12} weight="fill" />
					Spotify song
				</div>
				<div className="ar-title">
					{songTitle(r.artists.join(", "), r.songName)}
				</div>
				<div className="ar-sub">
					{r.albumName ?? "—"}
					{r.spotifyDurationMs != null && (
						<>
							{" · "}
							<span className="ar-clock">
								{clock(r.spotifyDurationMs / 1000)}
							</span>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

function YoutubePanel({ r }: { r: AudioFeatureReviewRow }) {
	const sourceLabel =
		r.sourceType === "youtube_url" ? "manual url" : "via search";
	return (
		<div className="ar-panel">
			{r.youtubeThumbnailUrl ? (
				<img
					className="ar-art thumb"
					src={r.youtubeThumbnailUrl}
					alt=""
					loading="lazy"
				/>
			) : (
				<span className="ar-art thumb placeholder" />
			)}
			<div className="ar-body">
				<div className="ar-eyebrow">
					<YoutubeLogoIcon className="yt" size={13} weight="fill" />
					YouTube match
					<span className="tag">· {sourceLabel}</span>
				</div>
				<div className="ar-title">{r.youtubeTitle ?? "(no title)"}</div>
				<div className="ar-sub">
					{r.youtubeChannel ?? "—"}
					{r.youtubeDurationSeconds != null && (
						<>
							{" · "}
							<span className="ar-clock">
								{clock(r.youtubeDurationSeconds)}
							</span>
						</>
					)}
				</div>
				{r.youtubeUrl && (
					<a
						href={r.youtubeUrl}
						target="_blank"
						rel="noreferrer"
						className="user-link ar-link"
					>
						<ArrowSquareOutIcon size={13} weight="bold" /> open on YouTube
					</a>
				)}
			</div>
		</div>
	);
}

function Verdict({
	r,
	reasons,
}: {
	r: AudioFeatureReviewRow;
	reasons: string[];
}) {
	const delta = durationDelta(r.spotifyDurationMs, r.youtubeDurationSeconds);
	return (
		<div className="ar-verdict">
			<div className="ar-verdict-line">
				{r.matchScore != null && (
					<span className="ar-score">
						{(r.matchScore * 100).toFixed(0)}% match
					</span>
				)}
				{r.matchScore != null && delta && <span className="conn">·</span>}
				{delta && (
					<span className={`ar-delta ${delta.tone}`}>Δ {delta.delta}s</span>
				)}
			</div>
			{reasons.length > 0 && (
				<div className="ar-reasons">{reasons.join(" · ")}</div>
			)}
		</div>
	);
}

function CandidateRow({
	c,
	spotifyDurationMs,
	onUse,
}: {
	c: AudioFeatureCandidate;
	spotifyDurationMs: number | null;
	onUse?: (url: string) => void;
}) {
	const delta = durationDelta(spotifyDurationMs, c.durationSeconds);
	// Rejected candidates carry a reject reason instead of positive signals; a
	// viable one with no reasons still gets a legible fallback rather than blank.
	const detail = c.rejected
		? (c.rejectReason ?? "rejected")
		: c.reasons.length > 0
			? c.reasons.join(" · ")
			: "no positive signals";
	return (
		<div className={`ar-cand${c.rejected ? " rejected" : ""}`}>
			<div className="ar-cand-rank">{c.rejected ? "✕" : (c.rank ?? "•")}</div>
			<div className="ar-cand-main">
				<div className="ar-cand-title">{c.title ?? "(no title)"}</div>
				<div className="ar-sub">
					{c.channel ?? "—"}
					{c.durationSeconds != null && (
						<>
							{" · "}
							<span className="ar-clock">{clock(c.durationSeconds)}</span>
						</>
					)}
					{delta && (
						<>
							{" · "}
							<span className={`ar-delta ${delta.tone}`}>Δ {delta.delta}s</span>
						</>
					)}
				</div>
				<div className="ar-reasons">{detail}</div>
			</div>
			<div className="ar-cand-side">
				<span className="ar-score">
					{c.score != null ? `${Math.round(c.score * 100)}%` : "—"}
				</span>
				<div className="ar-cand-actions">
					{c.url && (
						<a
							href={c.url}
							target="_blank"
							rel="noreferrer"
							className="user-link"
							style={{ fontSize: 12 }}
							aria-label="Open candidate on YouTube"
						>
							<ArrowSquareOutIcon size={13} weight="bold" />
						</a>
					)}
					{onUse && c.url && (
						<button
							type="button"
							className="btn mini"
							onClick={() => onUse(c.url)}
						>
							Use
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

function CandidateList({
	candidates,
	spotifyDurationMs,
	onUse,
}: {
	candidates: AudioFeatureCandidate[];
	spotifyDurationMs: number | null;
	onUse?: (url: string) => void;
}) {
	if (candidates.length === 0) return null;
	return (
		<div className="ar-cands">
			{candidates.map((c, i) => (
				<CandidateRow
					key={c.videoId ?? c.url ?? String(i)}
					c={c}
					spotifyDurationMs={spotifyDurationMs}
					onUse={onUse}
				/>
			))}
		</div>
	);
}

const REVIEW_STATUS_BADGE: Record<
	ReviewStatus,
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
	onReplaced,
	selected,
	onToggleSelect,
}: {
	r: AudioFeatureReviewRow;
	// Approve/reject are lifted to the queue so keyboard and advance-after-action
	// stay consistent; replace stays local because it owns a URL-entry form.
	busy: boolean;
	error: string | null;
	onApprove?: () => void;
	onReject?: () => void;
	onReplaced?: () => void;
	selected?: boolean;
	onToggleSelect?: () => void;
}) {
	const [replaceBusy, setReplaceBusy] = useState(false);
	const [replaceError, setReplaceError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [replaceOpen, setReplaceOpen] = useState(false);
	const [replaceUrl, setReplaceUrl] = useState("");
	const [confirmReplace, setConfirmReplace] = useState(false);
	const actionable = Boolean(onApprove && onReject);
	const badge = REVIEW_STATUS_BADGE[r.status];

	async function replace() {
		setReplaceBusy(true);
		setReplaceError(null);
		setNotice(null);
		try {
			const res = await postJson(
				`/api/audio-feature-reviews/${r.id}/replace-youtube`,
				{ url: replaceUrl },
			);
			setReplaceOpen(false);
			setConfirmReplace(false);
			setReplaceUrl("");
			const job = (res as { manualJobId?: string }).manualJobId;
			setNotice(`Replacement queued${job ? ` · job ${job.slice(0, 8)}` : ""}.`);
			onReplaced?.();
		} catch (e) {
			setReplaceError(e instanceof Error ? e.message : String(e));
			throw e;
		} finally {
			setReplaceBusy(false);
		}
	}

	const disabled = busy || replaceBusy;

	return (
		<Card
			title="Audio match"
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
			<div className="ar-compare">
				<SpotifyPanel r={r} />
				<YoutubePanel r={r} />
			</div>

			<Verdict r={r} reasons={r.matchReasons} />

			{actionable && (
				<div className="btn-row" style={{ marginTop: 14 }}>
					<button
						type="button"
						className="btn primary"
						disabled={disabled}
						onClick={onApprove}
					>
						<CheckCircleIcon size={14} weight="fill" />
						{busy ? "Working…" : "Looks correct"}
					</button>
					<button
						type="button"
						className="btn"
						disabled={disabled}
						onClick={() => setReplaceOpen((o) => !o)}
					>
						<SwapIcon size={14} weight="bold" /> Replace URL
					</button>
					<button
						type="button"
						className="btn"
						disabled={disabled}
						onClick={onReject}
						style={{ color: "var(--danger)" }}
					>
						<TrashIcon size={14} weight="bold" /> Reject & delete
					</button>
				</div>
			)}

			{actionable && replaceOpen && (
				<div className="field" style={{ marginTop: 12 }}>
					<label htmlFor={`replace-${r.id}`}>YouTube URL</label>
					<input
						id={`replace-${r.id}`}
						className="input"
						placeholder="https://www.youtube.com/watch?v=…"
						value={replaceUrl}
						{...noAutofill}
						onChange={(e) => setReplaceUrl(e.target.value)}
					/>
					<div className="btn-row" style={{ marginTop: 8 }}>
						<button
							type="button"
							className="btn primary"
							disabled={disabled || replaceUrl.trim().length === 0}
							onClick={() => setConfirmReplace(true)}
						>
							{replaceBusy ? "Queuing…" : "Queue replacement"}
						</button>
					</div>
				</div>
			)}

			{confirmReplace && (
				<ConfirmModal
					title="Replace audio feature"
					danger
					confirmLabel="Queue replacement"
					description={
						<>
							Replace the feature for <strong>{r.songName}</strong> with this
							YouTube URL? This runs against <strong>production</strong>: the
							current feature is deleted and a manual backfill job is queued.
							This is <strong>not reversible</strong> from the panel.
						</>
					}
					onConfirm={() => replace()}
					onClose={() => setConfirmReplace(false)}
				/>
			)}

			<details className="ar-extra">
				<summary>Audio features</summary>
				<FeatureGrid r={r} />
			</details>

			{r.candidates.length > 0 && (
				<details className="ar-extra">
					<summary>All candidates ({r.candidates.length})</summary>
					<CandidateList
						candidates={r.candidates}
						spotifyDurationMs={r.spotifyDurationMs}
					/>
				</details>
			)}

			{Object.keys(r.aggregationMetadata).length > 0 && (
				<details className="ar-extra">
					<summary>
						Aggregation metadata ({Object.keys(r.aggregationMetadata).length})
					</summary>
					<pre
						style={{
							marginTop: 8,
							fontSize: 12,
							maxHeight: 180,
							overflow: "auto",
						}}
					>
						{JSON.stringify(r.aggregationMetadata, null, 2)}
					</pre>
				</details>
			)}

			{(error || replaceError) && (
				<div className="result err" style={{ marginTop: 10 }}>
					{error ?? replaceError}
				</div>
			)}
			{notice && (
				<div className="result ok" style={{ marginTop: 10 }}>
					{notice}
				</div>
			)}
		</Card>
	);
}

const REVIEW_EMPTY: Record<ReviewStatus, string> = {
	pending: "No pending audio reviews.",
	approved: "No approved audio reviews yet.",
	rejected: "No rejected audio reviews yet.",
};

function AudioReviewsQueue({
	queue,
	refreshKey,
	onActioned,
}: {
	queue: QueueState<Tab, FilterKey>;
	refreshKey: number;
	onActioned: () => void;
}) {
	const searchRef = useRef<HTMLInputElement>(null);
	const [actioning, setActioning] = useState<string | null>(null);
	const [actionError, setActionError] = useState<{
		id: string;
		message: string;
	} | null>(null);
	// Reject deletes the live feature and its downstream artifacts, so it goes
	// through the confirm modal with a mandatory reason.
	const [rejectTarget, setRejectTarget] =
		useState<AudioFeatureReviewRow | null>(null);

	const status = queue.tab as ReviewStatus;
	const params = new URLSearchParams(queue.listParams);
	params.set("status", status);
	const { data, error, loading, refreshing, refetch } = useApi<
		PageResult<AudioFeatureReviewRow>
	>(`/api/audio-feature-reviews?${params.toString()}`, refreshKey);

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
	const isPending = status === "pending";
	const canSelect = isPending && !isFocus;

	// List-mode + pending selection for the safe approval batch; dropped when the
	// operator leaves the pending tab or enters focus mode.
	const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [batchOpen, setBatchOpen] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset-on-change; status/mode are the intended triggers
	useEffect(() => {
		setSelectedIds(new Set());
	}, [status, queue.mode]);
	function toggleSelect(id: string) {
		setSelectedIds((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

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

	function afterAction() {
		refetch();
		onActioned();
	}

	async function approve(id: string) {
		setActioning(id);
		setActionError(null);
		try {
			await postJson(`/api/audio-feature-reviews/${id}/approve`, {});
			afterAction();
		} catch (e) {
			setActionError({
				id,
				message: e instanceof Error ? e.message : String(e),
			});
		} finally {
			setActioning(null);
		}
	}
	async function confirmReject(r: AudioFeatureReviewRow, reason: string) {
		setActioning(r.id);
		setActionError(null);
		try {
			await postJson(`/api/audio-feature-reviews/${r.id}/reject`, { reason });
			setRejectTarget(null);
			afterAction();
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
		onApprove: () => {
			if (isPending && isFocus && focusRow && actioning === null) {
				void approve(focusRow.id);
			}
		},
	});

	const hasNext = isFocus ? globalIndex < total - 1 : queue.page < pageCount;
	const hasPrev = isFocus ? globalIndex > 0 : queue.page > 1;

	function card(r: AudioFeatureReviewRow) {
		return (
			<ReviewCard
				key={r.id}
				r={r}
				busy={actioning === r.id}
				error={actionError?.id === r.id ? actionError.message : null}
				onApprove={isPending ? () => approve(r.id) : undefined}
				onReject={isPending ? () => setRejectTarget(r) : undefined}
				onReplaced={afterAction}
				selected={canSelect ? selectedIds.has(r.id) : undefined}
				onToggleSelect={canSelect ? () => toggleSelect(r.id) : undefined}
			/>
		);
	}

	if (error && !data) return <ErrorState message={error} />;

	return (
		<>
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
					activeFilterCount={queue.activeFilterCount}
					filters={
						<>
							<select
								className="select"
								aria-label="Source type"
								value={queue.filters.sourceType}
								onChange={(e) => queue.setFilter("sourceType", e.target.value)}
							>
								<option value="all">Any source</option>
								<option value="youtube_search">Auto search</option>
								<option value="youtube_url">Manual URL</option>
							</select>
							<input
								className="input"
								type="number"
								step="0.05"
								min="0"
								max="1"
								aria-label="Min match score"
								placeholder="Min score"
								value={queue.filters.minMatchScore}
								onChange={(e) =>
									queue.setFilter("minMatchScore", e.target.value)
								}
							/>
							<input
								className="input"
								type="number"
								min="0"
								aria-label="Max duration delta (s)"
								placeholder="Max Δs"
								value={queue.filters.maxDurationDelta}
								onChange={(e) =>
									queue.setFilter("maxDurationDelta", e.target.value)
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
					actionType="audio-approve-batch"
					title="Approve audio reviews — batch"
					description="Approves the selected pending matches. Rows no longer pending are skipped. Approval only — reject and replace stay single-item."
					buildInput={() => ({ reviewIds: [...selectedIds] })}
					onClose={() => setBatchOpen(false)}
					onCommitted={() => {
						setSelectedIds(new Set());
						afterAction();
					}}
				/>
			)}

			{rows.length === 0 ? (
				<div className="card span-12">
					<div className="empty">
						{queue.q ? "No songs match your search." : REVIEW_EMPTY[status]}
					</div>
				</div>
			) : isFocus ? (
				focusRow && <div className="ar-list span-12">{card(focusRow)}</div>
			) : (
				<div className="ar-list span-12">{rows.map((r) => card(r))}</div>
			)}

			{rejectTarget && (
				<ConfirmModal
					title="Reject & delete audio feature"
					danger
					confirmLabel="Reject & delete"
					requireReason
					reasonPlaceholder="Why this match is wrong"
					description={
						<>
							Reject and DELETE the live audio feature for{" "}
							<strong>{rejectTarget.songName}</strong>? This runs against{" "}
							<strong>production</strong>: it also invalidates any
							analysis/embedding generated from it and re-queues the song. This
							is <strong>not reversible</strong> from the panel.
						</>
					}
					onConfirm={(reason) => confirmReject(rejectTarget, reason)}
					onClose={() => setRejectTarget(null)}
				/>
			)}
		</>
	);
}

// Why a job is stuck, in operator language. Falls back to the raw code so a new
// worker error surfaces legibly instead of vanishing.
const REASON_COPY: Record<string, string> = {
	yt_search_low_confidence:
		"Low-confidence match — auto-search found candidates but none scored high enough.",
	yt_search_no_candidates: "No candidates — the YouTube search came up empty.",
	operator_rejected: "You rejected the auto-matched feature.",
	lease_expired: "Worker lease expired after the max attempts.",
};

function JobCard({
	r,
	onActioned,
}: {
	r: AudioFeatureJobRow;
	onActioned: () => void;
}) {
	const [url, setUrl] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const failed = r.status === "failed";
	const reason = r.errorCode
		? (REASON_COPY[r.errorCode] ?? r.errorCode)
		: "No reason recorded.";
	// Pre-built YouTube search so the operator lands on results for this exact
	// song in one click instead of retyping artist + title.
	const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
		`${r.artistLabel} ${r.songName}`.trim(),
	)}`;

	function submit() {
		setBusy(true);
		setError(null);
		setNotice(null);
		postJson<{ jobId?: string }>(
			`/api/audio-feature-jobs/${r.songId}/submit-url`,
			{ url },
		)
			.then((res) => {
				setUrl("");
				setNotice(
					`Backfill queued${res.jobId ? ` · job ${res.jobId.slice(0, 8)}` : ""}.`,
				);
				onActioned();
			})
			.catch((e) => setError(e instanceof Error ? e.message : String(e)))
			.finally(() => setBusy(false));
	}

	return (
		<Card
			title="Song"
			icon={MusicNotesIcon}
			span={12}
			action={
				failed ? (
					<Badge tone="danger">failed</Badge>
				) : (
					<Badge tone="warning">needs url</Badge>
				)
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
					<div className="ar-title">{songTitle(r.artistLabel, r.songName)}</div>
					<div className="ar-sub">
						{r.albumName ?? "—"}
						{r.spotifyDurationMs != null && (
							<>
								{" · "}
								<span className="ar-clock">
									{clock(r.spotifyDurationMs / 1000)}
								</span>
							</>
						)}
					</div>
				</div>
			</div>

			<div className="ar-verdict">
				<div className="ar-verdict-line">
					<WarningCircleIcon
						size={13}
						weight="fill"
						style={{ color: failed ? "var(--danger)" : "var(--warning)" }}
					/>
					<span>{reason}</span>
				</div>
				{r.errorMessage && <div className="ar-reasons">{r.errorMessage}</div>}
			</div>

			{r.candidates.length > 0 && (
				<details className="ar-extra" open>
					<summary>
						Candidates the auto-search found ({r.candidates.length})
					</summary>
					<CandidateList
						candidates={r.candidates}
						spotifyDurationMs={r.spotifyDurationMs}
						onUse={setUrl}
					/>
				</details>
			)}

			<div className="field" style={{ marginTop: 12 }}>
				<label htmlFor={`url-${r.songId}`}>YouTube URL</label>
				<input
					id={`url-${r.songId}`}
					className="input"
					placeholder="https://www.youtube.com/watch?v=…"
					value={url}
					{...noAutofill}
					onChange={(e) => setUrl(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && url.trim().length > 0 && !busy) submit();
					}}
				/>
				<div className="btn-row" style={{ marginTop: 8 }}>
					<button
						type="button"
						className="btn primary"
						disabled={busy || url.trim().length === 0}
						onClick={submit}
					>
						<PaperPlaneTiltIcon size={14} weight="fill" />
						{busy ? "Queuing…" : "Queue from URL"}
					</button>
					<a href={searchUrl} target="_blank" rel="noreferrer" className="btn">
						<MagnifyingGlassIcon size={14} weight="bold" /> Search on YouTube
					</a>
				</div>
			</div>

			{error && (
				<div className="result err" style={{ marginTop: 10 }}>
					{error}
				</div>
			)}
			{notice && (
				<div className="result ok" style={{ marginTop: 10 }}>
					{notice}
				</div>
			)}
		</Card>
	);
}

const JOB_EMPTY: Record<"needs_url" | "failed", string> = {
	needs_url: "No songs waiting on a URL — nothing to match by hand.",
	failed: "No terminally-failed backfills.",
};

function JobQueue({
	filter,
	refreshKey,
	onActioned,
}: {
	filter: "needs_url" | "failed";
	refreshKey: number;
	onActioned: () => void;
}) {
	const { data, error, refetch } = useApi<{ jobs: AudioFeatureJobRow[] }>(
		`/api/audio-feature-jobs?filter=${filter}`,
		refreshKey,
	);

	if (error) return <ErrorState message={error} />;
	if (!data) {
		return (
			<div className="card span-12">
				<div className="empty">Loading…</div>
			</div>
		);
	}

	if (data.jobs.length === 0) {
		return (
			<div className="card span-12">
				<div className="empty">{JOB_EMPTY[filter]}</div>
			</div>
		);
	}
	return (
		<div className="ar-list span-12">
			{data.jobs.map((r) => (
				<JobCard
					key={r.jobId}
					r={r}
					onActioned={() => {
						refetch();
						onActioned();
					}}
				/>
			))}
		</div>
	);
}

export function AudioReviewSection({ refreshKey }: { refreshKey: number }) {
	const queue = useQueueState<Tab, FilterKey>({
		storageKey: "audio",
		tabs: ["pending", "approved", "rejected", "needs_url", "failed"],
		defaultTab: "pending",
		filterKeys: ["sourceType", "minMatchScore", "maxDurationDelta"],
		filterDefaults: {
			sourceType: "all",
			minMatchScore: "",
			maxDurationDelta: "",
		},
	});
	const counts = useApi<QueueBuckets>(
		"/api/audio-feature-queue/counts",
		refreshKey,
	);
	const b = counts.data;
	const total = b ? b.approval + b.needsUrl + b.failed : 0;

	const label = (base: string, n: number | undefined) =>
		n === undefined ? base : `${base} · ${n}`;

	return (
		<div className="grid">
			<Card
				title="Audio queue"
				icon={WaveformIcon}
				span={12}
				action={
					total > 0 ? (
						<Badge tone="accent">{total} need attention</Badge>
					) : (
						<Badge tone="success">all clear</Badge>
					)
				}
			>
				<p className="muted-text">
					Everything blocking a song's audio features, in one place.{" "}
					<strong>Needs approval</strong> are auto-matched features that went
					live and want a confirm/reject; <strong>Approved</strong> and{" "}
					<strong>Rejected</strong> are a read-only history.{" "}
					<strong>Needs URL</strong> are songs the auto-search couldn't match
					confidently — paste the right YouTube video and a manual backfill is
					queued. <strong>Failed</strong> are terminally-failed backfills; a URL
					fixes them the same way.
				</p>
				<div className="btn-row" style={{ marginTop: 12 }}>
					<button
						type="button"
						className={`btn ${queue.tab === "pending" ? "primary" : ""}`}
						onClick={() => queue.setTab("pending")}
					>
						{label("Needs approval", b?.approval)}
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
					<button
						type="button"
						className={`btn ${queue.tab === "needs_url" ? "primary" : ""}`}
						onClick={() => queue.setTab("needs_url")}
					>
						{label("Needs URL", b?.needsUrl)}
					</button>
					<button
						type="button"
						className={`btn ${queue.tab === "failed" ? "primary" : ""}`}
						onClick={() => queue.setTab("failed")}
					>
						{label("Failed", b?.failed)}
					</button>
				</div>
			</Card>

			{counts.error && <ErrorState message={counts.error} />}

			{isReviewTab(queue.tab) ? (
				<AudioReviewsQueue
					queue={queue}
					refreshKey={refreshKey}
					onActioned={counts.refetch}
				/>
			) : (
				<JobQueue
					filter={queue.tab}
					refreshKey={refreshKey}
					onActioned={counts.refetch}
				/>
			)}
		</div>
	);
}
