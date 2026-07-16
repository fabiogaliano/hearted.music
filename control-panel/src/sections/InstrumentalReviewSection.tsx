import {
	ArrowSquareOutIcon,
	CheckCircleIcon,
	InfoIcon,
	MagnifyingGlassIcon,
	TrashIcon,
	WaveformIcon,
} from "@phosphor-icons/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
	AudioPlayer,
	type AudioPlayerHandle,
	type AudioSource,
} from "../components/AudioPlayer";
import { BatchLauncher } from "../components/BatchLauncher";
import { ConfirmModal } from "../components/ConfirmModal";
import { Badge, ErrorState, Loading } from "../components/primitives";
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

// Mirror of server/instrumental-audio.ts InstrumentalAudioResult.
interface InstrumentalAudioSourceRow {
	videoId: string;
	url: string;
	title: string | null;
	channel: string | null;
	durationSeconds: number | null;
}

interface InstrumentalAudioResult {
	origin: "match" | "search";
	searchQuery: string | null;
	clipStarts: number[];
	sources: InstrumentalAudioSourceRow[];
}

type Status = "pending" | "approved" | "rejected";
type FilterKey = "signal" | "minInstrumentalness";

interface InstrumentalPage extends PageResult<InstrumentalReviewRow> {
	pendingTotal: number;
}

