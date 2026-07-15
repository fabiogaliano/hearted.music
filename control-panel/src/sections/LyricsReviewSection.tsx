import {
	CheckCircleIcon,
	MicrophoneStageIcon,
	MusicNotesIcon,
	WaveformIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { ConfirmModal } from "../components/ConfirmModal";
import { Badge, Card, ErrorState, Loading } from "../components/primitives";
import { QueueToolbar } from "../components/QueueToolbar";
import { postJson, useApi } from "../lib/api";
import { noAutofill } from "../lib/form";
import { useQueueKeyboard } from "../lib/queue-keyboard";
import { useQueueState } from "../lib/queue-state";
import type { PageResult } from "../lib/types";

interface LyricsReviewRow {
	songId: string;
	songName: string;
	artistLabel: string;
	albumName: string | null;
	imageUrl: string | null;
	durationMs: number | null;
	fetchStatus: "not_found" | "instrumental";
	fetchSource: string | null;
	fetchUpdatedAt: string;
}

type Filter = "needs_review" | "instrumental";

interface LyricsPage extends PageResult<LyricsReviewRow> {
	needsReviewTotal: number;
	instrumentalTotal: number;
}

function SongCard({
	r,
	text,
	onTextChange,
	onActioned,
}: {
	r: LyricsReviewRow;
	text: string;
	onTextChange: (value: string) => void;
	onActioned: () => void;
}) {
	const [busy, setBusy] = useState<null | "lyrics" | "instrumental">(null);
	const [error, setError] = useState<string | null>(null);
	const [confirmInstrumental, setConfirmInstrumental] = useState(false);

	// Em dash, not hyphen: song names here often already contain " - " (e.g.
	// "Wonderwall - Remastered"), so a hyphen separator would blur together.
	const title = r.artistLabel ? `${r.artistLabel} — ${r.songName}` : r.songName;
	const hasText = text.trim().length > 0;

	async function run(
		action: "lyrics" | "instrumental",
		fn: () => Promise<unknown>,
	) {
		setBusy(action);
		setError(null);
		try {
			await fn();
			onActioned();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
		}
	}

	function saveLyrics() {
		void run("lyrics", () =>
			postJson(`/api/lyrics-reviews/${r.songId}/lyrics`, { text }),
		);
	}

	// Mirrors `run` but rethrows so the confirm modal stays open and surfaces the
	// error on failure, and only closes on success.
	async function markInstrumental() {
		setBusy("instrumental");
		setError(null);
		try {
			await postJson(`/api/lyrics-reviews/${r.songId}/instrumental`, {});
			setConfirmInstrumental(false);
			onActioned();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			throw e;
		} finally {
			setBusy(null);
		}
	}

	return (
		<Card
			title="Song"
			icon={MusicNotesIcon}
			span={12}
			action={
				r.fetchStatus === "instrumental" ? (
					<Badge tone="default">instrumental</Badge>
				) : (
					<Badge tone="warning">no lyrics</Badge>
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
					<div className="ar-title">{title}</div>
					<div className="ar-sub">{r.albumName ?? "—"}</div>
				</div>
			</div>

			<div className="field" style={{ marginTop: 12 }}>
				<label htmlFor={`lyrics-${r.songId}`}>
					{r.fetchStatus === "instrumental" ? "Override with lyrics" : "Lyrics"}
				</label>
				<textarea
					id={`lyrics-${r.songId}`}
					className="input textarea"
					rows={6}
					placeholder="Paste or type the lyrics, one line per line…"
					value={text}
					{...noAutofill}
					onChange={(e) => onTextChange(e.target.value)}
				/>
			</div>

			<div className="btn-row">
				<button
					type="button"
					className="btn primary"
					disabled={busy !== null || !hasText}
					onClick={saveLyrics}
				>
					<CheckCircleIcon size={14} weight="fill" />
					{busy === "lyrics" ? "Saving…" : "Save lyrics"}
				</button>
				<button
					type="button"
					className="btn"
					disabled={busy !== null}
					onClick={() => setConfirmInstrumental(true)}
				>
					<WaveformIcon size={14} weight="bold" />
					{busy === "instrumental"
						? "Marking…"
						: r.fetchStatus === "instrumental"
							? "Re-confirm instrumental"
							: "Mark instrumental"}
				</button>
			</div>

			{error && (
				<div className="result err" style={{ marginTop: 10 }}>
					{error}
				</div>
			)}

			{confirmInstrumental && (
				<ConfirmModal
					title={
						r.fetchStatus === "instrumental"
							? "Re-confirm instrumental"
							: "Mark instrumental"
					}
					confirmLabel={
						r.fetchStatus === "instrumental"
							? "Re-confirm"
							: "Mark instrumental"
					}
					description={
						<>
							{r.fetchStatus === "instrumental" ? "Re-confirm" : "Mark"}{" "}
							<strong>{r.songName}</strong> as instrumental? This settles the
							song against <strong>production</strong> — it won't be re-offered
							for lyrics.
						</>
					}
					onConfirm={() => markInstrumental()}
					onClose={() => setConfirmInstrumental(false)}
				/>
			)}
		</Card>
	);
}

const EMPTY_COPY: Record<Filter, string> = {
	needs_review: "No songs awaiting manual lyrics — the queue is clear.",
	instrumental: "No instrumental songs to review.",
};

export function LyricsReviewSection({ refreshKey }: { refreshKey: number }) {
	const queue = useQueueState<Filter>({
		storageKey: "lyrics",
		tabs: ["needs_review", "instrumental"],
		defaultTab: "needs_review",
	});
	const searchRef = useRef<HTMLInputElement>(null);
	// Unsaved lyrics drafts, keyed by song, so moving between cards/pages within
	// the queue preserves what the operator typed instead of dropping it.
	const [drafts, setDrafts] = useState<Record<string, string>>({});

	const params = new URLSearchParams(queue.listParams);
	params.set("filter", queue.tab);
	const { data, error, loading, refreshing, refetch } = useApi<LyricsPage>(
		`/api/lyrics-reviews?${params.toString()}`,
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

	useQueueKeyboard({
		onNext: goNext,
		onPrev: goPrev,
		onSearch: () => searchRef.current?.focus(),
	});

	function setDraft(songId: string, value: string) {
		setDrafts((current) => ({ ...current, [songId]: value }));
	}
	function clearDraft(songId: string) {
		setDrafts((current) => {
			if (!(songId in current)) return current;
			const next = { ...current };
			delete next[songId];
			return next;
		});
	}
	function resetQueue() {
		const dirty = Object.values(drafts).some((text) => text.trim().length > 0);
		if (
			dirty &&
			!window.confirm("Discard your unsaved lyrics drafts and reset the queue?")
		)
			return;
		setDrafts({});
		queue.reset();
	}

	if (error && !data) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	const focusRow = rows[Math.min(queue.focusIndex, rows.length - 1)];
	const hasNext = isFocus ? globalIndex < total - 1 : queue.page < pageCount;
	const hasPrev = isFocus ? globalIndex > 0 : queue.page > 1;

	function card(r: LyricsReviewRow) {
		return (
			<SongCard
				key={r.songId}
				r={r}
				text={drafts[r.songId] ?? ""}
				onTextChange={(value) => setDraft(r.songId, value)}
				onActioned={() => {
					clearDraft(r.songId);
					refetch();
				}}
			/>
		);
	}

	return (
		<div className="grid">
			<Card
				title="Lyrics review"
				icon={MicrophoneStageIcon}
				span={12}
				action={
					data.needsReviewTotal > 0 ? (
						<Badge tone="warning">{data.needsReviewTotal} to enter</Badge>
					) : (
						<Badge tone="success">all clear</Badge>
					)
				}
			>
				<p className="muted-text">
					Entitled, liked songs whose lyrics fetch came up{" "}
					<strong>not found</strong> across every provider — no automated path
					is left, so they're entered by hand. Paste the lyrics and save (writes
					a manual <code>song_lyrics</code> row on prod; the song re-analyzes on
					the next enrichment pass automatically), or mark it{" "}
					<strong>instrumental</strong> to settle it. Switch to{" "}
					<strong>Instrumental</strong> ({data.instrumentalTotal}) to override a
					misclassified vocal track with its lyrics.
				</p>
				<div className="btn-row" style={{ marginTop: 12 }}>
					<button
						type="button"
						className={`btn ${queue.tab === "needs_review" ? "primary" : ""}`}
						onClick={() => queue.setTab("needs_review")}
					>
						Needs lyrics
					</button>
					<button
						type="button"
						className={`btn ${queue.tab === "instrumental" ? "primary" : ""}`}
						onClick={() => queue.setTab("instrumental")}
					>
						Instrumental
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
					onReset={resetQueue}
					refreshing={refreshing}
					total={total}
					page={queue.page}
					focusIndex={isFocus ? queue.focusIndex : undefined}
					onPrev={goPrev}
					onNext={goNext}
					hasPrev={hasPrev}
					hasNext={hasNext}
				/>
			</Card>

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
		</div>
	);
}
