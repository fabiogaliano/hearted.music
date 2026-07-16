import {
	CheckCircleIcon,
	MagnifyingGlassIcon,
	MicrophoneStageIcon,
	MusicNotesIcon,
	WaveformIcon,
} from "@phosphor-icons/react";
import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { AudioPlayer, type AudioPlayerHandle } from "../components/AudioPlayer";
import { ConfirmModal } from "../components/ConfirmModal";
import { Badge, Card, ErrorState, Loading } from "../components/primitives";
import { QueueToolbar } from "../components/QueueToolbar";
import { getJson, postJson, useApi } from "../lib/api";
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
	youtubeVideoId: string | null;
}

// Mirror of server/lyrics-fetch.ts LyricsCandidate.
interface LyricsCandidate {
	id: number | null;
	provider: "lrclib";
	trackName: string;
	artistName: string;
	albumName: string | null;
	durationSeconds: number | null;
	syncedLyrics: string | null;
	plainLyrics: string | null;
	instrumental: boolean;
	similarity: number;
	durationDelta: number | null;
}

interface LyricsFetchResult {
	query: {
		trackName: string;
		artistName: string;
		albumName: string | null;
		durationSeconds: number | null;
	};
	candidates: LyricsCandidate[];
}

type Filter = "needs_review" | "instrumental";

interface LyricsPage extends PageResult<LyricsReviewRow> {
	needsReviewTotal: number;
	instrumentalTotal: number;
}

// LRC lines carry [mm:ss.xx] stamps the analysis path doesn't want; strip them so
// "Use this" fills the editor with clean plain text.
function stripSync(lrc: string): string {
	return lrc
		.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, "")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trim();
}

function candidateText(c: LyricsCandidate): string {
	if (c.plainLyrics?.trim()) return c.plainLyrics.trim();
	if (c.syncedLyrics?.trim()) return stripSync(c.syncedLyrics);
	return "";
}

// The inline lyrics finder: fetches LRCLIB candidates automatically (no button
// gate — Direction A surfaces sources inline) and lets the operator switch
// between them and one-click a source into the editor, so they never leave the
// panel to hunt lyrics.
function LyricsFinder({
	songId,
	onUse,
	webSearchUrl,
}: {
	songId: string;
	onUse: (text: string) => void;
	// Prebuilt web search ("artist song lyrics") for when LRCLIB has nothing — a
	// real escape to Google/other lyrics sites instead of re-querying LRCLIB.
	webSearchUrl: string;
}) {
	const [state, setState] = useState<"loading" | "done" | "error">("loading");
	const [error, setError] = useState<string | null>(null);
	const [candidates, setCandidates] = useState<LyricsCandidate[]>([]);
	const [active, setActive] = useState(0);

	// Fetch is stable per song; the effect auto-runs it and the retry button calls
	// it directly, so it doubles as the "search again" affordance.
	const find = useCallback(() => {
		setState("loading");
		setError(null);
		getJson<LyricsFetchResult>(`/api/lyrics-reviews/${songId}/fetch-candidates`)
			.then((res) => {
				setCandidates(res.candidates);
				setActive(0);
				setState("done");
			})
			.catch((e) => {
				setError(e instanceof Error ? e.message : String(e));
				setState("error");
			});
	}, [songId]);

	useEffect(() => {
		find();
	}, [find]);

	if (state === "loading") {
		return (
			<div className="ly-finder">
				<div className="muted-text ly-finder-status">Searching LRCLIB…</div>
			</div>
		);
	}

	if (state === "error") {
		return (
			<div className="ly-finder">
				<div className="result err">{error}</div>
				<div className="btn-row">
					<button type="button" className="btn mini" onClick={find}>
						Retry
					</button>
					<a
						href={webSearchUrl}
						target="_blank"
						rel="noreferrer"
						className="btn mini"
					>
						<MagnifyingGlassIcon size={13} weight="bold" /> Search the web ↗
					</a>
				</div>
			</div>
		);
	}

	if (candidates.length === 0) {
		// LRCLIB came up empty — re-querying it will just fail again, so send the
		// operator to the web with a prebuilt query, then paste back on the right.
		return (
			<div className="ly-finder">
				<div className="muted-text ly-finder-status">
					Nothing on LRCLIB. Search the web, then paste the lyrics on the right.
				</div>
				<a
					href={webSearchUrl}
					target="_blank"
					rel="noreferrer"
					className="btn mini"
				>
					<MagnifyingGlassIcon size={13} weight="bold" /> Search the web ↗
				</a>
			</div>
		);
	}

	const c = candidates[active];
	if (!c) return null;
	const preview = c.syncedLyrics ?? c.plainLyrics ?? "(no lyrics text)";
	const lineCount = candidateText(c).trim()
		? candidateText(c).trim().split(/\n/).length
		: 0;
	return (
		<div className="ly-finder">
			<div className="ly-sources">
				{candidates.map((cand, i) => (
					<button
						type="button"
						key={cand.id ?? i}
						className={i === active ? "on" : ""}
						onClick={() => setActive(i)}
					>
						{cand.provider}
						{cand.syncedLyrics ? (
							<span className="ly-badge synced">synced</span>
						) : cand.instrumental ? (
							<span className="ly-badge">instrumental</span>
						) : (
							<span className="ly-badge">plain</span>
						)}
					</button>
				))}
			</div>
			<pre className="ly-preview">{preview}</pre>
			<div className="ly-srcmeta">
				<button
					type="button"
					className="ly-use"
					disabled={candidateText(c).length === 0}
					onClick={() => onUse(candidateText(c))}
				>
					Use this →
				</button>
				<span className="muted-text">
					{c.provider} · {c.syncedLyrics ? "synced" : "plain"} ·{" "}
					<span className="num">{lineCount} lines</span>
					{c.durationDelta != null && (
						<>
							{" · "}
							<span className="num">Δ {c.durationDelta}s</span>
						</>
					)}
					{" · "}
					{Math.round(c.similarity * 100)}% match
				</span>
			</div>
			<a
				href={webSearchUrl}
				target="_blank"
				rel="noreferrer"
				className="ly-websearch"
			>
				<MagnifyingGlassIcon size={12} weight="bold" /> Not right? Search the
				web ↗
			</a>
		</div>
	);
}