// The shared duration() helper collapses to coarse units ("4m"); the operator is
// sanity-checking a specific track, so show exact m:ss like the audio queue.
function clock(seconds: number | null): string {
	if (seconds == null) return "—";
	const total = Math.round(seconds);
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

// The classifier's claim as the card verdict. Unlike the audio queue's match
// score, this isn't a quality judgement — the tone tracks the review status:
// pending guesses read warning ("check me"), history reads by its outcome.
function verdict(r: InstrumentalReviewRow): {
	num: number | null;
	label: string;
	tone: "" | "warning" | "danger";
} {
	const tone =
		r.status === "pending"
			? "warning"
			: r.status === "rejected"
				? "danger"
				: "";
	if (r.signal === "genre") {
		return {
			num: null,
			label: r.matchedGenre ? `genre: ${r.matchedGenre}` : "genre",
			tone,
		};
	}
	return {
		num:
			r.instrumentalness != null ? Math.round(r.instrumentalness * 100) : null,
		label: "instrumentalness",
		tone,
	};
}

// The duration gap between the Spotify song and a YouTube result — a result
// minutes off is almost certainly the wrong video, so tint it as a warning.
function durationDelta(spotifyMs: number | null, ytSec: number | null) {
	if (spotifyMs == null || ytSec == null) return null;
	const delta = Math.round(Math.abs(spotifyMs / 1000 - ytSec));
	const tone = delta <= 2 ? "success" : delta <= 8 ? "warning" : "danger";
	return { delta, tone };
}

// Pre-built YouTube search — the escape hatch when the panel found nothing
// playable, so the operator lands on results for this exact song in one click.
function youtubeSearchUrl(r: InstrumentalReviewRow): string {
	return `https://www.youtube.com/results?search_query=${encodeURIComponent(
		`${r.artistLabel} ${r.songName}`.trim(),
	)}`;
}

// "Artists — Song", song title in the editorial serif italic; same identity
// treatment as the audio queue so the two review surfaces read as one system.
function IdentityLine({
	artistLabel,
	songName,
}: {
	artistLabel: string;
	songName: string;
}) {
	return (
		<span className="rv-ident">
			{artistLabel && `${artistLabel} — `}
			<span className="serif">{songName || "Unknown song"}</span>
		</span>
	);
}

function VerdictPill({
	r,
	size = "lg",
}: {
	r: InstrumentalReviewRow;
	size?: "lg" | "sm";
}) {
	const v = verdict(r);
	return (
		<span className={`rv-verdict ${v.tone} ${size}`}>
			{v.num != null && (
				<span className="rv-verdict-num serif upright">{v.num}</span>
			)}
			<span className="rv-verdict-label">{v.label}</span>
		</span>
	);
}

function SongFace({
	r,
	size = "lg",
}: {
	r: InstrumentalReviewRow;
	size?: "lg" | "sm";
}) {
	return (
		<div className={`rv-panel sp ${size}`}>
			{r.imageUrl ? (
				<img className="rv-face-art" src={r.imageUrl} alt="" loading="lazy" />
			) : (
				<span className="rv-face-art placeholder" />
			)}
			<div className="rv-face-body">
				<div className="rv-eye">
					<span className="rv-dot sp" />
					<span className="rv-tag">Spotify song</span>
				</div>
				<div className="rv-ptitle">{r.songName || "Unknown song"}</div>
				<div className="rv-psub">
					{[r.artistLabel, r.albumName].filter(Boolean).join(" · ") || "—"}
					{size === "sm" && r.durationMs != null && (
						<span className="num"> · {clock(r.durationMs / 1000)}</span>
					)}
				</div>
				{size === "lg" && r.durationMs != null && (
					<div className="rv-pclock num">{clock(r.durationMs / 1000)}</div>
				)}
			</div>
		</div>
	);
}

// The listen face — what the ear-check plays. Shows the source the operator
// picked in the filmstrip (found via the audio pipeline's stored match or a live
// search), with the raw YouTube search as the always-there escape hatch.
function ListenFace({
	r,
	audio,
	activeIndex,
	size = "lg",
}: {
	r: InstrumentalReviewRow;
	audio: { data: InstrumentalAudioResult | null; error: string | null };
	activeIndex: number;
	size?: "lg" | "sm";
}) {
	const top =
		audio.data?.sources[activeIndex] ?? audio.data?.sources[0] ?? null;
	const originLabel =
		audio.data == null
			? "looking up"
			: audio.data.origin === "match"
				? "pipeline match"
				: "via search";
	return (
		<div className={`rv-panel yt ${size}`}>
			<span className="rv-face-art placeholder" />
			<div className="rv-face-body">
				<div className="rv-eye">
					<span className="rv-dot yt" />
					<span className="rv-tag">YouTube audio · {originLabel}</span>
				</div>
				{audio.error ? (
					<>
						<div className="rv-ptitle">Lookup failed</div>
						<div className="rv-psub">{audio.error}</div>
					</>
				) : audio.data == null ? (
					<>
						<div className="rv-ptitle">Finding audio…</div>
						<div className="rv-psub">Searching YouTube for this song</div>
					</>
				) : top == null ? (
					<>
						<div className="rv-ptitle">No results</div>
						<div className="rv-psub">Nothing playable came back</div>
					</>
				) : (
					<>
						<div className="rv-ptitle">{top.title ?? "(no title)"}</div>
						<div className="rv-psub">
							{top.channel ?? "—"}
							{top.durationSeconds != null && (
								<span className="num"> · {clock(top.durationSeconds)}</span>
							)}
						</div>
					</>
				)}
				{size === "lg" &&
					(top ? (
						<a
							href={top.url}
							target="_blank"
							rel="noreferrer"
							className="rv-plink"
						>
							open on YouTube <ArrowSquareOutIcon size={11} weight="bold" />
						</a>
					) : (
						<a
							href={youtubeSearchUrl(r)}
							target="_blank"
							rel="noreferrer"
							className="rv-plink"
						>
							search on YouTube <MagnifyingGlassIcon size={11} weight="bold" />
						</a>
					))}
			</div>
		</div>
	);
}

function ReviewCard({
	r,
	variant,
	position,
	total,
	statusLabel,
	busy,
	error,
	onApprove,
	onReject,
	onSkip,
	playerRef,
}: {
	r: InstrumentalReviewRow;
	// "focus" = split stage (one framed card); "cockpit" = bare detail beside the
	// rail. Same anatomy as the audio queue's ReviewCard so the surfaces match.
	variant: "focus" | "cockpit";
	position?: number;
	total?: number;
	statusLabel?: string;
	busy: boolean;
	error: string | null;
	onApprove?: () => void;
	onReject?: () => void;
	onSkip?: () => void;
	// The queue owns a single player ref (only one card is ever active) so Space
	// can drive playback from the keyboard.
	playerRef?: RefObject<AudioPlayerHandle | null>;
}) {
	// Only the active card mounts (focus stage or cockpit detail), so this fires
	// one lookup per card the operator actually views; the server caches per song.
	const audio = useApi<InstrumentalAudioResult>(
		`/api/instrumental-reviews/${r.id}/audio-sources`,
	);
	const sources: AudioSource[] = (audio.data?.sources ?? []).map((s, i) => ({
		id: s.videoId,
		label: audio.data?.origin === "match" && i === 0 ? "Match" : `#${i + 1}`,
	}));
	// Which result is loaded in the player; the filmstrip below drives it. The
	// card remounts per review (keyed by id), so advancing resets to the top hit.
	const [activeIdx, setActiveIdx] = useState(0);
	const isCockpit = variant === "cockpit";

	const player = sources.length > 0 && (
		<AudioPlayer
			ref={playerRef}
			sources={sources}
			clipStarts={audio.data?.clipStarts ?? []}
			compact={isCockpit}
			activeIndex={Math.min(activeIdx, sources.length - 1)}
		/>
	);

	// The alternates as select-to-play cards, so a wrong top hit costs one click
	// instead of a trip to YouTube.
	const filmstrip = (audio.data?.sources.length ?? 0) > 1 && (
		<div className="rv-films">
			{audio.data?.sources.map((s, i) => {
				const delta = durationDelta(r.durationMs, s.durationSeconds);
				return (
					<div
						key={s.videoId}
						className={`rv-cand pick${i === activeIdx ? " on" : ""}`}
					>
						<button
							type="button"
							className="rv-cand-main"
							title="Listen to this result"
							onClick={() => setActiveIdx(i)}
						>
							<span className="rv-cand-top">
								<span className="rv-cand-rank num">{sources[i]?.label}</span>
								{delta && (
									<span className={`rv-delta ${delta.tone} num`}>
										Δ{delta.delta}s
									</span>
								)}
							</span>
							<span className="rv-cand-title">{s.title ?? "(no title)"}</span>
							<span className="rv-cand-sub num">
								{s.channel ?? "—"}
								{s.durationSeconds != null && ` · ${clock(s.durationSeconds)}`}
							</span>
						</button>
					</div>
				);
			})}
		</div>
	);

	const actionsRow = onApprove && onReject && (
		<div className="rv-actions">
			<button
				type="button"
				className="btn approve"
				disabled={busy}
				onClick={onApprove}
			>
				<CheckCircleIcon size={14} weight="fill" />
				{busy ? "Working…" : "Instrumental — correct"}
				<kbd>A</kbd>
			</button>
			<button
				type="button"
				className="btn reject"
				disabled={busy}
				onClick={onReject}
			>
				<TrashIcon size={14} weight="bold" /> Has vocals — reject
				<kbd>R</kbd>
			</button>
			{onSkip && (
				<button type="button" className="btn" onClick={onSkip}>
					Skip <kbd>J</kbd>
				</button>
			)}
		</div>
	);

	const feedback = error && (
		<div className="result err" style={{ marginTop: 10 }}>
			{error}
		</div>
	);

	if (isCockpit) {
		return (
			<div className="rv-cockpit-detail">
				<div className="rv-dhead">
					<IdentityLine artistLabel={r.artistLabel} songName={r.songName} />
					<VerdictPill r={r} size="sm" />
				</div>
				<div className="rv-cmp">
					<SongFace r={r} size="sm" />
					<ListenFace r={r} audio={audio} activeIndex={activeIdx} size="sm" />
				</div>
				{player}
				{filmstrip}
				{actionsRow}
				{feedback}
			</div>
		);
	}

	return (
		<div className="card rv-focus">
			<div className="rv-focus-inner">
				<div className="rv-topline">
					<IdentityLine artistLabel={r.artistLabel} songName={r.songName} />
					{position != null && total != null && (
						<span className="rv-pos num">
							{position} / {total}
							{statusLabel ? ` ${statusLabel}` : ""}
						</span>
					)}
					<VerdictPill r={r} size="lg" />
				</div>

				<div className="rv-panels">
					<SongFace r={r} />
					<ListenFace r={r} audio={audio} activeIndex={activeIdx} />
				</div>

				{player}
				{filmstrip}
				{actionsRow}
				{feedback}
			</div>
		</div>
	);
}

// One compact selectable row in the cockpit rail: art · song/artist · signal
// chip, with a batch checkbox when the pending tab is multi-selecting.
function RailRow({
	r,
	active,
	canSelect,
	selected,
	onToggle,
	onSelect,
}: {
	r: InstrumentalReviewRow;
	active: boolean;
	canSelect: boolean;
	selected: boolean;
	onToggle: () => void;
	onSelect: () => void;
}) {
	const chip =
		r.signal === "genre"
			? "genre"
			: r.instrumentalness != null
				? `${Math.round(r.instrumentalness * 100)}%`
				: "instr.";
	return (
		<div className={`ar-railrow${active ? " on" : ""}`}>
			{canSelect && (
				<input
					className="ar-railcheck"
					type="checkbox"
					checked={selected}
					onChange={onToggle}
					aria-label={`Select ${r.songName} for batch`}
				/>
			)}
			<button type="button" className="ar-railrow-main" onClick={onSelect}>
				{r.imageUrl ? (
					<img src={r.imageUrl} alt="" loading="lazy" />
				) : (
					<span className="ar-railart" />
				)}
				<span className="ar-railtext">
					<span className="ar-railname">{r.songName}</span>
					<span className="ar-railsub">{r.artistLabel || "—"}</span>
				</span>
				<span className="ar-railscore warning">{chip}</span>
			</button>
		</div>
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
	// Single player instance across the queue — only one card is ever active — so
	// Space toggles playback wherever the operator is.
	const playerRef = useRef<AudioPlayerHandle | null>(null);
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
		onPlayPause: () => playerRef.current?.toggle(),
		// Approve/reject act on the active card in either mode. Reject only opens
		// the confirm modal — a shortcut never commits a destructive action.
		onApprove: () => {
			if (isPending && focusRow && actioning === null)
				void approve(focusRow.id);
		},
		onReject: () => {
			if (isPending && focusRow && actioning === null)
				setRejectTarget(focusRow);
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

	function card(r: InstrumentalReviewRow, variant: "focus" | "cockpit") {
		return (
			<ReviewCard
				key={r.id}
				r={r}
				variant={variant}
				position={variant === "focus" ? globalIndex + 1 : undefined}
				total={variant === "focus" ? total : undefined}
				statusLabel={queue.tab}
				busy={actioning === r.id}
				error={actionError?.id === r.id ? actionError.message : null}
				onApprove={isPending ? () => approve(r.id) : undefined}
				onReject={isPending ? () => setRejectTarget(r) : undefined}
				onSkip={variant === "focus" ? goNext : undefined}
				playerRef={playerRef}
			/>
		);
	}

	return (
		<div className="queue-page">
			<div className="card queue-head span-12">
				<WaveformIcon className="icon" size={15} weight="bold" />
				<h2>Instrumental review</h2>
				<details className="queue-info">
					<summary aria-label="About this queue">
						<InfoIcon size={15} weight="bold" />
					</summary>
					<div className="queue-info-panel">
						Songs with no lyrics are auto-tagged <strong>instrumental</strong>{" "}
						from genre or Spotify instrumentalness, and each guess is{" "}
						<strong>already live</strong>. Play the embedded audio and listen
						for vocals: approve to confirm, reject a vocal track to strip the
						tag and send it to the lyrics queue for manual entry. Approved and
						Rejected are read-only history.
					</div>
				</details>
				<div className="queue-head-tabs">
					<button
						type="button"
						className={`btn ${queue.tab === "pending" ? "primary" : ""}`}
						onClick={() => queue.setTab("pending")}
					>
						Pending · {data.pendingTotal}
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
				{data.pendingTotal > 0 ? (
					<Badge tone="warning">{data.pendingTotal} to review</Badge>
				) : (
					<Badge tone="success">all clear</Badge>
				)}
			</div>

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
				focusRow && (
					<div className="ar-list solo span-12">{card(focusRow, "focus")}</div>
				)
			) : (
				// Cockpit: a stat bar + selectable queue rail beside the active detail,
				// mirroring the audio queue's list mode.
				<div className="rv-cockpit span-12">
					<div className="rv-statbar">
						<span>
							<b className="serif upright">{total}</b> {queue.tab}
						</span>
						<span className="rv-statbar-keys">
							<span className="rv-tag">keyboard</span>
							<kbd>J</kbd>
							<kbd>K</kbd> move · <kbd>A</kbd> approve · <kbd>R</kbd> reject ·{" "}
							<kbd>Space</kbd> play
						</span>
					</div>
					<div className="rv-cols">
						<div className="ar-rail">
							{rows.map((r, i) => (
								<RailRow
									key={r.id}
									r={r}
									active={i === Math.min(queue.focusIndex, rows.length - 1)}
									canSelect={canSelect}
									selected={selectedIds.has(r.id)}
									onToggle={() => toggleSelect(r.id)}
									onSelect={() => queue.setFocusIndex(i)}
								/>
							))}
						</div>
						<div className="ar-detail">
							{focusRow && card(focusRow, "cockpit")}
						</div>
					</div>
				</div>
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
