import {
	ArrowSquareOutIcon,
	CheckCircleIcon,
	MagnifyingGlassIcon,
	PaperPlaneTiltIcon,
	SwapIcon,
	TrashIcon,
	WarningCircleIcon,
	WaveformIcon,
} from "@phosphor-icons/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { MatchCandidateSnapshot } from "@/lib/integrations/youtube-audio/types";
import {
	AudioPlayer,
	type AudioPlayerHandle,
	type AudioSource,
} from "../components/AudioPlayer";
import { BatchLauncher } from "../components/BatchLauncher";
import { ConfirmModal } from "../components/ConfirmModal";
import { Badge, ErrorState } from "../components/primitives";
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

// Verbal match-quality label from the 0–1 score, so the verdict reads as a
// judgement ("Strong match") not just a number. Thresholds mirror the brand's
// match-quality bands; tone drives the accent color of the hero.
function matchQuality(score: number | null): {
	label: string;
	tone: "success" | "warning" | "danger";
} {
	if (score == null) return { label: "Unscored", tone: "warning" };
	const pct = score * 100;
	if (pct >= 90) return { label: "Perfect fit", tone: "success" };
	if (pct >= 80) return { label: "Strong match", tone: "success" };
	if (pct >= 70) return { label: "Good match", tone: "warning" };
	if (pct >= 60) return { label: "Worth a look", tone: "warning" };
	return { label: "Weak match", tone: "danger" };
}

// A playable source plus the display metadata the YouTube face and candidate
// cards need to follow the selection.
interface PlayableSource extends AudioSource {
	title: string | null;
	channel: string | null;
	durationSeconds: number | null;
	thumbnailUrl: string | null;
	url: string | null;
}