function LyricsEditor({
	songId,
	text,
	onTextChange,
	onSave,
	saving,
}: {
	songId: string;
	text: string;
	onTextChange: (value: string) => void;
	onSave: () => void;
	saving: boolean;
}) {
	const lineCount = text.trim() ? text.trim().split(/\n/).length : 0;
	return (
		<div className="field ly-editor">
			<div className="ly-editor-head">
				<label htmlFor={`lyrics-${songId}`}>Lyrics to save</label>
				<span className="muted-text num">{lineCount} lines</span>
			</div>
			<textarea
				id={`lyrics-${songId}`}
				className="input textarea"
				rows={8}
				placeholder="Paste, type, or click ‘Use this’ from a source above…"
				value={text}
				{...noAutofill}
				onChange={(e) => onTextChange(e.target.value)}
				onKeyDown={(e) => {
					// ⌘/Ctrl+Enter saves from inside the editor, where the queue's
					// keyboard shortcuts are (correctly) suppressed.
					if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !saving) {
						e.preventDefault();
						onSave();
					}
				}}
			/>
		</div>
	);
}

// mm:ss for the head duration readout. Small local helper — the lyrics section
// only ever formats this one duration.
function fmtClock(seconds: number): string {
	const t = Math.max(0, Math.round(seconds));
	return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

function SongCard({
	r,
	text,
	onTextChange,
	onActioned,
	showPlayer,
	playerRef,
	position,
	total,
	bare = false,
}: {
	r: LyricsReviewRow;
	text: string;
	onTextChange: (value: string) => void;
	onActioned: () => void;
	// Only the active card embeds a player, so list mode never mounts N iframes.
	showPlayer: boolean;
	playerRef?: RefObject<AudioPlayerHandle | null>;
	// 1-based position in the filtered set, shown on the active card only.
	position?: number;
	total?: number;
	// Cockpit detail: drop the Card chrome so it sits bare beside the rail.
	bare?: boolean;
}) {
	const [busy, setBusy] = useState<null | "lyrics" | "instrumental">(null);
	const [error, setError] = useState<string | null>(null);
	const [confirmInstrumental, setConfirmInstrumental] = useState(false);
	// Instrumental escape hatch: reveal the finder + editor when the operator hears
	// vocals and wants to override the classification.
	const [vocalsOpen, setVocalsOpen] = useState(false);

	const hasText = text.trim().length > 0;
	const isInstrumental = r.fetchStatus === "instrumental";
	const durationLabel =
		r.durationMs != null ? fmtClock(r.durationMs / 1000) : null;
	const subLine = [r.artistLabel, r.albumName, durationLabel]
		.filter(Boolean)
		.join(" · ");
	const ytSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent(
		`${r.artistLabel} ${r.songName}`.trim(),
	)}`;
	// Prebuilt web search for lyrics when LRCLIB has nothing — Google lands on
	// Genius / AZLyrics / etc. for the exact track.
	const webSearch = `https://www.google.com/search?q=${encodeURIComponent(
		`${r.artistLabel} ${r.songName} lyrics`.trim(),
	)}`;

	function saveLyrics() {
		setBusy("lyrics");
		setError(null);
		postJson(`/api/lyrics-reviews/${r.songId}/lyrics`, { text })
			.then(() => onActioned())
			.catch((e) => setError(e instanceof Error ? e.message : String(e)))
			.finally(() => setBusy(null));
	}

	// Mirrors the save path but rethrows so the confirm modal stays open and shows
	// the error on failure, closing only on success.
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

	const art = r.imageUrl ? (
		<img className="ly-art" src={r.imageUrl} alt="" loading="lazy" />
	) : (
		<span className="ly-art placeholder" />
	);

	const transport =
		showPlayer && r.youtubeVideoId ? (
			<AudioPlayer
				ref={playerRef}
				sources={[{ id: r.youtubeVideoId, label: "Audio" }]}
			/>
		) : (
			<a href={ytSearch} target="_blank" rel="noreferrer" className="ly-listen">
				<MagnifyingGlassIcon size={13} weight="bold" /> Listen on YouTube
			</a>
		);

	const editor = (
		<LyricsEditor
			songId={r.songId}
			text={text}
			onTextChange={onTextChange}
			onSave={saveLyrics}
			saving={busy === "lyrics"}
		/>
	);
	const finder = (
		<LyricsFinder
			songId={r.songId}
			onUse={onTextChange}
			webSearchUrl={webSearch}
		/>
	);

	const saveButton = (
		<button
			type="button"
			className="btn save"
			disabled={busy !== null || !hasText}
			onClick={saveLyrics}
		>
			<CheckCircleIcon size={14} weight="fill" />
			{busy === "lyrics" ? "Saving…" : "Save lyrics"}
			<kbd>⌘↵</kbd>
		</button>
	);

	const errorBlock = error && (
		<div className="result err" style={{ marginTop: 10 }}>
			{error}
		</div>
	);

	const confirmModal = confirmInstrumental && (
		<ConfirmModal
			title={isInstrumental ? "Re-confirm instrumental" : "Mark instrumental"}
			confirmLabel={isInstrumental ? "Re-confirm" : "Mark instrumental"}
			description={
				<>
					{isInstrumental ? "Re-confirm" : "Mark"} <strong>{r.songName}</strong>{" "}
					as instrumental? This settles the song against{" "}
					<strong>production</strong> — it won't be re-offered for lyrics.
				</>
			}
			onConfirm={() => markInstrumental()}
			onClose={() => setConfirmInstrumental(false)}
		/>
	);

	const inner = (
		<>
			{isInstrumental ? (
				// Direction B — listen & confirm. The call is "is this really
				// instrumental?", so confirming leads; the finder is the escape hatch
				// for a misclassified vocal track.
				<div className="ly-b">
					<div className="ly-head centered">
						{art}
						<div className="ly-head-id">
							<div className="rv-tag">classifier flagged this instrumental</div>
							<div className="ly-song serif">{r.songName}</div>
							<div className="ly-hs">{subLine || "—"}</div>
						</div>
					</div>

					<div className="ly-confirm">
						<div className="ly-confirm-big serif">Listen to confirm</div>
						<div className="ly-confirm-q">
							Any vocals? If you hear singing, it needs lyrics instead.
						</div>
					</div>

					{transport}

					<div className="ly-confirm-acts">
						<button
							type="button"
							className="btn warn-primary"
							disabled={busy !== null}
							onClick={() => setConfirmInstrumental(true)}
						>
							<WaveformIcon size={14} weight="bold" />
							{busy === "instrumental" ? "Marking…" : "Confirm instrumental"}
						</button>
						<button
							type="button"
							className="btn"
							onClick={() => setVocalsOpen((o) => !o)}
							aria-expanded={vocalsOpen}
						>
							Has vocals → add lyrics
						</button>
					</div>

					{vocalsOpen && (
						<>
							<div className="ly-cols" style={{ marginTop: 14 }}>
								<div>{finder}</div>
								<div>{editor}</div>
							</div>
							<div className="ly-acts">{saveButton}</div>
						</>
					)}

					{errorBlock}
					{confirmModal}
				</div>
			) : (
				// Direction A — source + editor split. Fetched candidates on the left,
				// editor on the right; mark instrumental is the settle-it fallback.
				<div className="ly-a">
					<div className="ly-head">
						{art}
						<div className="ly-head-id">
							<div className="rv-tag">
								needs lyrics · auto-fetch returned not_found
							</div>
							<div className="ly-song serif">{r.songName}</div>
							<div className="ly-hs">{subLine || "—"}</div>
						</div>
						{position != null && total != null && (
							<span className="ly-pos num">
								{position} / {total}
							</span>
						)}
					</div>

					{transport}

					<div className="ly-cols">
						<div>{finder}</div>
						<div>{editor}</div>
					</div>

					<div className="ly-acts">
						{saveButton}
						<button
							type="button"
							className="btn inst"
							disabled={busy !== null}
							onClick={() => setConfirmInstrumental(true)}
						>
							<WaveformIcon size={14} weight="bold" />
							{busy === "instrumental" ? "Marking…" : "Mark instrumental"}
						</button>
					</div>

					{errorBlock}
					{confirmModal}
				</div>
			)}
		</>
	);

	if (bare) {
		return <div className="rv-cockpit-detail ly-detail">{inner}</div>;
	}
	return (
		<Card
			title="Song"
			icon={MusicNotesIcon}
			span={12}
			action={
				isInstrumental ? (
					<Badge tone="default">instrumental</Badge>
				) : (
					<Badge tone="warning">no lyrics</Badge>
				)
			}
		>
			{inner}
		</Card>
	);
}

// One compact selectable row in the lyrics cockpit rail — art · song/artist ·
// status chip. Mirrors the audio RailRow so Focus/List feel identical here too.
function LyricsRailRow({
	r,
	active,
	onSelect,
}: {
	r: LyricsReviewRow;
	active: boolean;
	onSelect: () => void;
}) {
	const isInstrumental = r.fetchStatus === "instrumental";
	return (
		<div className={`ar-railrow${active ? " on" : ""}`}>
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
				<span className={`ar-railscore ${isInstrumental ? "" : "warning"}`}>
					{isInstrumental ? "instr." : "no lyrics"}
				</span>
			</button>
		</div>
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
	const playerRef = useRef<AudioPlayerHandle | null>(null);
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
		onPlayPause: () => playerRef.current?.toggle(),
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

	function card(r: LyricsReviewRow, active: boolean, bare = false) {
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
				showPlayer={active}
				playerRef={active ? playerRef : undefined}
				position={active ? globalIndex + 1 : undefined}
				total={active ? total : undefined}
				bare={bare}
			/>
		);
	}

	return (
		<div className="queue-page">
			<div className="card queue-head span-12">
				<MicrophoneStageIcon className="icon" size={15} weight="bold" />
				<h2>Lyrics review</h2>
				<div className="queue-head-tabs">
					<button
						type="button"
						className={`btn ${queue.tab === "needs_review" ? "primary" : ""}`}
						onClick={() => queue.setTab("needs_review")}
					>
						Needs lyrics · {data.needsReviewTotal}
					</button>
					<button
						type="button"
						className={`btn ${queue.tab === "instrumental" ? "primary" : ""}`}
						onClick={() => queue.setTab("instrumental")}
					>
						Instrumental · {data.instrumentalTotal}
					</button>
				</div>
				{data.needsReviewTotal > 0 ? (
					<Badge tone="warning">{data.needsReviewTotal} to enter</Badge>
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

			{rows.length === 0 ? (
				<div className="card span-12">
					<div className="empty">
						{queue.q ? "No songs match your search." : EMPTY_COPY[queue.tab]}
					</div>
				</div>
			) : isFocus ? (
				focusRow && (
					<div className="ar-list solo span-12">{card(focusRow, true)}</div>
				)
			) : (
				<div className="rv-cockpit span-12">
					<div className="rv-statbar">
						<span>
							<b className="serif upright">{total}</b>{" "}
							{queue.tab === "needs_review" ? "to enter" : "instrumental"}
						</span>
						<span className="rv-statbar-keys">
							<span className="rv-tag">keyboard</span>
							<kbd>J</kbd>
							<kbd>K</kbd> move · <kbd>Space</kbd> play · <kbd>/</kbd> search
						</span>
					</div>
					<div className="rv-cols">
						<div className="ar-rail">
							{rows.map((r, i) => (
								<LyricsRailRow
									key={r.songId}
									r={r}
									active={i === Math.min(queue.focusIndex, rows.length - 1)}
									onSelect={() => queue.setFocusIndex(i)}
								/>
							))}
						</div>
						<div className="ar-detail">
							{focusRow && card(focusRow, true, true)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