// The accepted match plus every viable alternate, as playable sources — the
// candidate filmstrip/table doubles as the player's source switch, so the
// operator can flip "is it #1 or #2" without leaving. Rejected candidates and
// ones missing a video id can't be played, so they're dropped here (they still
// show in the candidate list, dimmed).
function buildAudioSources(r: AudioFeatureReviewRow): PlayableSource[] {
	const sources: PlayableSource[] = [];
	const seen = new Set<string>();
	if (r.youtubeVideoId) {
		sources.push({
			id: r.youtubeVideoId,
			label: "Match",
			title: r.youtubeTitle,
			channel: r.youtubeChannel,
			durationSeconds: r.youtubeDurationSeconds,
			thumbnailUrl: r.youtubeThumbnailUrl,
			url: r.youtubeUrl,
		});
		seen.add(r.youtubeVideoId);
	}
	for (const c of r.candidates) {
		if (c.rejected || !c.videoId || seen.has(c.videoId)) continue;
		seen.add(c.videoId);
		sources.push({
			id: c.videoId,
			label: `#${c.rank ?? sources.length + 1}`,
			title: c.title,
			channel: c.channel,
			durationSeconds: c.durationSeconds,
			thumbnailUrl: c.thumbnailUrl,
			url: c.url,
		});
	}
	return sources;
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

// "Artists — Song", song title in the editorial serif italic. Shared by the
// focus topline and the cockpit detail header so identity reads the same in both.
function IdentityLine({
	artists,
	songName,
}: {
	artists: string[];
	songName: string;
}) {
	const label = artists.join(", ");
	return (
		<span className="rv-ident">
			{label && `${label} — `}
			<span className="serif">{songName || "Unknown song"}</span>
		</span>
	);
}

// The match score as the card's verdict: a big serif number + quality label,
// tinted by tone. This is the thing the operator is here to judge, so it leads.
function VerdictPill({
	score,
	size = "lg",
}: {
	score: number | null;
	size?: "lg" | "sm";
}) {
	const q = matchQuality(score);
	const pct = score != null ? Math.round(score * 100) : null;
	return (
		<span className={`rv-verdict ${q.tone} ${size}`}>
			<span className="rv-verdict-num serif upright">{pct ?? "—"}</span>
			<span className="rv-verdict-label">{q.label}</span>
		</span>
	);
}

// Spotify identity face — cover, source eyebrow, title/artist/duration. `size`
// shrinks it for the cockpit's compare strip.
function SpotifyFace({
	r,
	size = "lg",
}: {
	r: AudioFeatureReviewRow;
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
					{[r.artists.join(", "), r.albumName].filter(Boolean).join(" · ") ||
						"—"}
					{size === "sm" && r.spotifyDurationMs != null && (
						<span className="num"> · {clock(r.spotifyDurationMs / 1000)}</span>
					)}
				</div>
				{size === "lg" && r.spotifyDurationMs != null && (
					<div className="rv-pclock num">
						{clock(r.spotifyDurationMs / 1000)}
					</div>
				)}
			</div>
		</div>
	);
}

// YouTube match face — thumbnail, source eyebrow, title/channel/duration, plus
// the open-on-YouTube link (kept as a secondary escape hatch beside the player).
// When the operator picks an alternate candidate to listen to, `active` swaps
// the face to that candidate so the panel always describes what's playing.
function YoutubeFace({
	r,
	active,
	size = "lg",
}: {
	r: AudioFeatureReviewRow;
	active?: PlayableSource | null;
	size?: "lg" | "sm";
}) {
	const sourceLabel =
		r.sourceType === "youtube_url" ? "manual url" : "via search";
	const isAlternate = active != null && active.id !== r.youtubeVideoId;
	const thumb = active ? active.thumbnailUrl : r.youtubeThumbnailUrl;
	const title = active ? active.title : r.youtubeTitle;
	const channel = active ? active.channel : r.youtubeChannel;
	const durationSeconds = active
		? active.durationSeconds
		: r.youtubeDurationSeconds;
	const url = active ? active.url : r.youtubeUrl;
	return (
		<div className={`rv-panel yt ${size}`}>
			{thumb ? (
				<img className="rv-face-art" src={thumb} alt="" loading="lazy" />
			) : (
				<span className="rv-face-art placeholder" />
			)}
			<div className="rv-face-body">
				<div className="rv-eye">
					<span className="rv-dot yt" />
					<span className="rv-tag">
						{isAlternate
							? `YouTube alternate · ${active.label}`
							: `YouTube match · ${sourceLabel}`}
					</span>
				</div>
				<div className="rv-ptitle">{title ?? "(no title)"}</div>
				<div className="rv-psub">
					{channel ?? "—"}
					{durationSeconds != null && (
						<span className="num"> · {clock(durationSeconds)}</span>
					)}
				</div>
				{size === "lg" && url && (
					<a href={url} target="_blank" rel="noreferrer" className="rv-plink">
						open on YouTube <ArrowSquareOutIcon size={11} weight="bold" />
					</a>
				)}
			</div>
		</div>
	);
}

// The scored candidates as a horizontal filmstrip (Direction A) — rank · title ·
// score. Playable cards double as the player's source switch (click to listen,
// outlined = playing); "Use this" stages the candidate as a replacement URL.
function Filmstrip({
	candidates,
	spotifyDurationMs,
	onStage,
	activeVideoId,
	onSelect,
}: {
	candidates: AudioFeatureCandidate[];
	spotifyDurationMs: number | null;
	onStage?: (url: string) => void;
	activeVideoId?: string | null;
	onSelect?: (videoId: string) => void;
}) {
	if (candidates.length === 0) return null;
	return (
		<div className="rv-films">
			{candidates.map((c, i) => {
				const delta = durationDelta(spotifyDurationMs, c.durationSeconds);
				const canUse = !c.rejected && Boolean(c.url) && Boolean(onStage);
				const canPlay = !c.rejected && Boolean(c.videoId) && Boolean(onSelect);
				const playing = c.videoId != null && c.videoId === activeVideoId;
				// Spans, not divs: this body sits inside a <button> when playable, and
				// the classes carry the block/flex display either way.
				const body = (
					<>
						<span className="rv-cand-top">
							<span className="rv-cand-rank num">
								{c.rejected ? "✕" : `#${c.rank ?? i + 1}`}
							</span>
							<span className={`rv-cand-score num${c.rejected ? " rej" : ""}`}>
								{c.score != null
									? `${Math.round(c.score * 100)}%`
									: c.rejected
										? "rejected"
										: "—"}
							</span>
						</span>
						<span className="rv-cand-title">{c.title ?? "(no title)"}</span>
						<span className="rv-cand-sub num">
							{c.durationSeconds != null ? clock(c.durationSeconds) : "—"}
							{delta && (
								<span className={`rv-delta ${delta.tone}`}>
									{" "}
									· Δ{delta.delta}s
								</span>
							)}
						</span>
					</>
				);
				return (
					<div
						className={`rv-cand${c.rejected ? " rej" : ""}${canPlay ? " pick" : ""}${playing ? " on" : ""}`}
						key={c.videoId ?? c.url ?? String(i)}
					>
						{canPlay ? (
							<button
								type="button"
								className="rv-cand-main"
								title="Listen to this candidate"
								onClick={() => onSelect?.(c.videoId as string)}
							>
								{body}
							</button>
						) : (
							body
						)}
						{canUse && (
							<button
								type="button"
								className="btn mini"
								onClick={() => onStage?.(c.url as string)}
							>
								Use this
							</button>
						)}
					</div>
				);
			})}
		</div>
	);
}

// The scored candidates as a dense table (Direction C cockpit) — the same data
// the filmstrip shows, sized for the side-by-side triage layout. The rank cell
// of a playable row is a button that switches the player to that candidate.
function CandidateTable({
	candidates,
	spotifyDurationMs,
	onStage,
	activeVideoId,
	onSelect,
}: {
	candidates: AudioFeatureCandidate[];
	spotifyDurationMs: number | null;
	onStage?: (url: string) => void;
	activeVideoId?: string | null;
	onSelect?: (videoId: string) => void;
}) {
	if (candidates.length === 0) return null;
	return (
		<table className="rv-table">
			<thead>
				<tr>
					<th>#</th>
					<th>Candidate</th>
					<th>Dur</th>
					<th>Δ</th>
					<th>Score</th>
					<th />
				</tr>
			</thead>
			<tbody>
				{candidates.map((c, i) => {
					const delta = durationDelta(spotifyDurationMs, c.durationSeconds);
					const canUse = !c.rejected && Boolean(c.url) && Boolean(onStage);
					const canPlay =
						!c.rejected && Boolean(c.videoId) && Boolean(onSelect);
					const playing = c.videoId != null && c.videoId === activeVideoId;
					return (
						<tr
							key={c.videoId ?? c.url ?? String(i)}
							className={
								`${c.rejected ? "rej" : ""}${playing ? " on" : ""}`.trim() ||
								undefined
							}
						>
							<td className="num">
								{canPlay ? (
									<button
										type="button"
										className="btn mini"
										title="Listen to this candidate"
										onClick={() => onSelect?.(c.videoId as string)}
									>
										{c.rank ?? i + 1}
									</button>
								) : c.rejected ? (
									"✕"
								) : (
									(c.rank ?? i + 1)
								)}
							</td>
							<td>
								{c.title ?? "(no title)"}
								{c.channel && <span className="rv-td-ch"> · {c.channel}</span>}
							</td>
							<td className="num">
								{c.durationSeconds != null ? clock(c.durationSeconds) : "—"}
							</td>
							<td className="num">
								{delta ? (
									<span className={`rv-delta ${delta.tone}`}>
										Δ{delta.delta}s
									</span>
								) : (
									"—"
								)}
							</td>
							<td className={`num rv-td-score${c.rejected ? " rej" : ""}`}>
								{c.score != null ? `${Math.round(c.score * 100)}%` : "—"}
							</td>
							<td>
								{canUse && (
									<button
										type="button"
										className="btn mini"
										onClick={() => onStage?.(c.url as string)}
									>
										use
									</button>
								)}
							</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}

function ReviewCard({
	r,
	variant,
	position,
	total,
	busy,
	error,
	onApprove,
	onReject,
	onReplaced,
	onSkip,
	statusLabel,
	playerRef,
}: {
	r: AudioFeatureReviewRow;
	// "focus" = Direction A split stage (one card, hero verdict + filmstrip);
	// "cockpit" = Direction C triage detail (compact, candidate table).
	variant: "focus" | "cockpit";
	// 1-based position + tab word for the "3 / 47 pending" readout (focus only —
	// cockpit shows the count in its stat bar).
	position?: number;
	total?: number;
	statusLabel?: string;
	// Approve/reject are lifted to the queue so keyboard and advance-after-action
	// stay consistent; replace stays local because it owns a URL-entry form.
	busy: boolean;
	error: string | null;
	onApprove?: () => void;
	onReject?: () => void;
	onReplaced?: () => void;
	// Advance without acting on the card (Direction A "Skip"); focus mode only.
	onSkip?: () => void;
	// The queue owns a single player ref (only one card is ever active) so Space
	// can drive playback from the keyboard.
	playerRef?: RefObject<AudioPlayerHandle | null>;
}) {
	const [replaceBusy, setReplaceBusy] = useState(false);
	const [replaceError, setReplaceError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [replaceOpen, setReplaceOpen] = useState(false);
	const [replaceUrl, setReplaceUrl] = useState("");
	const [confirmReplace, setConfirmReplace] = useState(false);
	// The candidate the operator picked to LISTEN to (null = the accepted match).
	// State is per-card — card() keys ReviewCard by review id, so advancing the
	// queue resets the pick. The filmstrip/table drive it; the player follows.
	const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
	const actionable = Boolean(onApprove && onReject);
	const sources = buildAudioSources(r);
	const activeSourceIndex = Math.max(
		0,
		sources.findIndex((s) => s.id === activeSourceId),
	);
	const activeSource = sources[activeSourceIndex] ?? null;
	const isCockpit = variant === "cockpit";

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

	// Clicking a candidate stages its URL into the replace form — the filmstrip
	// and table double as a one-click "swap to this candidate" affordance.
	function stageReplace(url: string) {
		setReplaceUrl(url);
		setReplaceOpen(true);
		setNotice(null);
	}

	const disabled = busy || replaceBusy;

	const actionsRow = actionable && (
		<div className="rv-actions">
			<button
				type="button"
				className="btn approve"
				disabled={disabled}
				onClick={onApprove}
			>
				<CheckCircleIcon size={14} weight="fill" />
				{busy ? "Working…" : "Looks correct"}
				<kbd>A</kbd>
			</button>
			<button
				type="button"
				className="btn reject"
				disabled={disabled}
				onClick={onReject}
			>
				<TrashIcon size={14} weight="bold" /> Reject
				<kbd>R</kbd>
			</button>
			<button
				type="button"
				className="btn"
				disabled={disabled}
				onClick={() => setReplaceOpen((o) => !o)}
			>
				<SwapIcon size={14} weight="bold" /> Replace URL
			</button>
			{onSkip && (
				<button type="button" className="btn" onClick={onSkip}>
					Skip <kbd>J</kbd>
				</button>
			)}
		</div>
	);

	const replaceForm = actionable && replaceOpen && (
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
	);

	const feedback = (
		<>
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
		</>
	);

	const extras = (
		<>
			<details className="ar-extra">
				<summary>Audio features</summary>
				<FeatureGrid r={r} />
			</details>
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
		</>
	);

	const player = sources.length > 0 && (
		<AudioPlayer
			ref={playerRef}
			sources={sources}
			clipStarts={r.clipStartsSeconds}
			compact={isCockpit}
			activeIndex={activeSourceIndex}
		/>
	);

	const confirmModal = confirmReplace && (
		<ConfirmModal
			title="Replace audio feature"
			danger
			confirmLabel="Queue replacement"
			description={
				<>
					Replace the feature for <strong>{r.songName}</strong> with this
					YouTube URL? This runs against <strong>production</strong>: the
					current feature is deleted and a manual backfill job is queued. This
					is <strong>not reversible</strong> from the panel.
				</>
			}
			onConfirm={() => replace()}
			onClose={() => setConfirmReplace(false)}
		/>
	);

	// Cockpit detail (Direction C): compact header + compare strip + player +
	// candidate table + actions. No Card chrome — it sits inside the cockpit grid.
	if (isCockpit) {
		return (
			<div className="rv-cockpit-detail">
				<div className="rv-dhead">
					<IdentityLine artists={r.artists} songName={r.songName} />
					<VerdictPill score={r.matchScore} size="sm" />
				</div>
				<div className="rv-cmp">
					<SpotifyFace r={r} size="sm" />
					<YoutubeFace r={r} active={activeSource} size="sm" />
				</div>
				{player}
				<CandidateTable
					candidates={r.candidates}
					spotifyDurationMs={r.spotifyDurationMs}
					onStage={actionable ? stageReplace : undefined}
					activeVideoId={activeSource?.id ?? null}
					onSelect={setActiveSourceId}
				/>
				{actionsRow}
				{replaceForm}
				{extras}
				{feedback}
				{confirmModal}
			</div>
		);
	}

	// Focus (Direction A): verdict-first split stage. A bare framed card — no
	// "Audio match" chrome — so it reads exactly like the prototype.
	return (
		<div className="card rv-focus">
			<div className="rv-focus-inner">
				<div className="rv-topline">
					<IdentityLine artists={r.artists} songName={r.songName} />
					{position != null && total != null && (
						<span className="rv-pos num">
							{position} / {total}
							{statusLabel ? ` ${statusLabel}` : ""}
						</span>
					)}
					<VerdictPill score={r.matchScore} size="lg" />
				</div>

				<div className="rv-panels">
					<SpotifyFace r={r} />
					<YoutubeFace r={r} active={activeSource} />
				</div>

				{player}

				<Filmstrip
					candidates={r.candidates}
					spotifyDurationMs={r.spotifyDurationMs}
					onStage={actionable ? stageReplace : undefined}
					activeVideoId={activeSource?.id ?? null}
					onSelect={setActiveSourceId}
				/>

				{actionsRow}
				{replaceForm}
				{extras}
				{feedback}
				{confirmModal}
			</div>
		</div>
	);
}

// One compact selectable row in the cockpit rail: art · song/artist · score
// badge, with a batch checkbox when the pending tab is multi-selecting. Clicking
// the body makes it the active detail card.
function RailRow({
	r,
	active,
	canSelect,
	selected,
	onToggle,
	onSelect,
}: {
	r: AudioFeatureReviewRow;
	active: boolean;
	canSelect: boolean;
	selected: boolean;
	onToggle: () => void;
	onSelect: () => void;
}) {
	const quality = matchQuality(r.matchScore);
	const pct = r.matchScore != null ? Math.round(r.matchScore * 100) : null;
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
					<span className="ar-railsub">{r.artists.join(", ") || "—"}</span>
				</span>
				{pct != null && (
					<span className={`ar-railscore ${quality.tone}`}>{pct}%</span>
				)}
			</button>
		</div>
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
	// Single player instance across the queue — only one card is ever active — so
	// Space toggles playback wherever the operator is.
	const playerRef = useRef<AudioPlayerHandle | null>(null);
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
		onPlayPause: () => playerRef.current?.toggle(),
		// Approve/reject act on the active card in either mode (focus or cockpit).
		// Reject only opens the confirm modal — a shortcut never commits a delete.
		onApprove: () => {
			if (isPending && focusRow && actioning === null)
				void approve(focusRow.id);
		},
		onReject: () => {
			if (isPending && focusRow && actioning === null)
				setRejectTarget(focusRow);
		},
	});

	const hasNext = isFocus ? globalIndex < total - 1 : queue.page < pageCount;
	const hasPrev = isFocus ? globalIndex > 0 : queue.page > 1;

	// Only the active detail card is rendered (focus mode = card alone, cockpit =
	// card beside the rail), so it always owns the shared player ref. Batch
	// selection lives on the rail rows, not here.
	function card(r: AudioFeatureReviewRow, variant: "focus" | "cockpit") {
		return (
			<ReviewCard
				key={r.id}
				r={r}
				variant={variant}
				position={variant === "focus" ? globalIndex + 1 : undefined}
				total={variant === "focus" ? total : undefined}
				statusLabel={status}
				busy={actioning === r.id}
				error={actionError?.id === r.id ? actionError.message : null}
				onApprove={isPending ? () => approve(r.id) : undefined}
				onReject={isPending ? () => setRejectTarget(r) : undefined}
				onReplaced={afterAction}
				onSkip={variant === "focus" ? goNext : undefined}
				playerRef={playerRef}
			/>
		);
	}

	if (error && !data) return <ErrorState message={error} />;

	return (
		<>
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
							onChange={(e) => queue.setFilter("minMatchScore", e.target.value)}
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
				focusRow && (
					<div className="ar-list solo span-12">{card(focusRow, "focus")}</div>
				)
			) : (
				// Cockpit: a stat bar + selectable queue rail beside the active detail.
				<div className="rv-cockpit span-12">
					<div className="rv-statbar">
						<span>
							<b className="serif upright">{total}</b> {status}
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

// Best auto-search score for a stuck job — the verdict number and its label.
// Below the confidence floor, so it's tinted warning/danger, never success.
function jobVerdict(r: AudioFeatureJobRow): {
	pct: number | null;
	label: string;
	tone: "warning" | "danger";
} {
	const failed = r.status === "failed";
	const bestScore = r.candidates.reduce<number | null>(
		(m, c) => (c.score != null && (m == null || c.score > m) ? c.score : m),
		null,
	);
	const pct = bestScore != null ? Math.round(bestScore * 100) : null;
	const label = failed
		? "Failed"
		: pct != null
			? "Low confidence"
			: "Needs URL";
	return { pct, label, tone: failed ? "danger" : "warning" };
}

// One compact selectable row in the job cockpit rail — art · song/artist ·
// verdict chip. Mirrors RailRow so Focus/List feel identical across tabs.
function JobRailRow({
	r,
	active,
	onSelect,
}: {
	r: AudioFeatureJobRow;
	active: boolean;
	onSelect: () => void;
}) {
	const v = jobVerdict(r);
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
				<span className={`ar-railscore ${v.tone}`}>
					{v.pct != null ? `${v.pct}%` : v.label}
				</span>
			</button>
		</div>
	);
}

function JobCard({
	r,
	variant,
	position,
	total,
	statusLabel,
	onActioned,
}: {
	r: AudioFeatureJobRow;
	// "focus" = split-stage shell (like ReviewCard Direction A); "cockpit" = bare
	// detail beside the rail (Direction C). Same body, different wrapper.
	variant: "focus" | "cockpit";
	position?: number;
	total?: number;
	statusLabel?: string;
	onActioned: () => void;
}) {
	const [url, setUrl] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const reason = r.errorCode
		? (REASON_COPY[r.errorCode] ?? r.errorCode)
		: "No reason recorded.";
	// Pre-built YouTube search so the operator lands on results for this exact
	// song in one click instead of retyping artist + title.
	const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
		`${r.artistLabel} ${r.songName}`.trim(),
	)}`;
	const v = jobVerdict(r);

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

	const body = (
		<>
			<div className="rv-topline">
				<IdentityLine artists={[r.artistLabel]} songName={r.songName} />
				{variant === "focus" && position != null && total != null && (
					<span className="rv-pos num">
						{position} / {total}
						{statusLabel ? ` ${statusLabel}` : ""}
					</span>
				)}
				<span className={`rv-verdict ${v.tone}`}>
					{v.pct != null && (
						<span className="rv-verdict-num serif upright">{v.pct}</span>
					)}
					<span className="rv-verdict-label">{v.label}</span>
				</span>
			</div>

			<div className="rv-panels">
				<div className="rv-panel sp">
					{r.imageUrl ? (
						<img
							className="rv-face-art"
							src={r.imageUrl}
							alt=""
							loading="lazy"
						/>
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
							{r.spotifyDurationMs != null && (
								<span className="num">
									{" "}
									· {clock(r.spotifyDurationMs / 1000)}
								</span>
							)}
						</div>
					</div>
				</div>
				<div className="rv-panel yt">
					<span className="rv-face-art placeholder" />
					<div className="rv-face-body">
						<div className="rv-eye">
							<span className="rv-dot yt" />
							<span className="rv-tag">YouTube match · none yet</span>
						</div>
						<div className="rv-ptitle">No confident match</div>
						<div className="rv-psub">Paste a URL below to backfill by hand</div>
					</div>
				</div>
			</div>

			<div className={`rv-why ${v.tone}`}>
				<WarningCircleIcon size={14} weight="fill" />
				<div>
					<div className="rv-why-reason">{reason}</div>
					{r.errorMessage && (
						<div className="rv-why-detail">{r.errorMessage}</div>
					)}
				</div>
			</div>

			{r.candidates.length > 0 && (
				<>
					<div className="rv-tag" style={{ marginTop: 4 }}>
						Candidates the auto-search found
					</div>
					<Filmstrip
						candidates={r.candidates}
						spotifyDurationMs={r.spotifyDurationMs}
						onStage={setUrl}
					/>
				</>
			)}

			<div className="field rv-job-form">
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
				<div className="rv-actions" style={{ marginTop: 8 }}>
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
		</>
	);

	if (variant === "cockpit") {
		return <div className="rv-cockpit-detail">{body}</div>;
	}
	return (
		<div className="card rv-focus">
			<div className="rv-focus-inner rv-job">{body}</div>
		</div>
	);
}

const JOB_EMPTY: Record<"needs_url" | "failed", string> = {
	needs_url: "No songs waiting on a URL — nothing to match by hand.",
	failed: "No terminally-failed backfills.",
};

function JobQueue({
	queue,
	refreshKey,
	onActioned,
}: {
	queue: QueueState<Tab, FilterKey>;
	refreshKey: number;
	onActioned: () => void;
}) {
	const filter = queue.tab as "needs_url" | "failed";
	const searchRef = useRef<HTMLInputElement>(null);
	const { data, error, refreshing, refetch } = useApi<{
		jobs: AudioFeatureJobRow[];
	}>(`/api/audio-feature-jobs?filter=${filter}`, refreshKey);

	// The jobs endpoint returns the whole bucket unpaged, so search, sort, and
	// paging are all client-side here — the toolbar drives the same knobs it does
	// for reviews, just applied in memory.
	const q = queue.q.trim().toLowerCase();
	const jobs = (data?.jobs ?? [])
		.filter((j) =>
			q ? `${j.artistLabel} ${j.songName}`.toLowerCase().includes(q) : true,
		)
		.sort((a, b) => {
			const cmp = a.createdAt.localeCompare(b.createdAt);
			return queue.order === "newest" ? -cmp : cmp;
		});

	const total = jobs.length;
	const pageCount = Math.max(1, Math.ceil(total / queue.pageSize));
	const isFocus = queue.mode === "focus";
	const start = (queue.page - 1) * queue.pageSize;
	const pageRows = jobs.slice(start, start + queue.pageSize);
	const localIndex = Math.min(
		queue.focusIndex,
		Math.max(0, pageRows.length - 1),
	);
	const focusRow = pageRows[localIndex];
	const globalIndex = start + localIndex;

	const { page, focusIndex, setPage, setFocusIndex } = queue;
	useEffect(() => {
		if (pageRows.length === 0) {
			if (page > 1) setPage(page - 1);
			return;
		}
		if (focusIndex > pageRows.length - 1) setFocusIndex(pageRows.length - 1);
	}, [pageRows.length, page, focusIndex, setPage, setFocusIndex]);

	function goNext() {
		if (isFocus && queue.focusIndex < pageRows.length - 1) {
			queue.setFocusIndex(queue.focusIndex + 1);
		} else if (queue.page < pageCount) {
			queue.setPage(queue.page + 1);
			if (isFocus) queue.setFocusIndex(0);
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

	const hasNext = isFocus ? globalIndex < total - 1 : queue.page < pageCount;
	const hasPrev = isFocus ? globalIndex > 0 : queue.page > 1;

	function actioned() {
		refetch();
		onActioned();
	}
	function card(r: AudioFeatureJobRow, variant: "focus" | "cockpit") {
		return (
			<JobCard
				key={r.jobId}
				r={r}
				variant={variant}
				position={variant === "focus" ? globalIndex + 1 : undefined}
				total={variant === "focus" ? total : undefined}
				statusLabel={filter === "needs_url" ? "to match" : "failed"}
				onActioned={actioned}
			/>
		);
	}

	if (error && !data) return <ErrorState message={error} />;

	return (
		<>
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
				total={total}
				page={queue.page}
				focusIndex={isFocus ? localIndex : undefined}
				onPrev={goPrev}
				onNext={goNext}
				hasPrev={hasPrev}
				hasNext={hasNext}
			/>

			{!data ? (
				<div className="card span-12">
					<div className="empty">Loading…</div>
				</div>
			) : total === 0 ? (
				<div className="card span-12">
					<div className="empty">
						{queue.q ? "No songs match your search." : JOB_EMPTY[filter]}
					</div>
				</div>
			) : isFocus ? (
				focusRow && (
					<div className="ar-list solo span-12">{card(focusRow, "focus")}</div>
				)
			) : (
				<div className="rv-cockpit span-12">
					<div className="rv-statbar">
						<span>
							<b className="serif upright">{total}</b>{" "}
							{filter === "needs_url" ? "to match" : "failed"}
						</span>
						<span className="rv-statbar-keys">
							<span className="rv-tag">keyboard</span>
							<kbd>J</kbd>
							<kbd>K</kbd> move · <kbd>/</kbd> search
						</span>
					</div>
					<div className="rv-cols">
						<div className="ar-rail">
							{pageRows.map((r, i) => (
								<JobRailRow
									key={r.jobId}
									r={r}
									active={i === localIndex}
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
		</>
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
		<div className="queue-page">
			<div className="card queue-head span-12">
				<WaveformIcon className="icon" size={15} weight="bold" />
				<h2>Audio queue</h2>
				<div className="queue-head-tabs">
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
				{total > 0 ? (
					<Badge tone="accent">{total} need attention</Badge>
				) : (
					<Badge tone="success">all clear</Badge>
				)}
			</div>

			{counts.error && <ErrorState message={counts.error} />}

			{isReviewTab(queue.tab) ? (
				<AudioReviewsQueue
					queue={queue}
					refreshKey={refreshKey}
					onActioned={counts.refetch}
				/>
			) : (
				<JobQueue
					queue={queue}
					refreshKey={refreshKey}
					onActioned={counts.refetch}
				/>
			)}
		</div>
	);
}
